"use strict";

// The Tampermonkey userscript is a hand-maintained copy of the extension's
// logic. This test runs the userscript's pure functions and the extension's
// AdbArrConfig / background.js counterparts on the same input vectors and
// requires identical output, so a fix that lands in only one of them fails.
//
// The userscript is an IIFE with no exports. It hands its functions to a
// test-only hook (globalThis.__ADB_ARR_TEST_HOOK__) that it calls only when
// GM_info is absent, which never happens in a real userscript manager. Both
// sides load in node:vm with a minimal fake window/document and fake GM_* or
// browser.* APIs; no source text is sliced.
//
// ADB_ARR_USERSCRIPT_PATH may point at another copy of the userscript (used to
// check that reverting a ported fix turns this test red).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const extensionRoot = path.join(root, "altyazidb-arr-bridge-chrome-0.1.1");
const userscriptPath = process.env.ADB_ARR_USERSCRIPT_PATH
  ? path.resolve(process.env.ADB_ARR_USERSCRIPT_PATH)
  : path.join(root, "tampermonkey", "altyazidb-arr-bridge.user.js");
const userscriptSource = fs.readFileSync(userscriptPath, "utf8");
const configSource = fs.readFileSync(path.join(extensionRoot, "src", "config.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(extensionRoot, "src", "background.js"), "utf8");
const mediaFixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "media-pages.json"), "utf8")
);

// Both sides fall back to document.title for search titles, so both get the
// same page title.
const PAGE_TITLE = "Sayfa Başlığı - AltyaziDb";

// Deliberate, named differences between the userscript and the extension.
// Every entry must still diverge on at least one vector (checked below), so a
// stale entry fails instead of silently hiding a regression. Keys are the
// parity check names used in this file.
const KNOWN_DIVERGENCES = new Map([]);

// Values from two vm realms have different prototypes; compare plain data.
function plain(value) {
  if (value === undefined) {
    return "<undefined>";
  }

  return JSON.parse(JSON.stringify(value));
}

function fakeDocument() {
  return {
    title: PAGE_TITLE,
    // "loading" keeps the userscript from booting its page renderer.
    readyState: "loading",
    documentElement: null,
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      return null;
    }
  };
}

function loadUserscript({ gmInfo = false, hook = true, gmRequest, storedValue } = {}) {
  let api = null;
  let storageReads = 0;
  const openedTabs = [];
  const requests = [];
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    document: fakeDocument(),
    window: {
      location: { pathname: "/", href: "https://altyazidb.com/" },
      addEventListener() {},
      open(url) {
        openedTabs.push(url);
      }
    },
    GM_getValue: (_key, fallback) => {
      storageReads += 1;
      return storedValue ?? fallback;
    },
    GM_setValue: () => undefined,
    GM_openInTab(url) {
      openedTabs.push(url);
    },
    GM_xmlhttpRequest(details) {
      requests.push({ method: details.method, url: details.url, data: details.data });
      const reply = gmRequest
        ? gmRequest(details)
        : { status: 200, responseText: "[]" };
      queueMicrotask(() => details.onload({ finalUrl: details.url, ...reply }));
    }
  };

  if (gmInfo) {
    sandbox.GM_info = { script: { version: "test" } };
  }

  if (hook) {
    sandbox.__ADB_ARR_TEST_HOOK__ = (value) => {
      api = value;
    };
  }

  vm.createContext(sandbox);
  vm.runInContext(userscriptSource, sandbox, { filename: "altyazidb-arr-bridge.user.js" });
  return {
    api,
    openedTabs,
    requests,
    get storageReads() {
      return storageReads;
    }
  };
}

