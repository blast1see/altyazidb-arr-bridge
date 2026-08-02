/* eslint-disable no-console */
/**
 * Injects the content script into live pages with a stubbed extension API.
 * Set ADB_CHROME_PATH (or CHROME_PATH/PUPPETEER_EXECUTABLE_PATH) when the
 * browser is not installed in a standard location. Optional screenshots may
 * be kept by setting ADB_E2E_ARTIFACT_DIR.
 */
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const puppeteer = require("puppeteer-core");

const REPO = path.resolve(__dirname, "..");
const EXT_DIR = path.join(REPO, "altyazidb-arr-bridge-chrome-0.1.1");
const CONFIG_JS = fs.readFileSync(path.join(EXT_DIR, "src", "config.js"), "utf8");
const CONTENT_JS = fs.readFileSync(path.join(EXT_DIR, "src", "content.js"), "utf8");
const CONTENT_CSS = fs.readFileSync(path.join(EXT_DIR, "styles", "content.css"), "utf8");
const TAMPERMONKEY_JS = fs.readFileSync(
  path.join(REPO, "tampermonkey", "altyazidb-arr-bridge.user.js"),
  "utf8"
);
const UNKNOWN_FIXTURE = pathToFileURL(
  path.join(EXT_DIR, "docs", "test-fixtures", "unknown-detail.html")
).href;
const OPTIONS_PAGE = pathToFileURL(path.join(EXT_DIR, "options.html")).href;

const URLS = [
  {
    label: "forum_topic",
    url: "https://altyazidb.com/forum/moduller-eklentiler/7-altyazidb-arr-bridge-altyazidbyi-radarr-sonarr-prowlarr-ile-eslestiren-tarayici-eklentisi.html",
    expectButtons: false
  },
  { label: "forum_root", url: "https://altyazidb.com/forum/", expectButtons: false },
  { label: "home", url: "https://altyazidb.com/", expectButtons: false },
  { label: "film_michael", url: "https://altyazidb.com/film/724-michael.html", expectButtons: true, mediaType: "movie" },
  { label: "dizi_theboys", url: "https://altyazidb.com/dizi/186-the-boys.html", expectButtons: true, mediaType: "series" },
  { label: "unknown_fixture", url: UNKNOWN_FIXTURE, expectButtons: true, mediaType: "unknown" }
];

const pageBootstrap = `
(function(adbConfigSrc, adbContentSrc, adbCssSrc) {
  globalThis.__adbE2eMessages = [];
  const stub = {
    runtime: {
      sendMessage: (message) => {
        globalThis.__adbE2eMessages.push(message);
        return Promise.resolve({ ok: false, error: "E2E stub: no service request was sent" });
      },
      getURL: (p) => "data:," + encodeURIComponent(p),
      lastError: null,
      id: "adb-e2e-injected"
    },
    storage: {
      local: {
        get: (defaults) => Promise.resolve(defaults || {}),
        set: () => Promise.resolve()
      }
    }
  };
  if (!globalThis.browser) globalThis.browser = stub;
  if (!globalThis.chrome) globalThis.chrome = stub;

  try {
    const style = document.createElement("style");
    style.id = "adb-e2e-injected-css";
    style.textContent = adbCssSrc;
    document.head.appendChild(style);

    const configScript = document.createElement("script");
    configScript.textContent = adbConfigSrc + "\\n//# sourceURL=adb_config_injected.js";
    document.documentElement.appendChild(configScript);
    const contentScript = document.createElement("script");
    contentScript.textContent = adbContentSrc + "\\n//# sourceURL=adb_content_injected.js";
    document.documentElement.appendChild(contentScript);
    return { injected: true };
  } catch (error) {
    return { injected: false, error: String(error) };
  }
})
`;

function browserCandidates() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  return [
    process.env.ADB_CHROME_PATH,
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    localAppData && path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    localAppData && path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean);
}

function findBrowser() {
  const executable = browserCandidates().find((candidate) => fs.existsSync(candidate));
  if (executable) return executable;
  throw new Error("Chrome/Chromium was not found. Set ADB_CHROME_PATH to its executable.");
}

