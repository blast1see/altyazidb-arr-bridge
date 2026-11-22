"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { FakeDocument, FakeFormData, appendHtml, settle } = require("./helpers/fake-dom.js");

const root = path.resolve(__dirname, "..");
const extensionRoot = path.join(root, "altyazidb-arr-bridge-chrome-0.1.1");
const configSource = fs.readFileSync(path.join(extensionRoot, "src", "config.js"), "utf8");
const optionsSource = fs.readFileSync(path.join(extensionRoot, "src", "options.js"), "utf8");
const optionsHtml = fs.readFileSync(path.join(extensionRoot, "options.html"), "utf8");
const optionsBody = /<body>([\s\S]*)<\/body>/i.exec(optionsHtml)[1];

// Fake credentials only; nothing here is a real key.
const SAVED_KEYS = {
  radarrApiKey: "radarr-key",
  sonarrApiKey: "sonarr-key",
  prowlarrApiKey: "prowlarr-key",
  jackettApiKey: "jackett-key"
};

// Boots options.js against the real options.html markup with a callback-style
// `chrome` API (the Chrome path: `globalThis.browser` is undefined there).
async function openOptions({
  stored = {},
  failures = {},
  permissions = { contains: true, request: true },
  sendMessageResponse = { ok: true, message: "Connected." }
} = {}) {
  const document = new FakeDocument();
  appendHtml(document.body, optionsBody);

  const store = { ...stored };
  const calls = { get: 0, set: 0, contains: [], request: [], sendMessage: [] };
  const runtime = {
    id: "adb-test-extension",
    lastError: undefined,
    sendMessage(message, callback) {
      calls.sendMessage.push(message);
      callback(sendMessageResponse);
    }
  };

  // Chrome reports callback-API failures through runtime.lastError, set only
  // for the duration of the callback.
  const respond = (failure, callback, value) => {
    if (failure) {
      runtime.lastError = { message: failure };
      try {
        callback(undefined);
      } finally {
        runtime.lastError = undefined;
      }
      return;
    }

    callback(value);
  };

  const chrome = {
    runtime,
    storage: {
      local: {
        get(defaults, callback) {
          calls.get += 1;
          respond(failures.get, callback, { ...defaults, ...store });
        },
        set(values, callback) {
          calls.set += 1;

          if (!failures.set) {
            Object.assign(store, values);
          }

          respond(failures.set, callback);
        }
      }
    },
    permissions: {
      contains(request, callback) {
        calls.contains.push(request.origins);
        respond(failures.contains, callback, permissions.contains);
      },
      request(request, callback) {
        calls.request.push(request.origins);
        respond(failures.request, callback, permissions.request);
      }
    }
  };

  const sandbox = { URL, console, document, FormData: FakeFormData, chrome };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(configSource, sandbox, { filename: "config.js" });
  vm.runInContext(optionsSource, sandbox, { filename: "options.js" });
  await settle();

  const byId = (id) => {
    const node = document.getElementById(id);
    assert.ok(node, `options.html is missing #${id}`);
    return node;
  };

  const fire = async (element, type, target = element) => {
    const event = {
      type,
      target,
      currentTarget: element,
      preventDefault() {}
    };
    await Promise.all((element.listeners.get(type) || []).map((handler) => handler(event)));
    await settle(12);
  };

  return {
    document,
    store,
    calls,
    byId,
    form: byId("optionsForm"),
    status: byId("status"),
    async submit() {
      await fire(this.form, "submit");
    },
    async click(id) {
      await fire(byId(id), "click");
    },
    async change(id, mutate) {
      const control = byId(id);
      mutate(control);
      await fire(this.form, "change", control);
    },
    async chooseBehavior(value) {
      const radio = document.querySelector(`input[name="behavior"][value="${value}"]`);
      assert.ok(radio, `missing behavior radio ${value}`);
      for (const other of document.querySelectorAll('input[name="behavior"]')) {
        other.checked = other === radio;
      }
      await fire(this.form, "change", radio);
    }
  };
}

test("loading options never writes a saved API key into any input", async () => {
  const page = await openOptions({
    stored: { ...SAVED_KEYS, radarrBaseUrl: "http://127.0.0.1:7979" }
  });

  assert.equal(page.byId("radarrBaseUrl").value, "http://127.0.0.1:7979", "settings did load");

  const secrets = new Set(Object.values(SAVED_KEYS));
  const leaked = page.document.body
    .descendants()
    .filter((node) => secrets.has(node.value))
    .map((node) => node.id || node.tagName);
  assert.deepEqual(leaked, []);

  for (const service of ["radarr", "sonarr", "prowlarr", "jackett"]) {
    assert.equal(page.byId(`${service}ApiKey`).value, "");
  }
});

test("saving with a blank API key field keeps the stored key", async () => {
  const page = await openOptions({ stored: { ...SAVED_KEYS } });

  page.byId("radarrBaseUrl").value = "http://127.0.0.1:7880";
  await page.submit();

  assert.equal(page.status.textContent, "Settings saved.");
  assert.equal(page.store.radarrBaseUrl, "http://127.0.0.1:7880");
  assert.equal(page.store.radarrApiKey, "radarr-key");
  assert.equal(page.store.jackettApiKey, "jackett-key");
  assert.equal(page.byId("radarrApiKey").value, "");
});

test("saving with 'Delete saved API key' checked clears only that key", async () => {
  const page = await openOptions({ stored: { ...SAVED_KEYS } });

  await page.change("clearRadarrApiKey", (control) => {
    control.checked = true;
  });
  assert.equal(page.byId("radarrApiKey").disabled, true);

  await page.submit();

  assert.equal(page.status.textContent, "Settings saved.");
  assert.equal(page.store.radarrApiKey, "");
  assert.equal(page.store.sonarrApiKey, "sonarr-key");
  assert.equal(page.byId("clearRadarrApiKey").checked, false);
});