function loadExtension({ settings = {}, fetchImpl } = {}) {
  const openedTabs = [];
  const requests = [];
  let messageHandler;
  const browserApi = {
    runtime: {
      id: "adb-parity-extension",
      getURL: (pathname = "") => `moz-extension://adb-parity-extension/${pathname}`,
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageHandler = listener;
        }
      }
    },
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, ...settings }),
        set: async () => undefined
      }
    },
    tabs: {
      create: async ({ url }) => {
        openedTabs.push(url);
        return { url };
      }
    },
    permissions: { contains: async () => true }
  };
  const sandbox = {
    AbortController,
    URL,
    console,
    setTimeout,
    clearTimeout,
    document: { title: PAGE_TITLE },
    browser: browserApi,
    fetch: async (url, options = {}) => {
      requests.push({ method: options.method || "GET", url: String(url), body: options.body });
      const reply = fetchImpl ? fetchImpl(String(url), options) : { status: 200, body: [] };
      const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        url: String(url),
        text: async () => text
      };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(configSource, sandbox, { filename: "config.js" });
  vm.runInContext(backgroundSource, sandbox, { filename: "background.js" });

  return {
    config: sandbox.AdbArrConfig,
    // Top-level function declarations of a classic script become globals.
    background: sandbox,
    openedTabs,
    requests,
    send: (message) => messageHandler(message, { id: browserApi.runtime.id })
  };
}

const userscript = loadUserscript().api;
const extension = loadExtension();
const config = extension.config;
const divergenceHits = new Map();

function parity(t, name, vectors, userscriptFn, extensionFn) {
  const known = KNOWN_DIVERGENCES.get(name);
  let mismatches = 0;

  for (const vector of vectors) {
    const actual = plain(userscriptFn(...vector));
    const expected = plain(extensionFn(...vector));

    if (known) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatches += 1;
      }
      continue;
    }

    assert.deepEqual(
      actual,
      expected,
      `${name}(${JSON.stringify(vector)}): userscript differs from the extension`
    );
  }

  if (known) {
    divergenceHits.set(name, (divergenceHits.get(name) || 0) + mismatches);
    t.diagnostic(`known divergence "${name}": ${known}`);
  }

  return vectors.length;
}

let vectorCount = 0;

test("the test hook is the only exposure and carries no settings or keys", async (t) => {
  await t.test("a real userscript manager (GM_info defined) never calls the hook", () => {
    assert.equal(loadUserscript({ gmInfo: true }).api, null);
  });

  await t.test("without a hook nothing is exposed and loading has no side effects", () => {
    const loaded = loadUserscript({ hook: false });
    assert.equal(loaded.api, null);
    assert.deepEqual(loaded.requests, []);
    assert.deepEqual(loaded.openedTabs, []);
  });

  await t.test("the payload is frozen, holds functions only, and never reads storage", () => {
    assert.ok(userscript, "userscript did not call the test hook");
    assert.ok(Object.isFrozen(userscript));

    for (const [key, value] of Object.entries(userscript)) {
      assert.equal(typeof value, "function", `${key} is not a function`);
    }

    // Functions do not serialize, so any data value would show up here.
    assert.equal(JSON.stringify(userscript), "{}");
    const loaded = loadUserscript({ storedValue: { radarrApiKey: "sentinel-stored-key" } });
    assert.equal(loaded.storageReads, 0, "loading the userscript read stored settings");
    assert.doesNotMatch(JSON.stringify(Object.keys(loaded.api)), /sentinel/);
  });
});

const SEASON_EPISODE_VECTORS = [
  ...mediaFixtures.map((fixture) => [fixture.pathname, fixture.title]),
  ["/film/45-x2.html", "X2"],
  ["/film/45-x2.html", "X2 - AltyaziDB"],
  ["/film/12-5x2.html", "5x2 - AltyaziDB"],
  ["/film/12-5x2.html", "5x2"],
  ["/anime-filmleri/45-x2.html", "X2"],
  ["/animasyon-filmleri/45-x2.html", "X2"],
  ["/asya-filmleri/45-x2.html", "X2"],
  ["/belgesel-filmleri/45-x2.html", "X2"],
  ["/dizi/45-x2.html", "X2"],
  ["/dizi/45-show-1x03.html", "Show"],
  ["/dizi/45-show.html", "Show 2x05 - AltyaziDB"],
  ["/dizi/45-5x2.html", "5x2"],
  ["/dizi/10-dark.html", "Dark Sezon 2 Bölüm 3"],
  ["/dizi/10-dark.html", "Dark 2. Sezon 3. Bölüm"],
  ["/dizi/10-dark.html", "Dark Season 3"],
  ["/dizi/10-dark.html", "Dark Episode 4"],
  ["/dizi/7-cilgin-kiz.html", "Çılgın Kız S02E03"],
  ["/tv-programlari/3-show.html", "Show S1E2"],
  ["/detay/mystery.html", "Mystery S01E02"],
  ["/detay/mystery.html", "Mystery"],
  ["/dizi/%E0%A4%A-show.html", "Show S01E02"],
  ["", ""],
  [undefined, undefined]
];

