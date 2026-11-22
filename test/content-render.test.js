"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { FakeDocument, createClock, settle } = require("./helpers/fake-dom.js");

const root = path.resolve(__dirname, "..");
const extensionRoot = path.join(root, "altyazidb-arr-bridge-chrome-0.1.1");
const configSource = fs.readFileSync(path.join(extensionRoot, "src", "config.js"), "utf8");
const contentSource = fs.readFileSync(path.join(extensionRoot, "src", "content.js"), "utf8");

const ROOT_ID = "altyazidb-arr-bridge";
const DETAIL_QUERY_MARKER = ".v2-detail-title";

function createPage({
  url,
  detailMarker = true,
  stored = {},
  storageError = "",
  withOnChanged = false
} = {}) {
  const document = new FakeDocument();
  const clock = createClock();
  const pendingStorage = [];
  const changeListeners = [];
  const storageCalls = { get: 0 };
  let observerCallback = () => {};

  document.title = "Michael (2025) » AltyaziDb";

  const content = document.createElement("div");
  content.id = "dle-content";
  document.body.append(content);

  if (detailMarker) {
    const heading = document.createElement("h1");
    heading.className = "v2-detail-title";
    heading.textContent = "Michael";
    content.append(heading);
  }

  const location = new URL(url);
  const window = {
    location: { href: location.href, pathname: location.pathname },
    addEventListener() {}
  };

  const sandbox = {
    URL,
    console,
    document,
    window,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    MutationObserver: class {
      constructor(callback) {
        observerCallback = callback;
      }

      observe() {}

      disconnect() {}
    },
    chrome: {
      runtime: {
        id: "adb-test-extension",
        lastError: undefined,
        getURL: (asset) => `chrome-extension://adb-test-extension/${asset}`,
        sendMessage() {}
      },
      storage: {
        local: {
          get(defaults, callback) {
            storageCalls.get += 1;
            // Held open so tests can fire mutations while a render is mid-flight.
            // The answer reflects storage when the read started, so a read
            // parked across a settings change returns the old values.
            const snapshot = { ...stored };
            pendingStorage.push(() => {
              if (storageError) {
                // Chrome reports callback failures via runtime.lastError,
                // readable only while the callback runs.
                sandbox.chrome.runtime.lastError = { message: storageError };
                try {
                  callback(undefined);
                } finally {
                  sandbox.chrome.runtime.lastError = undefined;
                }
                return;
              }

              callback({ ...defaults, ...snapshot });
            });
          }
        }
      }
    }
  };

  if (withOnChanged) {
    sandbox.chrome.storage.onChanged = {
      addListener(listener) {
        changeListeners.push(listener);
      }
    };
  }

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(configSource, sandbox, { filename: "config.js" });

  return {
    clock,
    document,
    window,
    sandbox,
    boot() {
      vm.runInContext(contentSource, sandbox, { filename: "content.js" });
    },
    fireMutation(times = 1) {
      for (let index = 0; index < times; index += 1) {
        observerCallback([], null);
      }
    },
    storageCalls,
    changeListeners,
    // Mirrors chrome.storage.local.set + onChanged: only keys whose value
    // differs are reported.
    async changeSettings(values, areaName = "local") {
      const changes = {};

      for (const [key, newValue] of Object.entries(values)) {
        changes[key] = { oldValue: stored[key], newValue };

        if (areaName === "local") {
          stored[key] = newValue;
        }
      }

      changeListeners.forEach((listener) => listener(changes, areaName));
      await settle();
    },
    buttonServices() {
      return this.shells().flatMap((shell) =>
        shell
          .descendants()
          .filter((node) => node.tagName === "BUTTON" && node.dataset.service)
          .map((node) => node.dataset.service)
      );
    },
    async releaseStorage() {
      pendingStorage.splice(0).forEach((resolve) => resolve());
      await settle();
    },
    shells() {
      return document.documentElement
        .descendants()
        .filter((node) => node.id === ROOT_ID);
    },
    detailQueryCount() {
      return document.queries.filter((selector) => selector.includes(DETAIL_QUERY_MARKER))
        .length;
    },
    navigate(nextUrl) {
      const parsed = new URL(nextUrl);
      window.location.href = parsed.href;
      window.location.pathname = parsed.pathname;
    }
  };
}

test("a mutation burst during an in-flight render mounts one shell", async () => {
  const page = createPage({ url: "https://altyazidb.com/film/724-michael.html" });

  page.boot();
  await settle();

  // The first render is parked on storage; every one of these bursts used to
  // start its own render and append a second button row.
  page.fireMutation(6);
  await page.clock.advance(2000);
  page.fireMutation(6);
  await page.clock.advance(2000);

  await page.releaseStorage();
  await page.clock.advance(2000);
  await page.releaseStorage();
  await page.clock.advance(2000);

  assert.equal(page.shells().length, 1);
});

test("pages without detail markup stop retrying instead of polling forever", async () => {
  const page = createPage({
    url: "https://altyazidb.com/detay/mystery.html",
    detailMarker: false
  });

  page.boot();
  await settle();

  for (let round = 0; round < 40; round += 1) {
    page.fireMutation(10);
    await page.clock.advance(2000);
  }

  assert.equal(page.shells().length, 0);
  assert.ok(
    page.detailQueryCount() <= 20,
    `expected at most 20 render attempts, saw ${page.detailQueryCount()}`
  );
});