async function waitForShell(page, timeoutMs) {
  const start = Date.now();
  let last = null;

  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate(() => ({
      shell: Boolean(document.getElementById("altyazidb-arr-bridge")),
      buttons: document.querySelectorAll(".adb-arr-button").length,
      mediaType: document.getElementById("altyazidb-arr-bridge")?.dataset?.mediaType || null,
      status: document.querySelector(".adb-arr-status")?.textContent?.trim() || null,
      pathname: location.pathname
    }));
    if (last.shell || last.buttons > 0) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return last;
}

function htmlPage(title, body, metadata = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${metadata}</head><body>${body}</body></html>`;
}

const LOCAL_PARSER_CASES = [
  {
    label: "local_movie_noise",
    path: "/film/501-fixture-movie.html",
    expectedService: "radarr",
    expected: { title: "Fixture Movie", mediaType: "movie", year: 2021, imdbId: "tt0111111", tmdbId: 501 },
    html: htmlPage("Ignored page title - AltyaziDB", `
      <div class="movie-info-card">
        <h1>Fixture Movie</h1>
        <a href="/xfsearch/year/2021">2021</a>
        <a href="https://www.imdb.com/title/tt0111111/">IMDb</a>
        <a href="https://www.themoviedb.org/movie/501">TMDb</a>
      </div>
      <div id="altyazi-merkezi">
        Fake.Release.S09E08.2099.tt0999999
        <a href="https://www.imdb.com/title/tt0999999/">noise IMDb</a>
      </div>
      <div class="comments">Wrong Show S07E06 2088 <a href="https://www.themoviedb.org/tv/999">noise TMDb</a></div>
    `)
  },
  {
    label: "local_series_page_title",
    path: "/dizi/502-fixture-series.html",
    expectedService: "sonarr",
    expected: { title: "Fixture Series", mediaType: "series", tvdbId: 502 },
    html: htmlPage("Fixture Series - AltyaziDB", `
      <div class="fs-action-row"></div>
      <a href="https://thetvdb.com/series/502">TVDb</a>
      <div class="comments">Comment Movie 1999 tt0999999 S04E05</div>
    `)
  },
  {
    label: "local_anime_missing_jsonld",
    path: "/anime-dizileri/503-fixture-anime.html",
    expectedService: "sonarr",
    expected: { title: "Fixture Anime", mediaType: "anime" },
    html: htmlPage(
      "Fallback title - AltyaziDB",
      '<div class="fs-action-row"></div><div id="altyazi-tablosu-alani">Anime.S12E12.2099</div>',
      '<meta property="og:title" content="Fixture Anime - AltyaziDB">'
    )
  },
  {
    label: "local_season",
    path: "/dizi/504-fixture-season.html",
    expectedService: "sonarr",
    expected: { title: "Fixture Show Season 2", mediaType: "season", seasonNumber: 2, episodeNumber: null },
    html: htmlPage("Fixture Show Season 2 - AltyaziDB", '<h1 class="v2-detail-title">Fixture Show Season 2</h1>')
  },
  {
    label: "local_episode",
    path: "/dizi/505-fixture-episode.html",
    expectedService: "sonarr",
    expected: { title: "Fixture Show S02E03", mediaType: "episode", seasonNumber: 2, episodeNumber: 3 },
    html: htmlPage("Fixture Show S02E03 - AltyaziDB", '<h1 class="v2-detail-title">Fixture Show S02E03</h1>')
  },
  {
    label: "local_unknown_detail",
    path: "/detay/506-mystery.html",
    expectedService: "radarr",
    expectedServices: ["radarr", "sonarr", "prowlarr", "jackett"],
    expected: { title: "Mystery Detail", mediaType: "unknown", imdbId: "", tmdbId: "", tvdbId: "" },
    html: htmlPage("Mystery Detail - AltyaziDB", `
      <h1 class="v2-detail-title">Mystery Detail</h1>
      <div id="altyazi-merkezi"><a href="https://www.imdb.com/title/tt0999999/">fake subtitle IMDb</a> Fake.S06E07.2099</div>
      <div class="comments"><a href="https://thetvdb.com/series/999">fake comment TVDb</a></div>
    `)
  }
];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function startParserFixtureServer() {
  const pages = new Map(LOCAL_PARSER_CASES.map((fixture) => [fixture.path, fixture.html]));
  pages.set("/film/507-late.html", htmlPage("Late Fixture - AltyaziDB", '<main id="late-root"></main>'));
  pages.set("/film/508-spa-movie.html", htmlPage("SPA Movie - AltyaziDB", '<div class="fs-action-row"></div><div class="movie-info-card"><h1>SPA Movie</h1></div>'));
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const html = pages.get(pathname);
    response.writeHead(html ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html || "Not found");
  });
  const address = await listen(server);
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function injectContent(page) {
  return page.evaluate(
    (bootstrap, config, content, css) => eval(bootstrap)(config, content, css), // eslint-disable-line no-eval
    pageBootstrap,
    CONFIG_JS,
    CONTENT_JS,
    CONTENT_CSS
  );
}

async function capturedMedia(page, service) {
  await page.click(`.adb-arr-button-${service}`);
  await page.waitForFunction(() => globalThis.__adbE2eMessages?.some((message) => message.type === "ADB_LOOKUP"), { timeout: 3000 });
  return page.evaluate(() => globalThis.__adbE2eMessages.findLast((message) => message.type === "ADB_LOOKUP")?.media || null);
}

async function verifyLocalParserFixtures(browser, fixtureBaseUrl) {
  for (const fixture of LOCAL_PARSER_CASES) {
    const page = await browser.newPage();
    const runtimeErrors = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    try {
      await page.goto(`${fixtureBaseUrl}${fixture.path}`, { waitUntil: "load", timeout: 10000 });
      await injectContent(page);
      const snapshot = await waitForShell(page, 5000);
      const shell = await page.evaluate(() => ({
        count: document.querySelectorAll("#altyazidb-arr-bridge").length,
        services: Array.from(document.querySelectorAll(".adb-arr-button"), (button) => button.dataset.service)
      }));
      const media = await capturedMedia(page, fixture.expectedService);

      for (const [key, expected] of Object.entries(fixture.expected)) {
        if (media?.[key] !== expected) {
          throw new Error(`${fixture.label}: expected media.${key}=${JSON.stringify(expected)}, got ${JSON.stringify(media?.[key])}`);
        }
      }

      if (!snapshot?.shell || shell.count !== 1) throw new Error(`${fixture.label}: expected exactly one shell`);
      if (fixture.expectedServices && JSON.stringify(shell.services) !== JSON.stringify(fixture.expectedServices)) {
        throw new Error(`${fixture.label}: unexpected services ${JSON.stringify(shell.services)}`);
      }
      if (runtimeErrors.length) throw new Error(`${fixture.label}: ${runtimeErrors.join(" | ")}`);
      console.log(`\n== ${fixture.label} == PASS`);
    } finally {
      await page.close();
    }
  }

  const latePage = await browser.newPage();
  const lateErrors = [];
  latePage.on("pageerror", (error) => lateErrors.push(error.message));
  try {
    await latePage.goto(`${fixtureBaseUrl}/film/507-late.html`, { waitUntil: "load", timeout: 10000 });
    const injection = await injectContent(latePage);
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (await latePage.$("#altyazidb-arr-bridge")) throw new Error("Late DOM shell rendered before a detail marker existed");
    await latePage.evaluate(() => {
      document.getElementById("late-root").innerHTML = '<div class="fs-action-row"></div><div class="movie-info-card"><h1>Late Fixture</h1><a href="https://www.imdb.com/title/tt0111112/">IMDb</a></div>';
    });
    const snapshot = await waitForShell(latePage, 5000);
    const count = await latePage.$$eval("#altyazidb-arr-bridge", (nodes) => nodes.length);
    if (!snapshot?.shell || snapshot.mediaType !== "movie" || count !== 1) {
      const debug = await latePage.evaluate(() => ({
        marker: Boolean(document.querySelector(".movie-info-card")),
        likely: globalThis.AdbArrConfig?.isLikelyDetailPage(location.pathname, Boolean(document.querySelector(".movie-info-card"))),
        readyState: document.readyState,
        body: document.body.innerHTML
      }));
      throw new Error(`Late DOM did not render exactly one movie shell: ${JSON.stringify({ injection, snapshot, count, lateErrors, debug })}`);
    }
    console.log("\n== local_late_dom == PASS");
  } finally {
    await latePage.close();
  }

  const spaPage = await browser.newPage();
  try {
    await spaPage.goto(`${fixtureBaseUrl}/film/508-spa-movie.html`, { waitUntil: "load", timeout: 10000 });
    await injectContent(spaPage);
    const initial = await waitForShell(spaPage, 5000);
    if (initial?.mediaType !== "movie") throw new Error("SPA fixture did not start as a movie");
    await spaPage.evaluate(() => {
      history.pushState({}, "", "/dizi/508-spa-series.html");
      document.title = "SPA Series - AltyaziDB";
      document.querySelector(".movie-info-card").innerHTML = '<h1>SPA Series</h1><a href="https://thetvdb.com/series/508">TVDb</a>';
    });
    await spaPage.waitForFunction(() => {
      const shell = document.getElementById("altyazidb-arr-bridge");
      return shell?.dataset.mediaType === "series" && shell.dataset.sourceUrl.includes("/dizi/508-spa-series.html");
    }, { timeout: 5000 });
    const state = await spaPage.evaluate(() => ({
      count: document.querySelectorAll("#altyazidb-arr-bridge").length,
      services: Array.from(document.querySelectorAll(".adb-arr-button"), (button) => button.dataset.service)
    }));
    if (state.count !== 1 || !state.services.includes("sonarr") || state.services.includes("radarr")) {
      throw new Error(`SPA rerender mismatch: ${JSON.stringify(state)}`);
    }
    console.log("\n== local_spa_navigation == PASS");
  } finally {
    await spaPage.close();
  }
}

async function verifyOptionsKeyPrivacy(browser) {
  const page = await browser.newPage();
  const secrets = {
    radarrApiKey: "radarr-options-secret",
    sonarrApiKey: "sonarr-options-secret",
    prowlarrApiKey: "prowlarr-options-secret",
    jackettApiKey: "jackett-options-secret"
  };

  try {
    await page.evaluateOnNewDocument((storedSecrets) => {
      globalThis.__adbOptionsState = {
        ...storedSecrets,
        radarrBaseUrl: "https://arr.example.test/radarr",
        sonarrBaseUrl: "https://arr.example.test/sonarr",
        prowlarrBaseUrl: "https://arr.example.test/prowlarr",
        jackettBaseUrl: "https://arr.example.test/jackett"
      };
      globalThis.__adbOptionsWrites = [];
      globalThis.browser = {
        runtime: {
          id: "adb-options-e2e",
          sendMessage: async (message) => ({
            ok: true,
            message: `${message.service || "service"} test stub`,
            rootFolders: [],
            qualityProfiles: []
          })
        },
        storage: {
          local: {
            get: async (defaults) => ({ ...defaults, ...globalThis.__adbOptionsState }),
            set: async (values) => {
              globalThis.__adbOptionsState = { ...globalThis.__adbOptionsState, ...values };
              globalThis.__adbOptionsWrites.push(structuredClone(globalThis.__adbOptionsState));
            }
          }
        },
        permissions: {
          contains: async () => true,
          request: async () => true
        }
      };
    }, secrets);
    await page.goto(OPTIONS_PAGE, { waitUntil: "load", timeout: 10000 });
    await page.waitForFunction(() => document.getElementById("radarrBaseUrl")?.value === "https://arr.example.test/radarr", { timeout: 5000 });

    const initial = await page.evaluate((storedSecrets) => ({
      secretInDom: Object.values(storedSecrets).some((secret) => document.documentElement.innerHTML.includes(secret)),
      keyValues: ["radarr", "sonarr", "prowlarr", "jackett"].map((service) => document.getElementById(`${service}ApiKey`).value),
      clearControls: document.querySelectorAll("[data-clear-api-key]").length
    }), secrets);

    const submit = () => page.evaluate(async () => {
      const previousWrites = globalThis.__adbOptionsWrites.length;
      document.getElementById("optionsForm").requestSubmit();
      const started = Date.now();
      while (globalThis.__adbOptionsWrites.length === previousWrites) {
        if (Date.now() - started > 3000) throw new Error("Options save timed out");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      return structuredClone(globalThis.__adbOptionsState);
    });

    await page.$eval("#radarrBaseUrl", (input) => { input.value = "https://arr.example.test/apps/radarr/"; });
    const afterUnrelatedChange = await submit();
    const clearDisabled = await page.$eval("#clearSonarrApiKey", (input) => {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return document.getElementById("sonarrApiKey").disabled;
    });
    const afterDelete = await submit();
    await page.$eval("#prowlarrApiKey", (input) => { input.value = "prowlarr-options-replacement"; });
    const afterReplacement = await submit();
    const finalDom = await page.evaluate((allSecrets) => ({
      secretInDom: [...Object.values(allSecrets), "prowlarr-options-replacement"].some((secret) => document.documentElement.innerHTML.includes(secret)),
      keyValues: ["radarr", "sonarr", "prowlarr", "jackett"].map((service) => document.getElementById(`${service}ApiKey`).value)
    }), secrets);

    const preserved = Object.entries(secrets).every(([key, value]) => afterUnrelatedChange[key] === value);
    const independentDelete = afterDelete.sonarrApiKey === "" &&
      afterDelete.radarrApiKey === secrets.radarrApiKey &&
      afterDelete.prowlarrApiKey === secrets.prowlarrApiKey &&
      afterDelete.jackettApiKey === secrets.jackettApiKey;
    const independentReplacement = afterReplacement.prowlarrApiKey === "prowlarr-options-replacement" &&
      afterReplacement.radarrApiKey === secrets.radarrApiKey &&
      afterReplacement.sonarrApiKey === "" &&
      afterReplacement.jackettApiKey === secrets.jackettApiKey;
    const pass = !initial.secretInDom &&
      initial.keyValues.every((value) => value === "") &&
      initial.clearControls === 4 &&
      afterUnrelatedChange.radarrBaseUrl === "https://arr.example.test/apps/radarr" &&
      preserved && clearDisabled && independentDelete && independentReplacement &&
      !finalDom.secretInDom && finalDom.keyValues.every((value) => value === "");
    const checks = {
      initialDomSafe: !initial.secretInDom && initial.keyValues.every((value) => value === ""),
      clearControls: initial.clearControls === 4,
      unrelatedChangePreserved: preserved,
      deleteIndependent: clearDisabled && independentDelete,
      replacementIndependent: independentReplacement,
      finalDomSafe: !finalDom.secretInDom && finalDom.keyValues.every((value) => value === "")
    };

    console.log(`\n== extension_options_key_privacy == ${pass ? "PASS" : "FAIL"}`);
    if (!pass) {
      throw new Error(`Options API-key behavior mismatch: ${JSON.stringify(checks)}`);
    }
  } finally {
    await page.close();
  }
}

async function verifyTampermonkeyKeyPrivacy(browser) {
  const page = await browser.newPage();
  const secrets = ["radarr-dom-secret", "sonarr-dom-secret", "prowlarr-dom-secret", "jackett-dom-secret"];

  try {
    await page.goto(UNKNOWN_FIXTURE, { waitUntil: "load", timeout: 10000 });
    await page.evaluate((userscript, storedSecrets) => {
      globalThis.__adbTmState = {
        radarrApiKey: storedSecrets[0],
        sonarrApiKey: storedSecrets[1],
        prowlarrApiKey: storedSecrets[2],
        jackettApiKey: storedSecrets[3]
      };
      globalThis.__adbTmWrites = [];
      globalThis.GM_getValue = () => Promise.resolve(structuredClone(globalThis.__adbTmState));
      globalThis.GM_setValue = (_key, value) => {
        globalThis.__adbTmState = structuredClone(value);
        globalThis.__adbTmWrites.push(structuredClone(value));
        return Promise.resolve();
      };
      globalThis.GM_xmlhttpRequest = () => {};
      globalThis.GM_openInTab = () => {};
      globalThis.GM_registerMenuCommand = (label, handler) => {
        if (label === "AltyaziDB Arr Bridge settings") globalThis.__adbSettingsMenu = handler;
      };

      // The settings panel mounts in a closed shadow root, so the harness has
      // to capture the root at creation time. Page scripts cannot do this after
      // the fact, which is exactly the property the assertions below check.
      const nativeAttachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function attachShadow(init) {
        const root = nativeAttachShadow.call(this, init);
        if (init?.mode === "closed") globalThis.__adbShadow = root;
        return root;
      };

      const script = document.createElement("script");
      script.textContent = userscript;
      document.documentElement.appendChild(script);
      globalThis.__adbSettingsMenu();
    }, TAMPERMONKEY_JS, secrets);

    await page.waitForFunction(
      () => Boolean(globalThis.__adbShadow?.querySelector(".adb-tm-options-backdrop")),
      { timeout: 10000 }
    );
    const result = await page.evaluate(async (storedSecrets) => {
      const root = globalThis.__adbShadow;
      const keySelector = [
        "#adbRadarrApiKey",
        "#adbSonarrApiKey",
        "#adbProwlarrApiKey",
        "#adbJackettApiKey"
      ].join(",");
      const host = document.getElementById("altyazidb-arr-bridge-tm-options");
      const isolation = {
        hostPresent: Boolean(host),
        // A closed root keeps both of these unreachable from page scripts.
        shadowRootExposed: Boolean(host?.shadowRoot),
        panelInPageDom: Boolean(
          document.querySelector(keySelector) ||
          document.querySelector(".adb-tm-options-backdrop")
        )
      };
      const initial = {
        secretInDom: storedSecrets.some(
          (secret) =>
            document.documentElement.innerHTML.includes(secret) ||
            root.innerHTML.includes(secret)
        ),
        keyValues: Array.from(root.querySelectorAll(keySelector), (input) => input.value),
        clearControls: root.querySelectorAll('input[id^="adbClear"][id$="ApiKey"]').length
      };
      const save = async () => {
        const previousWrites = globalThis.__adbTmWrites.length;
        root.querySelector("[data-save]").click();
        const started = Date.now();
        while (globalThis.__adbTmWrites.length === previousWrites) {
          if (Date.now() - started > 3000) throw new Error("Tampermonkey save timed out");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        return structuredClone(globalThis.__adbTmState);
      };

      root.querySelector("#adbRadarrBaseUrl").value = "https://arr.example.test/apps/radarr/";
      const afterUnrelatedChange = await save();
      const clearControl = root.querySelector("#adbClearRadarrApiKey");
      clearControl.checked = true;
      clearControl.dispatchEvent(new Event("change", { bubbles: true }));
      const clearDisabled = root.querySelector("#adbRadarrApiKey").disabled;
      const afterDelete = await save();
      root.querySelector("#adbJackettApiKey").value = "jackett-dom-replacement";
      const afterReplacement = await save();
      const finalDom = {
        secretInDom: [...storedSecrets, "jackett-dom-replacement"].some(
          (secret) =>
            document.documentElement.innerHTML.includes(secret) ||
            root.innerHTML.includes(secret)
        ),
        keyValues: Array.from(root.querySelectorAll(keySelector), (input) => input.value)
      };

      return {
        isolation,
        initial,
        afterUnrelatedChange,
        clearDisabled,
        afterDelete,
        afterReplacement,
        finalDom
      };
    }, secrets);

    const preserved = result.afterUnrelatedChange.radarrApiKey === secrets[0] &&
      result.afterUnrelatedChange.sonarrApiKey === secrets[1] &&
      result.afterUnrelatedChange.prowlarrApiKey === secrets[2] &&
      result.afterUnrelatedChange.jackettApiKey === secrets[3];
    const independentDelete = result.afterDelete.radarrApiKey === "" &&
      result.afterDelete.sonarrApiKey === secrets[1] &&
      result.afterDelete.prowlarrApiKey === secrets[2] &&
      result.afterDelete.jackettApiKey === secrets[3];
    const independentReplacement = result.afterReplacement.radarrApiKey === "" &&
      result.afterReplacement.sonarrApiKey === secrets[1] &&
      result.afterReplacement.prowlarrApiKey === secrets[2] &&
      result.afterReplacement.jackettApiKey === "jackett-dom-replacement";
    const shadowIsolated = result.isolation.hostPresent &&
      !result.isolation.shadowRootExposed &&
      !result.isolation.panelInPageDom;
    const pass = shadowIsolated &&
      !result.initial.secretInDom &&
      result.initial.keyValues.length === 4 &&
      result.initial.keyValues.every((value) => value === "") &&
      result.initial.clearControls === 4 &&
      result.afterUnrelatedChange.radarrBaseUrl === "https://arr.example.test/apps/radarr" &&
      preserved && result.clearDisabled && independentDelete && independentReplacement &&
      !result.finalDom.secretInDom && result.finalDom.keyValues.every((value) => value === "");
    const checks = {
      shadowIsolated,
      initialDomSafe: !result.initial.secretInDom && result.initial.keyValues.every((value) => value === ""),
      clearControls: result.initial.clearControls === 4,
      unrelatedChangePreserved: preserved,
      deleteIndependent: result.clearDisabled && independentDelete,
      replacementIndependent: independentReplacement,
      finalDomSafe: !result.finalDom.secretInDom && result.finalDom.keyValues.every((value) => value === "")
    };
    console.log(`\n== tampermonkey_key_privacy == ${pass ? "PASS" : "FAIL"}`);
    console.log("  checks:", JSON.stringify(checks));

    if (!pass) throw new Error("Tampermonkey API-key preserve/delete behavior failed");
  } finally {
    await page.close();
  }
}

async function verifyBrowserRedirectPolicy(browser) {
  const targetRequests = [];
  const followedPaths = [];
  const targetServer = http.createServer((request, response) => {
    targetRequests.push({ url: request.url, apiKey: request.headers["x-api-key"] || "" });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });
  const targetAddress = await listen(targetServer);
  const targetBase = `http://127.0.0.1:${targetAddress.port}`;
  const sourceServer = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const redirects = {
      "/redirect/trailing": "/redirect/trailing/",
      "/redirect/path": "/redirect/final",
      "/redirect/http-to-https": "https://127.0.0.1/secure",
      "/redirect/cross-origin": `${targetBase}/capture`,
      "/redirect/keyed-cross-origin": `${targetBase}/capture-keyed`
    };

    if (redirects[pathname]) {
      response.writeHead(302, { Location: redirects[pathname] });
      response.end();
      return;
    }

    if (["/redirect/trailing/", "/redirect/final", "/secure"].includes(pathname)) {
      followedPaths.push({ path: pathname, apiKey: request.headers["x-api-key"] || "" });
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Redirect policy fixture</title>");
  });
  const sourceAddress = await listen(sourceServer);
  const sourceBase = `http://127.0.0.1:${sourceAddress.port}`;
  const page = await browser.newPage();

  try {
    await page.goto(sourceBase, { waitUntil: "load", timeout: 10000 });
    const results = await page.evaluate(async (baseUrl) => {
      const cases = [
        ["same-origin trailing slash", "/redirect/trailing", ""],
        ["same-origin path", "/redirect/path", ""],
        ["HTTP to HTTPS", "/redirect/http-to-https", ""],
        ["different origin", "/redirect/cross-origin", ""],
        ["keyed cross-origin", "/redirect/keyed-cross-origin", "browser-redirect-secret"]
      ];
      const output = [];

      for (const [name, pathname, apiKey] of cases) {
        try {
          await fetch(`${baseUrl}${pathname}`, {
            redirect: "error",
            headers: apiKey ? { "X-Api-Key": apiKey } : {}
          });
          output.push({ name, rejected: false, error: "" });
        } catch (error) {
          output.push({ name, rejected: true, error: String(error) });
        }
      }

      return output;
    }, sourceBase);

    const pass = results.length === 5 &&
      results.every((result) => result.rejected) &&
      followedPaths.length === 0 &&
      targetRequests.length === 0;
    console.log(`\n== chromium_redirect_policy == ${pass ? "PASS" : "FAIL"}`);
    console.log("  result:", JSON.stringify({ results, followedPaths, targetRequests }));
    if (!pass) throw new Error("Chromium followed a redirect that should have been rejected");
  } finally {
    await page.close();
    await closeServer(sourceServer);
    await closeServer(targetServer);
  }
}