test("season and episode detection matches the extension", (t) => {
  vectorCount += parity(
    t,
    "detectSeasonEpisode",
    SEASON_EPISODE_VECTORS,
    userscript.detectSeasonEpisode,
    config.detectSeasonEpisode
  );
});

test("media type detection matches the extension", (t) => {
  const fromPage = SEASON_EPISODE_VECTORS.map(([pathname, title]) => {
    const seasonEpisode = config.detectSeasonEpisode(pathname, title);
    return [{ pathname, ...plain(seasonEpisode) }];
  });
  const fromSignals = [
    [{ pathname: "/detay/x.html", breadcrumbs: "Anasayfa Film" }],
    [{ pathname: "/detay/x.html", breadcrumbs: "Anime Diziler" }],
    [{ pathname: "/detay/x.html", breadcrumbs: "Dizi", seasonNumber: 2 }],
    [{ pathname: "/detay/x.html", schemaTypes: "Movie" }],
    [{ pathname: "/detay/x.html", schemaTypes: "TVSeries", episodeNumber: 3, seasonNumber: 1 }],
    [{ pathname: "/detay/x.html", tmdbType: "movie" }],
    [{ pathname: "/detay/x.html", tmdbType: "tv" }],
    [{ pathname: "/detay/x.html", episodeNumber: 5 }],
    [{ pathname: "/detay/x.html" }],
    [{}],
    [undefined]
  ];

  vectorCount += parity(
    t,
    "detectMediaType",
    [...fromPage, ...fromSignals],
    userscript.detectMediaType,
    config.detectMediaType
  );
});

test("year selection matches the extension", (t) => {
  const nextYear = new Date().getFullYear() + 1;
  const vectors = [
    [{ detailYears: ["2019"], jsonLdYears: ["2019-07-26"], titleValues: ["The Boys 2019"] }],
    [{ detailYears: [], jsonLdYears: ["2024-01-10"], titleValues: ["Example Show"] }],
    [{ titleValues: ["Example Show"] }],
    [{ titleValues: ["Blade Runner 2049"] }],
    [{ titleValues: ["Blade Runner 2049 Türkçe Altyazı"] }],
    [{ titleValues: ["Blade Runner 2049 (2017) - AltyaziDB"] }],
    [{ titleValues: ["2001: A Space Odyssey (1968)"] }],
    [{ titleValues: ["Wonder Woman 1984", "Wonder Woman 1984 (2020)"] }],
    [{ titleValues: ["Dark (2017-2020)"] }],
    [{ titleValues: [`Upcoming (${nextYear})`] }],
    [{ titleValues: [`Far Away (${nextYear + 1})`] }],
    [{ detailYears: [String(nextYear + 1)], titleValues: ["Far Away (1999)"] }],
    [{ jsonLdYears: ["2049-01-01"], titleValues: ["Blade Runner 2049"] }],
    [{ detailYears: ["1895"] }],
    [{ detailYears: ["Yapım yılı: 2101"] }],
    [{ titleValues: ["", null, "Movie (1999)"] }],
    [{}],
    [undefined]
  ];

  vectorCount += parity(t, "yearFromSignals", vectors, userscript.yearFromSignals, config.yearFromSignals);
});

test("page gate matches the extension", (t) => {
  const paths = [
    "/",
    "/index.html",
    "/index.php",
    "/register.html",
    "/login.php",
    "/forum/topic.html",
    "/user/someone/",
    "/search/?q=x",
    "/admin.php",
    "/xfsearch/year/2020/",
    "/xfsearch/genre/drama/page/2/",
    "/tags/drama/",
    "/page/3/",
    "/film/",
    "/film",
    "/dizi/",
    "/anime-dizileri/",
    "/film/page/2/",
    "/tv-programlari/page/10",
    "/film/724-michael.html",
    "/film/45-x2.html",
    "/dizi/45-x2.html",
    "/dizi/186-the-boys.html",
    "/detay/mystery.html",
    "/filmler/",
    "",
    undefined
  ];

  vectorCount += parity(
    t,
    "isBlockedPagePath",
    paths.map((pathname) => [pathname]),
    userscript.isBlockedPagePath,
    config.isBlockedPagePath
  );
  vectorCount += parity(
    t,
    "isLikelyDetailPage",
    paths.flatMap((pathname) => [[pathname, true], [pathname, false]]),
    userscript.isLikelyDetailPage,
    config.isLikelyDetailPage
  );
});