test("navigation re-arms rendering after the retry budget is spent", async () => {
  const page = createPage({
    url: "https://altyazidb.com/detay/mystery.html",
    detailMarker: false
  });

  page.boot();
  await settle();

  for (let round = 0; round < 40; round += 1) {
    page.fireMutation(10);
    await page.clock.advance(2000);
  }

  const spentAttempts = page.detailQueryCount();
  assert.equal(page.shells().length, 0);

  const heading = page.document.createElement("h1");
  heading.className = "v2-detail-title";
  heading.textContent = "The Boys";
  page.document.getElementById("dle-content").append(heading);
  page.navigate("https://altyazidb.com/dizi/186-the-boys.html");

  page.fireMutation(1);
  await page.clock.advance(1000);
  await page.releaseStorage();
  await page.clock.advance(1000);

  assert.ok(page.detailQueryCount() > spentAttempts, "navigation must retry rendering");
  assert.equal(page.shells().length, 1);
});

async function mountedPage(options) {
  const page = createPage({
    url: "https://altyazidb.com/film/724-michael.html",
    withOnChanged: true,
    ...options
  });

  page.boot();
  await settle();
  await page.releaseStorage();
  await page.clock.advance(2000);
  return page;
}

test("a failed settings read stays within the retry budget", async () => {
  const page = createPage({
    url: "https://altyazidb.com/film/724-michael.html",
    storageError: "Storage unavailable"
  });

  page.boot();
  await settle();

  for (let round = 0; round < 60; round += 1) {
    await page.releaseStorage();
    page.fireMutation(3);
    await page.clock.advance(2000);
  }

  assert.equal(page.shells().length, 0, "no shell is built from settings that were never read");
  assert.ok(page.storageCalls.get > 1, "a failed read is retried");
  assert.ok(
    page.storageCalls.get <= 20,
    `expected at most 20 settings reads, saw ${page.storageCalls.get}`
  );
  assert.equal(page.clock.pending, 0, "no render stays scheduled once the budget is spent");
});

test("turning a search button off rebuilds the open shell without a reload", async () => {
  const page = await mountedPage();

  assert.deepEqual(page.buttonServices(), ["radarr", "prowlarr", "jackett"]);

  await page.changeSettings({ showProwlarrButton: false });
  await page.clock.advance(1000);
  await page.releaseStorage();
  await page.clock.advance(1000);

  assert.equal(page.shells().length, 1);
  assert.deepEqual(page.buttonServices(), ["radarr", "jackett"]);

  await page.changeSettings({ showJackettButton: false, showProwlarrButton: true });
  await page.clock.advance(1000);
  await page.releaseStorage();
  await page.clock.advance(1000);

  assert.equal(page.shells().length, 1);
  assert.deepEqual(page.buttonServices(), ["radarr", "prowlarr"]);
});

test("a button setting changed mid-render still ends with one up-to-date shell", async () => {
  const page = createPage({
    url: "https://altyazidb.com/film/724-michael.html",
    withOnChanged: true
  });

  page.boot();
  await settle();

  // The first read is still parked when the setting flips; its answer may
  // predate the change.
  await page.changeSettings({ showJackettButton: false });
  page.fireMutation(4);
  await page.clock.advance(1000);

  for (let round = 0; round < 3; round += 1) {
    await page.releaseStorage();
    await page.clock.advance(1000);
  }

  assert.equal(page.shells().length, 1);
  assert.deepEqual(page.buttonServices(), ["radarr", "prowlarr"]);
});

test("unrelated or unchanged settings do not rebuild the shell", async () => {
  const page = await mountedPage();
  const [shell] = page.shells();
  const reads = page.storageCalls.get;

  await page.changeSettings({ radarrApiKey: "radarr-key" });
  await page.changeSettings({ showProwlarrButton: true });
  await page.changeSettings({ showProwlarrButton: false }, "sync");
  await page.clock.advance(2000);
  await page.releaseStorage();

  assert.equal(page.storageCalls.get, reads);
  assert.deepEqual(page.shells(), [shell]);
});

test("setting changes mount nothing on pages without detail markup", async () => {
  const page = createPage({
    url: "https://altyazidb.com/detay/mystery.html",
    detailMarker: false,
    withOnChanged: true
  });

  page.boot();
  await settle();

  for (let round = 0; round < 40; round += 1) {
    page.fireMutation(10);
    await page.clock.advance(2000);
  }

  const spentAttempts = page.detailQueryCount();

  await page.changeSettings({ showProwlarrButton: false });
  await page.clock.advance(5000);
  await page.releaseStorage();

  assert.equal(page.shells().length, 0);
  assert.equal(page.storageCalls.get, 0);
  assert.equal(page.detailQueryCount(), spentAttempts, "a settings change must not re-arm polling");
});

test("setting changes mount nothing on blocked pages", async () => {
  const page = createPage({
    url: "https://altyazidb.com/forum/topic-1.html",
    withOnChanged: true
  });

  page.boot();
  await settle();

  for (let round = 0; round < 40; round += 1) {
    page.fireMutation(10);
    await page.clock.advance(2000);
  }

  const spentAttempts = page.detailQueryCount();

  await page.changeSettings({ showJackettButton: false });
  await page.clock.advance(5000);
  await page.releaseStorage();
  await page.clock.advance(2000);

  assert.equal(page.shells().length, 0);
  assert.equal(page.storageCalls.get, 0);
  assert.equal(page.detailQueryCount(), spentAttempts, "blocked pages ignore settings changes");
});

test("the content script still boots without a storage.onChanged API", async () => {
  const page = await mountedPage({ withOnChanged: false });

  assert.equal(page.changeListeners.length, 0);
  assert.equal(page.shells().length, 1);
  assert.deepEqual(page.buttonServices(), ["radarr", "prowlarr", "jackett"]);
});