test("Test sends nothing when the custom host permission is refused", async () => {
  const page = await openOptions({
    stored: { ...SAVED_KEYS },
    permissions: { contains: false, request: false }
  });

  page.byId("radarrBaseUrl").value = "http://media.example:7878";
  await page.click("testRadarr");

  // Spread: the origins array comes from the vm realm.
  assert.deepEqual(page.calls.request.map((origins) => [...origins]), [["http://media.example/*"]]);
  assert.equal(page.calls.sendMessage.length, 0);
  assert.equal(page.calls.set, 0);
  assert.match(page.status.textContent, /No connection request was sent\./);
  assert.equal(page.status.className, "error");
});

test("a failed storage.set is reported instead of 'Settings saved.'", async () => {
  const page = await openOptions({
    stored: { ...SAVED_KEYS },
    failures: { set: "QUOTA_BYTES quota exceeded" }
  });

  page.byId("radarrApiKey").value = "radarr-key-new";
  await page.submit();

  assert.equal(page.calls.set, 1);
  assert.notEqual(page.status.textContent, "Settings saved.");
  assert.match(page.status.textContent, /QUOTA_BYTES quota exceeded/);
  assert.equal(page.status.className, "error");
  assert.equal(page.store.radarrApiKey, "radarr-key");
  // The typed key is not thrown away when nothing was stored.
  assert.equal(page.byId("radarrApiKey").value, "radarr-key-new");
});

test("a failed save does not replace the remembered settings", async () => {
  const failures = { set: "QUOTA_BYTES quota exceeded" };
  const page = await openOptions({ stored: { ...SAVED_KEYS }, failures });

  page.byId("radarrApiKey").value = "radarr-key-new";
  await page.submit();

  // Storage recovers; the user blanks the field and saves again. The key that
  // never reached storage must not resurface from the in-memory copy.
  delete failures.set;
  page.byId("radarrApiKey").value = "";
  await page.submit();

  assert.equal(page.status.textContent, "Settings saved.");
  assert.equal(page.store.radarrApiKey, "radarr-key");
});

test("Test and Load send no background message when saving fails", async () => {
  const page = await openOptions({
    stored: { ...SAVED_KEYS },
    failures: { set: "QUOTA_BYTES quota exceeded" }
  });

  await page.click("testRadarr");
  assert.equal(page.calls.sendMessage.length, 0);
  assert.match(page.status.textContent, /QUOTA_BYTES quota exceeded/);
  assert.equal(page.status.className, "error");

  await page.click("loadSonarrChoices");
  assert.equal(page.calls.sendMessage.length, 0);
  assert.match(page.status.textContent, /QUOTA_BYTES quota exceeded/);
  assert.equal(page.status.className, "error");
  assert.equal(page.byId("loadSonarrChoices").disabled, false);
});

test("Test reaches the background once settings are stored", async () => {
  const page = await openOptions({ stored: { ...SAVED_KEYS } });

  await page.click("testProwlarr");

  assert.deepEqual(
    page.calls.sendMessage.map((message) => ({ ...message })),
    [{ type: "ADB_TEST_CONNECTION", service: "prowlarr" }]
  );
  assert.equal(page.status.textContent, "Connected.");
  assert.equal(page.status.className, "success");
});

test("a failed storage.get while loading shows an error", async () => {
  const page = await openOptions({ failures: { get: "Storage unavailable" } });

  assert.equal(page.calls.get, 1);
  assert.match(page.status.textContent, /Storage unavailable/);
  assert.equal(page.status.className, "error");
});

test("a permission lookup error sends no connection request", async () => {
  const page = await openOptions({
    failures: { contains: "Invalid origin pattern" },
    permissions: { contains: false, request: true }
  });

  page.byId("radarrBaseUrl").value = "http://media.example:7878";
  await page.click("testRadarr");

  assert.equal(page.calls.request.length, 0);
  assert.equal(page.calls.sendMessage.length, 0);
  assert.match(page.status.textContent, /Invalid origin pattern/);
  assert.equal(page.status.className, "error");
});

test("a permission request error is reported, not treated as a refusal", async () => {
  const page = await openOptions({
    failures: { request: "Permission request already pending" },
    permissions: { contains: false, request: false }
  });

  page.byId("radarrBaseUrl").value = "http://media.example:7878";
  await page.click("testRadarr");

  assert.equal(page.calls.sendMessage.length, 0);
  assert.match(page.status.textContent, /Permission request already pending/);
  assert.equal(page.status.className, "error");
});

test("auto-add fields are disabled unless the behavior is autoAdd", async () => {
  const page = await openOptions({ stored: { behavior: "showPopupResults" } });
  const sections = page.document.querySelectorAll("[data-auto-section]");
  const controls = () =>
    sections.flatMap((section) => section.querySelectorAll("input, select"));

  assert.equal(sections.length, 2);
  assert.ok(controls().length >= 7, "auto-add sections hold the Radarr/Sonarr add controls");
  assert.ok(controls().every((control) => control.disabled === true));
  assert.ok(sections.every((section) => section.getAttribute("aria-disabled") === "true"));

  await page.chooseBehavior("autoAdd");
  assert.ok(controls().every((control) => control.disabled === false));
  assert.ok(sections.every((section) => section.getAttribute("aria-disabled") === "false"));

  await page.chooseBehavior("openSearchPage");
  assert.ok(controls().every((control) => control.disabled === true));
});