const MEDIA_VECTORS = [
  { title: "5x2", year: 2004, mediaType: "movie", seasonNumber: 5, episodeNumber: 2 },
  { title: "5x2", year: 2004, mediaType: "movie", seasonNumber: 5, episodeNumber: null },
  { title: "X2", year: 2003, mediaType: "movie", seasonNumber: 45, episodeNumber: 2, tmdbId: 36658, tmdbType: "movie" },
  { title: "The Boys", year: 2019, mediaType: "episode", seasonNumber: 5, episodeNumber: 8 },
  { title: "The Boys", year: 2019, mediaType: "season", seasonNumber: 5, episodeNumber: null },
  { title: "The Boys", year: 2019, mediaType: "series", tvdbId: 355567, imdbId: "tt1190634" },
  { title: "Blade Runner 2049", year: 2017, mediaType: "movie", imdbId: "tt1856101" },
  { title: "Blade Runner 2049", year: null, mediaType: "movie" },
  { title: "2001: A Space Odyssey", year: 1968, mediaType: "movie", imdbId: "TT0062622" },
  {
    title: "Çılgın Kız: Şöhret",
    originalTitle: "Crazy Girl: Fame",
    year: 2024,
    mediaType: "series",
    tmdbId: 99,
    tmdbType: "tv"
  },
  {
    title: "Sihirbazlar Çetesi",
    originalTitle: "Now You See Me",
    searchTitle: "Now.You.See.Me",
    year: 2013,
    mediaType: "movie",
    releaseTitles: ["Now You See Me", "Now You See Me Extended"],
    alternativeTitles: ["Sihirbazlar Çetesi", "Now You See Me", "NYSM"]
  },
  { title: "Wanted Title", year: 2024, mediaType: "movie", imdbId: "tt12" },
  { title: "", originalTitle: "", year: 2020 },
  {},
  undefined
];

test("search terms and search plans match the extension", (t) => {
  const vectors = MEDIA_VECTORS.map((media) => [media]);

  for (const name of ["prowlarrTerms", "prowlarrTerm", "jackettTerms", "jackettTerm", "titleYearTerm", "getSearchTitle"]) {
    vectorCount += parity(t, name, vectors, userscript[name], config[name]);
  }

  vectorCount += parity(
    t,
    "buildSearchPlan",
    ["radarr", "sonarr", "prowlarr", "jackett", "unknown"].flatMap((service) =>
      MEDIA_VECTORS.map((media) => [service, media])
    ),
    userscript.buildSearchPlan,
    config.buildSearchPlan
  );
});

test("a page flows to the same search terms end to end", (t) => {
  const pages = [
    ["/film/45-x2.html", "X2 (2003)"],
    ["/film/12-5x2.html", "5x2 (2004) - AltyaziDB"],
    ["/dizi/45-x2.html", "X2"],
    ["/dizi/186-the-boys.html", "The Boys S05E08 - AltyaziDB"],
    ["/dizi/9-blade-runner-2049.html", "Blade Runner 2049"],
    ["/film/1-2001-a-space-odyssey.html", "2001: A Space Odyssey (1968)"],
    ["/dizi/7-cilgin-kiz.html", "Çılgın Kız 2. Sezon"]
  ];

  function pipeline(api) {
    return (pathname, title) => {
      const seasonEpisode = api.detectSeasonEpisode(pathname, title);
      const media = {
        title,
        year: api.yearFromSignals({ titleValues: [title] }),
        mediaType: api.detectMediaType({ pathname, ...seasonEpisode }),
        ...seasonEpisode
      };
      return {
        media,
        prowlarr: api.prowlarrTerms(media),
        jackett: api.jackettTerms(media),
        plans: ["radarr", "sonarr"].map((service) => api.buildSearchPlan(service, media).term)
      };
    };
  }

  vectorCount += parity(t, "page pipeline", pages, pipeline(userscript), pipeline(config));
});

