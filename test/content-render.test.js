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

function createPage({ url, detailMarker = true } = {}) {
  const document = new FakeDocument();
  const clock = createClock();
  const pendingStorage = [];
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
        getURL: (asset) => `chrome-extension://adb-test-extension/${asset}`,
        sendMessage() {}
      },
      storage: {
        local: {
          get(defaults, callback) {
            // Held open so tests can fire mutations while a render is mid-flight.
            pendingStorage.push(() => callback({ ...defaults }));
          }
        }
      }
    }
  };

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