async function main() {
  const executablePath = findBrowser();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adb-e2e-"));
  const userDataDir = path.join(tempRoot, "profile");
  const configuredArtifacts = process.env.ADB_E2E_ARTIFACT_DIR;
  const artifactDir = configuredArtifacts ? path.resolve(configuredArtifacts) : path.join(tempRoot, "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });

  let browser;
  let fixtureServer;
  const results = [];

  try {
    console.log("Browser:", executablePath);
    console.log("Extension source dir:", EXT_DIR);
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      defaultViewport: { width: 1366, height: 900 },
      userDataDir,
      args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check"]
    });

    const fixtures = await startParserFixtureServer();
    fixtureServer = fixtures.server;
    await verifyLocalParserFixtures(browser, fixtures.baseUrl);
    await verifyBrowserRedirectPolicy(browser);
    await verifyOptionsKeyPrivacy(browser);
    await verifyTampermonkeyKeyPrivacy(browser);

    for (const target of URLS) {
      const page = await browser.newPage();
      const consoleMessages = [];
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type())) {
          consoleMessages.push(`[${message.type()}] ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => consoleMessages.push(`[pageerror] ${error.message}`));

      console.log(`\n== ${target.label} == ${target.url}`);
      let navigationError = null;
      try {
        await page.goto(target.url, {
          waitUntil: target.url.startsWith("file:") ? "load" : "networkidle2",
          timeout: 45000
        });
      } catch (error) {
        navigationError = error;
        console.log("  goto warning:", error.message);
      }

      if (navigationError && target.url.startsWith("http") && /net::ERR_|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i.test(navigationError.message)) {
        console.log("  SKIP (network): live page could not be loaded");
        results.push({ ...target, buttons: 0, mediaType: null, skipped: true, pass: true });
        await page.close();
        continue;
      }

      const injection = await injectContent(page);
      console.log("  inject:", JSON.stringify(injection));

      const snapshot = await waitForShell(page, target.expectButtons ? 30000 : 1200);
      const pass = target.expectButtons
        ? Boolean(snapshot?.shell && snapshot.buttons > 0 && (!target.mediaType || snapshot.mediaType === target.mediaType))
        : Boolean(!snapshot?.shell && (snapshot?.buttons ?? 0) === 0);

      let screenshot = "";
      if (!pass || configuredArtifacts) {
        screenshot = path.join(artifactDir, `inject_${target.label}.png`);
        await page.screenshot({ path: screenshot, fullPage: false }).catch((error) => {
          console.log("  screenshot warning:", error.message);
        });
      }

      console.log("  snap:", JSON.stringify(snapshot));
      if (consoleMessages.length) console.log("  console:", consoleMessages.slice(0, 8).join(" | "));
      console.log(" ", pass ? "PASS" : "FAIL");
      results.push({ ...target, ...snapshot, screenshot, pass });
      await page.close();
    }

    console.log("\n==== SUMMARY ====");
    for (const result of results) {
      console.log(
        `${result.label.padEnd(18)} ${(result.expectButtons ? "render" : "skip").padEnd(8)} ` +
        `buttons=${String(result.buttons ?? 0).padEnd(2)} type=${result.mediaType || "-"} ${result.skipped ? "SKIP (network)" : result.pass ? "PASS" : "FAIL"}`
      );
    }

    if (!results.every((result) => result.pass)) {
      throw new Error("One or more E2E cases failed");
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (fixtureServer?.listening) await closeServer(fixtureServer).catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    if (!configuredArtifacts) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