test("URL normalization and stored settings match the extension", (t) => {
  const urls = [
    "http://127.0.0.1:7878",
    "http://localhost:8989",
    "http://[::1]:9696",
    "http://[::1]:8989/sonarr/",
    "http://192.168.1.10:9117",
    "https://arr.example.com/radarr",
    "https://example.com/apps/radarr/",
    "https://example.com/apps/radarr/?token=not-a-base-setting#panel",
    "localhost:7878/radarr",
    "arr.example.com",
    "javascript:alert(1)",
    "data:text/html,boom",
    "blob:https://example.test/id",
    "file:///tmp/secret",
    "https://user:secret@example.test/base",
    "http://[broken",
    "   ",
    ""
  ];

  vectorCount += parity(
    t,
    "normalizeBaseUrl",
    [
      ...urls.map((value) => [value, ""]),
      ...urls.map((value) => [value, value]),
      [undefined, "http://127.0.0.1:7878"],
      [null, undefined]
    ],
    userscript.normalizeBaseUrl,
    config.normalizeBaseUrl
  );

  vectorCount += parity(
    t,
    "mergeSettings",
    [
      [undefined],
      [{}],
      [{
        showProwlarrButton: "false",
        showJackettButton: "0",
        sonarrSeasonFolder: "off",
        prowlarrLimit: "999.8",
        jackettLimit: "-4",
        behavior: "unexpected",
        radarrMinimumAvailability: "dangerous",
        sonarrSeriesType: "other",
        radarrQualityProfileId: "not-a-number",
        sonarrQualityProfileId: "12"
      }],
      [{
        radarrBaseUrl: "javascript:alert(1)",
        sonarrBaseUrl: "https://arr.example.com/sonarr/",
        behavior: "autoAdd",
        radarrApiKey: "  test-placeholder  ",
        jackettIndexer: "   ",
        showProwlarrButton: "yes",
        showJackettButton: 1,
        radarrMinimumAvailability: "inCinemas",
        sonarrSeriesType: "anime",
        radarrRootFolderPath: 42,
        sonarrQualityProfileId: 3.5
      }]
    ],
    userscript.mergeSettings,
    config.mergeSettings
  );
});

const LOOKUP_SETS = {
  unrelated: [{ title: "Completely Different", year: 2024, tmdbId: 999, tvdbId: 999 }],
  otherYear: [{ title: "Wanted Title", year: 1999, tmdbId: 999, tvdbId: 999 }],
  remakeSuffix: [{ title: "Wanted Title (2024)", year: 2024, tmdbId: 5, tvdbId: 5 }],
  turkish: [
    { title: "Other Show", year: 2024, tmdbId: 1, tvdbId: 1 },
    { title: "Cilgin Kiz - Sohret!", year: 2024, tmdbId: 2, tvdbId: 2 }
  ],
  byId: [
    { title: "Localized Name", year: 2024, tmdbId: 101, tvdbId: 202, imdbId: "TT0000101" }
  ],
  noYear: [{ title: "wanted   title", tmdbId: 7, tvdbId: 7 }],
  originalTitle: [{ title: "Yerel Ad", originalTitle: "Wanted Title", year: 2024, tmdbId: 8, tvdbId: 8 }],
  empty: []
};

const MATCH_MEDIA = [
  { title: "Wanted Title", year: 2024 },
  { title: "Wanted Title", year: 2023 },
  { title: "Wanted Title" },
  { title: "Çılgın Kız: Şöhret", year: 2024 },
  { title: "Something", year: 2024, tmdbId: 101, tmdbType: "movie" },
  { title: "Something", year: 2024, tmdbId: 101, tmdbType: "tv" },
  { title: "Something", year: 2024, tvdbId: 202 },
  { title: "Something", year: 2024, imdbId: "tt0000101" },
  { title: "", year: 2024 }
];

test("auto-add exact-match decision matches the extension", (t) => {
  const vectors = [];

  for (const service of ["radarr", "sonarr"]) {
    for (const media of MATCH_MEDIA) {
      for (const results of Object.values(LOOKUP_SETS)) {
        vectors.push([service, media, results]);
      }
    }
  }

  // Report which result was chosen by index; the objects are shared.
  const chosen = (find, plan) => (service, media, results) =>
    results.indexOf(find(service, media, results, plan(service, media)));

  vectorCount += parity(
    t,
    "findExactMatch",
    vectors,
    chosen(userscript.findExactMatch, userscript.buildSearchPlan),
    chosen(extension.background.findExactMatch, config.buildSearchPlan)
  );

  // A lookup keyed by ID with a single answer is accepted as-is.
  vectorCount += parity(
    t,
    "findExactMatch (ID-keyed lookup)",
    ["tmdb", "imdb", "tvdb", "term", "query"].map((kind) => [
      "radarr",
      { title: "Wanted Title", year: 2024 },
      LOOKUP_SETS.unrelated,
      { kind }
    ]),
    (service, media, results, plan) => results.indexOf(userscript.findExactMatch(service, media, results, plan)),
    (service, media, results, plan) =>
      results.indexOf(extension.background.findExactMatch(service, media, results, plan))
  );

  vectorCount += parity(
    t,
    "chooseBestResult",
    vectors,
    (service, media, results) => results.indexOf(userscript.chooseBestResult(service, media, results)),
    (service, media, results) =>
      results.indexOf(extension.background.chooseBestResult(service, media, results))
  );
});

const AUTO_ADD = {
  radarr: {
    settings: {
      behavior: "autoAdd",
      radarrApiKey: "test-placeholder",
      radarrRootFolderPath: "/movies",
      radarrQualityProfileId: "1"
    },
    itemPath: "/api/v3/movie",
    mediaType: "movie"
  },
  sonarr: {
    settings: {
      behavior: "autoAdd",
      sonarrApiKey: "test-placeholder",
      sonarrRootFolderPath: "/series",
      sonarrQualityProfileId: "2"
    },
    itemPath: "/api/v3/series",
    mediaType: "series"
  }
};

function lookupReply(lookupResults, itemPath) {
  return (url, method) => {
    const pathname = new URL(url).pathname;

    if (pathname.endsWith("/lookup")) {
      return { status: 200, body: lookupResults };
    }

    if (pathname === itemPath && method === "POST") {
      return { status: 201, body: { titleSlug: "added-item" } };
    }

    return { status: 200, body: [] };
  };
}

test("auto-add without an exact match opens the add search exactly like the extension", async (t) => {
  for (const service of ["radarr", "sonarr"]) {
    for (const [name, lookupResults] of Object.entries({
      unrelated: LOOKUP_SETS.unrelated,
      otherYear: LOOKUP_SETS.otherYear,
      turkish: LOOKUP_SETS.turkish
    })) {
      await t.test(`${service}: ${name}`, async () => {
        const setup = AUTO_ADD[service];
        const media = {
          title: name === "turkish" ? "Çılgın Kız: Şöhret" : "Wanted Title",
          year: 2024,
          mediaType: setup.mediaType
        };
        const reply = lookupReply(lookupResults, setup.itemPath);
        const ext = loadExtension({
          settings: setup.settings,
          fetchImpl: (url, options) => reply(url, options.method || "GET")
        });
        const us = loadUserscript({
          gmRequest: (details) => {
            const { status, body } = reply(details.url, details.method);
            return { status, responseText: JSON.stringify(body) };
          }
        });

        const extResult = plain(await ext.send({ type: "ADB_LOOKUP", service, media }));
        const usResult = plain(
          await us.api.lookupArr(service, media, us.api.mergeSettings(setup.settings))
        );
        const posts = (requests) => requests.filter((request) => request.method !== "GET").length;

        assert.deepEqual(usResult, extResult);
        assert.deepEqual(us.openedTabs, ext.openedTabs);
        assert.equal(posts(us.requests), posts(ext.requests));

        if (name !== "turkish") {
          assert.equal(posts(us.requests), 0, "userscript posted without an exact match");
          assert.match(usResult.message, /^No exact match; opened (Radarr|Sonarr) add search/);
        } else {
          assert.equal(posts(us.requests), 1, "the exact Turkish-title match should be added");
        }

        vectorCount += 1;
      });
    }
  }
});

test("documented divergences are still real and vectors were exercised", (t) => {
  for (const [name, reason] of KNOWN_DIVERGENCES) {
    assert.ok(
      (divergenceHits.get(name) || 0) > 0,
      `KNOWN_DIVERGENCES entry "${name}" (${reason}) no longer diverges; remove it`
    );
  }

  assert.ok(vectorCount >= 300, `only ${vectorCount} parity vectors ran`);
  t.diagnostic(`${vectorCount} parity vectors compared`);
});
