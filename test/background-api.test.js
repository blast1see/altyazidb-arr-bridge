"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const extensionRoot = path.join(root, "altyazidb-arr-bridge-chrome-0.1.1");
const configSource = fs.readFileSync(path.join(extensionRoot, "src", "config.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(extensionRoot, "src", "background.js"), "utf8");

function response(body, status = 200, extra = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    url: extra.url || ""
  };
}

// `api: "browser"` exposes promise-returning `browser.*` APIs (Firefox);
// `api: "chrome"` exposes callback-style `chrome.*` APIs that report failures
// through `chrome.runtime.lastError`. `failures` maps an API name
// (storageGet, storageSet, tabsCreate, permissionsContains) to an error
// message that the API reports instead of succeeding.
function createHarness({
  settings = {},
  permissionAllowed = true,
  fetchImpl = async () => response([]),
  api = "browser",
  failures = {}
} = {}) {
  const requests = [];
  const openedTabs = [];
  const timeouts = [];
  const permissionQueries = [];
  let messageHandler;
  let installedHandler;

  const runtime = {
    id: "adb-test-extension",
    lastError: undefined,
    getURL(pathname = "") {
      return `moz-extension://adb-test-extension/${pathname}`;
    },
    onInstalled: {
      addListener(listener) {
        installedHandler = listener;
      }
    },
    onMessage: {
      addListener(listener) {
        messageHandler = listener;
      }
    }
  };

  // Each operation either returns a value or throws; the wrappers below turn
  // that into a rejected promise (browser) or a lastError callback (chrome).
  const operations = {
    storageGet(defaults) {
      return { ...defaults, ...settings };
    },
    storageSet() {
      return undefined;
    },
    tabsCreate({ url }) {
      openedTabs.push(url);
      return { url };
    },
    permissionsContains({ origins } = {}) {
      permissionQueries.push(...(origins || []));

      for (const origin of origins || []) {
        // Mirror the browser: an IPv6 literal is not a valid match pattern.
        if (/\/\/\[/.test(origin)) {
          throw new Error(`Invalid value for origins: ${origin}`);
        }
      }

      return permissionAllowed;
    }
  };

  function promiseApi(name) {
    return async (arg) => {
      if (failures[name]) {
        throw new Error(failures[name]);
      }

      return operations[name](arg);
    };
  }

  function callbackApi(name) {
    return (arg, callback) => {
      queueMicrotask(() => {
        let value;
        let errorMessage = failures[name];

        if (!errorMessage) {
          try {
            value = operations[name](arg);
          } catch (error) {
            errorMessage = error.message;
          }
        }

        runtime.lastError = errorMessage ? { message: errorMessage } : undefined;

        try {
          if (typeof callback === "function") {
            callback(errorMessage ? undefined : value);
          }
        } finally {
          runtime.lastError = undefined;
        }
      });
    };
  }

  const wrap = api === "chrome" ? callbackApi : promiseApi;
  const extensionApi = {
    runtime,
    storage: {
      local: {
        get: wrap("storageGet"),
        set: wrap("storageSet")
      }
    },
    tabs: {
      create: wrap("tabsCreate")
    },
    permissions: {
      contains: wrap("permissionsContains")
    }
  };
  const sandbox = {
    AbortController,
    URL,
    ...(api === "chrome" ? { chrome: extensionApi } : { browser: extensionApi }),
    clearTimeout,
    console,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options: options || {} });
      return fetchImpl(String(url), options || {}, requests);
    },
    setTimeout: (handler, delay, ...args) => {
      timeouts.push(delay);
      return setTimeout(handler, delay, ...args);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(configSource, sandbox, { filename: "config.js" });
  vm.runInContext(backgroundSource, sandbox, { filename: "background.js" });

  assert.equal(typeof messageHandler, "function");

  return {
    openedTabs,
    permissionQueries,
    requests,
    timeouts,
    install() {
      return installedHandler?.();
    },
    send(message, sender = { id: "adb-test-extension" }) {
      if (api !== "chrome") {
        return messageHandler(message, sender);
      }

      return new Promise((resolve, reject) => {
        let keepsChannelOpen;

        try {
          keepsChannelOpen = messageHandler(message, sender, resolve);
        } catch (error) {
          reject(error);
          return;
        }

        if (keepsChannelOpen !== true) {
          reject(new Error("chrome onMessage listener must return true for async replies"));
        }
      });
    }
  };
}

// Both message paths must answer with a response object, never a rejection.
async function settle(promise) {
  try {
    return { value: await promise };
  } catch (error) {
    return { rejected: error };
  }
}

test("Radarr and Sonarr lookup APIs return popup results", async () => {
  const harness = createHarness({
    settings: {
      behavior: "showPopupResults",
      radarrApiKey: "radarr-key",
      sonarrApiKey: "sonarr-key"
    },
    fetchImpl(url) {
      const parsed = new URL(url);

      if (parsed.pathname.endsWith("/api/v3/movie/lookup/tmdb")) {
        return response([{ title: "Movie", tmdbId: 101, titleSlug: "movie" }]);
      }

      if (parsed.pathname.endsWith("/api/v3/series/lookup")) {
        return response([{ title: "Series", tvdbId: 202, titleSlug: "series" }]);
      }

      throw new Error(`Unexpected request: ${url}`);
    }
  });

  const radarr = await harness.send({
    type: "ADB_LOOKUP",
    service: "radarr",
    media: {
      title: "Movie",
      mediaType: "movie",
      tmdbId: 101,
      tmdbType: "movie"
    }
  });
  const sonarr = await harness.send({
    type: "ADB_LOOKUP",
    service: "sonarr",
    media: {
      title: "Series",
      mediaType: "series",
      tvdbId: 202
    }
  });

  assert.equal(radarr.ok, true);
  assert.equal(radarr.results[0].tmdbId, 101);
  assert.equal(sonarr.ok, true);
  assert.equal(sonarr.results[0].tvdbId, 202);
});

test("Prowlarr keeps the successful alternative query when opening a result", async () => {
  const queries = [];
  const harness = createHarness({
    settings: {
      behavior: "showPopupResults",
      prowlarrApiKey: "prowlarr-key",
      prowlarrLimit: 25
    },
    fetchImpl(url) {
      const query = new URL(url).searchParams.get("query");
      queries.push(query);

      return response(
        query === "Industry 2022"
          ? [{ title: "Industry.S01.1080p", indexer: "Mock", infoUrl: "" }]
          : []
      );
    }
  });
  const media = {
    title: "Industry",
    searchTitle: "Wrong Name",
    year: 2022,
    mediaType: "series"
  };
  const lookup = await harness.send({
    type: "ADB_LOOKUP",
    service: "prowlarr",
    media
  });

  assert.deepEqual(queries, ["Wrong Name 2022", "Industry 2022"]);
  assert.equal(lookup.searchTerm, "Industry 2022");
  assert.equal(lookup.results[0].searchTerm, "Industry 2022");
  assert.equal(new URL(lookup.fallbackUrl).searchParams.get("query"), "Industry 2022");

  const opened = await harness.send({
    type: "ADB_OPEN_RESULT",
    service: "prowlarr",
    media,
    result: lookup.results[0],
    searchTerm: lookup.searchTerm
  });

  assert.equal(new URL(opened.openedUrl).searchParams.get("query"), "Industry 2022");
});

test("Jackett uses alternative queries, applies popup limit, and opens safely", async () => {
  const queries = [];
  const harness = createHarness({
    settings: {
      behavior: "showPopupResults",
      jackettApiKey: "jackett-key",
      jackettLimit: 2
    },
    fetchImpl(url) {
      const query = new URL(url).searchParams.get("Query");
      queries.push(query);

      if (query === "tt0944947") {
        return response({ Results: [] });
      }

      return response({
        Results: [
          { Title: "Result low", Seeders: 1, Guid: "guid-low" },
          { Title: "Result high", Seeders: 50, Guid: "guid-high" },
          { Title: "Result medium", Seeders: 10, Guid: "guid-medium" }
        ]
      });
    }
  });
  const media = {
    title: "Game of Thrones",
    year: 2011,
    imdbId: "tt0944947",
    mediaType: "series"
  };
  const lookup = await harness.send({
    type: "ADB_LOOKUP",
    service: "jackett",
    media
  });

  assert.deepEqual(queries, ["tt0944947", "Game of Thrones 2011"]);
  assert.equal(lookup.searchTerm, "Game of Thrones 2011");
  assert.equal(lookup.results.length, 2);
  assert.equal(lookup.results[0].title, "Result high");
  assert.equal(lookup.results[0].searchTerm, "Game of Thrones 2011");

  const fallback = await harness.send({
    type: "ADB_OPEN_RESULT",
    service: "jackett",
    media,
    result: lookup.results[0],
    searchTerm: lookup.searchTerm
  });

  assert.equal(
    fallback.openedUrl,
    "http://127.0.0.1:9117/UI/Dashboard#search=Game%20of%20Thrones%202011"
  );

  const direct = await harness.send({
    type: "ADB_OPEN_RESULT",
    service: "jackett",
    media,
    result: {
      ...lookup.results[0],
      infoUrl: "https://tracker.example/details/42"
    }
  });

  assert.equal(direct.openedUrl, "https://tracker.example/details/42");
});

test("Jackett connection test uses Torznab caps instead of a tracker search", async () => {
  const harness = createHarness({
    settings: {
      jackettApiKey: "jackett-key"
    },
    fetchImpl() {
      return response('<?xml version="1.0"?><caps></caps>');
    }
  });
  const result = await harness.send({
    type: "ADB_TEST_CONNECTION",
    service: "jackett"
  });
  const requestUrl = new URL(harness.requests[0].url);

  assert.equal(result.ok, true);
  assert.equal(requestUrl.pathname, "/api/v2.0/indexers/all/results/torznab/api");
  assert.equal(requestUrl.searchParams.get("t"), "caps");
  assert.equal(requestUrl.searchParams.has("Query"), false);
});

test("custom Firefox-style host permission acceptance and rejection", async (t) => {
  const settings = {
    behavior: "showPopupResults",
    radarrBaseUrl: "http://192.168.1.25:7878",
    radarrApiKey: "radarr-key"
  };
  const media = {
    title: "Movie",
    mediaType: "movie",
    tmdbId: 101,
    tmdbType: "movie"
  };

  await t.test("rejection stops before fetch", async () => {
    const harness = createHarness({
      settings,
      permissionAllowed: false,
      fetchImpl() {
        throw new Error("fetch must not run");
      }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "radarr",
      media
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /host permission is missing/i);
    assert.equal(harness.requests.length, 0);
  });

  await t.test("acceptance allows fetch", async () => {
    const harness = createHarness({
      settings,
      permissionAllowed: true,
      fetchImpl() {
        return response([{ title: "Movie", tmdbId: 101 }]);
      }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "radarr",
      media
    });

    assert.equal(result.ok, true);
    assert.equal(harness.requests.length, 1);
  });
});

test("invalid service URLs stop before fetch with a specific error", async () => {
  const harness = createHarness({
    settings: {
      behavior: "showPopupResults",
      radarrBaseUrl: "http://[broken",
      radarrApiKey: "radarr-key"
    },
    fetchImpl() {
      throw new Error("fetch must not run");
    }
  });
  const result = await harness.send({
    type: "ADB_LOOKUP",
    service: "radarr",
    media: {
      title: "Movie",
      mediaType: "movie",
      tmdbId: 101,
      tmdbType: "movie"
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /URL is invalid/i);
  assert.equal(harness.requests.length, 0);
});

test("network failures keep timeout, TLS, and offline service messages distinct", async (t) => {
  const media = {
    title: "Movie",
    mediaType: "movie",
    tmdbId: 101,
    tmdbType: "movie"
  };

  const cases = [
    {
      name: "timeout",
      error: Object.assign(new Error("The operation timed out"), { name: "AbortError" }),
      expected: /request timed out/i
    },
    {
      name: "TLS",
      error: new Error("certificate has expired"),
      expected: /TLS\/certificate validation failed/i
    },
    {
      name: "offline localhost service",
      error: new TypeError("NetworkError when attempting to fetch resource"),
      expected: /service is running and the URL and port are correct/i
    }
  ];

  for (const current of cases) {
    await t.test(current.name, async () => {
      const harness = createHarness({
        settings: {
          behavior: "showPopupResults",
          radarrApiKey: "radarr-key"
        },
        fetchImpl() {
          throw current.error;
        }
      });
      const result = await harness.send({
        type: "ADB_LOOKUP",
        service: "radarr",
        media
      });

      assert.equal(result.ok, false);
      assert.match(result.error, current.expected);
      assert.doesNotMatch(result.error, /CORS/i);
    });
  }
});

test("auto-add payloads keep automatic searches disabled", async (t) => {
  await t.test("Radarr", async () => {
    let addedPayload;
    const harness = createHarness({
      settings: {
        behavior: "autoAdd",
        radarrApiKey: "radarr-key",
        radarrRootFolderPath: "/movies",
        radarrQualityProfileId: "1"
      },
      fetchImpl(url, options) {
        const parsed = new URL(url);

        if (parsed.pathname.endsWith("/api/v3/movie/lookup/tmdb")) {
          return response([{ title: "Movie", tmdbId: 101, titleSlug: "movie" }]);
        }

        if (parsed.pathname.endsWith("/api/v3/movie") && options.method === "POST") {
          addedPayload = JSON.parse(options.body);
          return response({ titleSlug: "movie" });
        }

        if (parsed.pathname.endsWith("/api/v3/movie")) {
          return response([]);
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "radarr",
      media: {
        title: "Movie",
        mediaType: "movie",
        tmdbId: 101,
        tmdbType: "movie"
      }
    });

    assert.equal(result.ok, true);
    assert.equal(addedPayload.addOptions.searchForMovie, false);
  });

  await t.test("Sonarr", async () => {
    let addedPayload;
    const harness = createHarness({
      settings: {
        behavior: "autoAdd",
        sonarrApiKey: "sonarr-key",
        sonarrRootFolderPath: "/series",
        sonarrQualityProfileId: "2"
      },
      fetchImpl(url, options) {
        const parsed = new URL(url);

        if (parsed.pathname.endsWith("/api/v3/series/lookup")) {
          return response([{ title: "Anime", tvdbId: 202, titleSlug: "anime" }]);
        }

        if (parsed.pathname.endsWith("/api/v3/series") && options.method === "POST") {
          addedPayload = JSON.parse(options.body);
          return response({ titleSlug: "anime" });
        }

        if (parsed.pathname.endsWith("/api/v3/series")) {
          return response([]);
        }

        throw new Error(`Unexpected request: ${url}`);
      }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "sonarr",
      media: {
        title: "Anime",
        mediaType: "anime",
        tvdbId: 202
      }
    });

    assert.equal(result.ok, true);
    assert.equal(addedPayload.seriesType, "anime");
    assert.equal(addedPayload.addOptions.searchForMissingEpisodes, false);
    assert.equal(addedPayload.addOptions.searchForCutoffUnmetEpisodes, false);
  });
});

test("no-key fallback never opens an unsafe configured URL", async (t) => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,boom",
    "blob:https://example.test/id",
    "https://user:secret@example.test/base"
  ]) {
    await t.test(value.split(":", 1)[0], async () => {
      const harness = createHarness({
        settings: { radarrBaseUrl: value, radarrApiKey: "" }
      });
      const result = await harness.send({
        type: "ADB_LOOKUP",
        service: "radarr",
        media: { title: "Movie", mediaType: "movie" }
      });

      assert.equal(result.ok, false);
      assert.equal(result.opened, false);
      assert.equal(harness.openedTabs.length, 0);
    });
  }
});

test("JSON APIs reject malformed and unexpected response shapes", async (t) => {
  await t.test("malformed JSON", async () => {
    const harness = createHarness({
      settings: {
        behavior: "showPopupResults",
        radarrApiKey: "radarr-key"
      },
      fetchImpl() {
        return response("{not-json");
      }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "radarr",
      media: { title: "Movie", mediaType: "movie" }
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /invalid JSON/i);
  });

  await t.test("Jackett object without Results", async () => {
    const harness = createHarness({
      settings: {
        behavior: "showPopupResults",
        jackettApiKey: "jackett-key"
      },
      fetchImpl() {
        return response({ Indexers: [] });
      }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "jackett",
      media: { title: "Movie", mediaType: "movie" }
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /invalid response/i);
  });
});

test("request failures redact API keys and disable redirects", async () => {
  const secret = "jackett-super-secret";
  let requestOptions;
  const harness = createHarness({
    settings: {
      behavior: "showPopupResults",
      jackettApiKey: secret
    },
    fetchImpl(_url, options) {
      requestOptions = options;
      return response(`failure apikey=${secret}&next=1 raw=${secret}`, 500);
    }
  });
  const result = await harness.send({
    type: "ADB_LOOKUP",
    service: "jackett",
    media: { title: "Movie", mediaType: "movie" }
  });

  assert.equal(result.ok, false);
  assert.equal(requestOptions.redirect, "error");
  assert.doesNotMatch(result.error, new RegExp(secret));
  assert.match(result.error, /apikey=\[REDACTED\]/i);
});

test("401 and 403 responses are reported as rejected API keys", async (t) => {
  for (const status of [401, 403]) {
    await t.test(String(status), async () => {
      const harness = createHarness({
        settings: { behavior: "showPopupResults", radarrApiKey: "bad-key" },
        fetchImpl() {
          return response({ message: "denied" }, status);
        }
      });
      const result = await harness.send({
        type: "ADB_LOOKUP",
        service: "radarr",
        media: { title: "Movie", mediaType: "movie" }
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /API key rejected/i);
    });
  }
});

test("cross-origin response URLs are rejected", async () => {
  const harness = createHarness({
    settings: { behavior: "showPopupResults", jackettApiKey: "secret" },
    fetchImpl() {
      return response({ Results: [] }, 200, { url: "https://evil.example/results" });
    }
  });
  const result = await harness.send({
    type: "ADB_LOOKUP",
    service: "jackett",
    media: { title: "Movie", mediaType: "movie" }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /redirected to a different origin/i);
});

test("redirect policy rejects every redirect class without a second keyed request", async (t) => {
  const cases = [
    {
      name: "same-origin trailing slash",
      baseUrl: "https://arr.example.test/radarr",
      target: "https://arr.example.test/radarr/"
    },
    {
      name: "same-origin path",
      baseUrl: "https://arr.example.test/radarr",
      target: "https://arr.example.test/apps/radarr"
    },
    {
      name: "HTTP to HTTPS",
      baseUrl: "http://arr.example.test/radarr",
      target: "https://arr.example.test/radarr"
    },
    {
      name: "different origin",
      baseUrl: "https://arr.example.test/radarr",
      target: "https://other.example.test/radarr"
    },
    {
      name: "keyed cross-origin",
      baseUrl: "https://arr.example.test/radarr",
      target: "https://collector.example.test/capture"
    }
  ];

  for (const redirectCase of cases) {
    await t.test(redirectCase.name, async () => {
      const secret = `secret-${redirectCase.name.replaceAll(" ", "-")}`;
      const targetRequests = [];
      const harness = createHarness({
        settings: {
          radarrBaseUrl: redirectCase.baseUrl,
          radarrApiKey: secret
        },
        fetchImpl(url, options) {
          if (url === redirectCase.target) {
            targetRequests.push({ url, options });
          }
          assert.equal(options.redirect, "error");
          throw new TypeError(`Redirect refused: ${redirectCase.target}`);
        }
      });
      const result = await harness.send({
        type: "ADB_TEST_CONNECTION",
        service: "radarr"
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /redirects are not followed/i);
      assert.equal(harness.requests.length, 1);
      assert.equal(harness.requests[0].options.headers["X-Api-Key"], secret);
      assert.deepEqual(targetRequests, []);
    });
  }
});

test("valid no-key HTTP and HTTPS fallbacks open safely", async (t) => {
  for (const baseUrl of ["http://127.0.0.1:7878", "https://arr.example.test/radarr"]) {
    await t.test(new URL(baseUrl).protocol, async () => {
      const harness = createHarness({ settings: { radarrBaseUrl: baseUrl, radarrApiKey: "" } });
      const result = await harness.send({
        type: "ADB_LOOKUP",
        service: "radarr",
        media: { title: "Movie", mediaType: "movie" }
      });

      assert.equal(result.opened, true);
      assert.equal(harness.openedTabs.length, 1);
      assert.equal(new URL(harness.openedTabs[0]).origin, new URL(baseUrl).origin);
    });
  }
});

test("open URL messages are limited to configured service origins and path prefixes", async () => {
  const harness = createHarness({
    settings: {
      radarrBaseUrl: "https://arr.example.test/radarr",
      sonarrBaseUrl: "https://sonarr.example.test/sonarr"
    }
  });
  const allowed = await harness.send({
    type: "ADB_OPEN_URL",
    service: "radarr",
    url: "https://arr.example.test/radarr/add/new?term=Movie"
  });
  const foreign = await harness.send({
    type: "ADB_OPEN_URL",
    service: "radarr",
    url: "https://evil.example/phish"
  });
  const active = await harness.send({
    type: "ADB_OPEN_URL",
    service: "radarr",
    url: "javascript:alert(1)"
  });
  const wrongService = await harness.send({
    type: "ADB_OPEN_URL",
    service: "radarr",
    url: "https://sonarr.example.test/sonarr/add/new"
  });
  const siblingPath = await harness.send({
    type: "ADB_OPEN_URL",
    service: "radarr",
    url: "https://arr.example.test/admin"
  });
  const prefixLookalike = await harness.send({
    type: "ADB_OPEN_URL",
    service: "radarr",
    url: "https://arr.example.test/radarr-evil/add/new"
  });

  assert.equal(allowed.ok, true);
  assert.equal(foreign.ok, false);
  assert.equal(active.ok, false);
  assert.equal(wrongService.ok, false);
  assert.equal(siblingPath.ok, false);
  assert.equal(prefixLookalike.ok, false);
  assert.deepEqual(harness.openedTabs, [
    "https://arr.example.test/radarr/add/new?term=Movie"
  ]);
});

test("message sender and service values are allowlisted", async () => {
  const harness = createHarness();
  const foreign = await harness.send(
    { type: "ADB_TEST_CONNECTION", service: "radarr" },
    { id: "foreign-extension" }
  );
  const unknownService = await harness.send({
    type: "ADB_LOOKUP",
    service: "not-arr",
    media: { title: "Movie" }
  });
  const unknownType = await harness.send({ type: "ADB_NOT_A_REAL_MESSAGE" });

  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /sender/i);
  assert.equal(unknownService.ok, false);
  assert.match(unknownService.error, /service/i);
  assert.equal(unknownType.ok, false);
  assert.match(unknownType.error, /unknown extension message/i);
  assert.equal(harness.requests.length, 0);
});

test("valid content and options messages survive a service-worker restart", async () => {
  const settings = {
    radarrBaseUrl: "https://arr.example.test/radarr",
    radarrApiKey: "restart-key"
  };
  const firstWorker = createHarness({ settings });
  const contentResult = await firstWorker.send(
    {
      type: "ADB_OPEN_URL",
      service: "radarr",
      url: "https://arr.example.test/radarr/add/new?term=Movie"
    },
    {
      id: "adb-test-extension",
      url: "https://altyazidb.com/film/724-michael.html"
    }
  );
  const restartedWorker = createHarness({ settings });
  const optionsResult = await restartedWorker.send(
    { type: "ADB_TEST_CONNECTION", service: "radarr" },
    {
      id: "adb-test-extension",
      url: "moz-extension://adb-test-extension/options.html"
    }
  );

  assert.equal(contentResult.ok, true);
  assert.equal(optionsResult.ok, true);
  assert.equal(restartedWorker.requests.length, 1);
  assert.equal(restartedWorker.requests[0].options.headers["X-Api-Key"], "restart-key");
});

test("strong IDs perform at most one existing-item check", async () => {
  const harness = createHarness({
    settings: {
      behavior: "openSearchPage",
      radarrApiKey: "radarr-key"
    },
    fetchImpl(url) {
      const parsed = new URL(url);

      if (parsed.pathname.endsWith("/api/v3/movie/lookup/tmdb")) {
        return response([{ title: "Movie", tmdbId: 101, titleSlug: "movie" }]);
      }

      if (parsed.pathname.endsWith("/api/v3/movie")) {
        return response([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    }
  });
  const result = await harness.send({
    type: "ADB_LOOKUP",
    service: "radarr",
    media: {
      title: "Movie",
      mediaType: "movie",
      tmdbId: 101,
      tmdbType: "movie"
    }
  });
  const existingRequests = harness.requests.filter((request) =>
    new URL(request.url).pathname.endsWith("/api/v3/movie")
  );

  assert.equal(result.ok, true);
  assert.equal(existingRequests.length, 1);
});

test("an existing item short-circuits lookup and opens its detail page", async () => {
  const harness = createHarness({
    settings: { behavior: "openSearchPage", radarrApiKey: "radarr-key" },
    fetchImpl(url) {
      const parsed = new URL(url);
      assert.equal(parsed.pathname.endsWith("/api/v3/movie"), true);
      return response([{ tmdbId: 101, titleSlug: "existing-movie" }]);
    }
  });
  const result = await harness.send({
    type: "ADB_LOOKUP",
    service: "radarr",
    media: { title: "Movie", mediaType: "movie", tmdbId: 101, tmdbType: "movie" }
  });

  assert.equal(result.ok, true);
  assert.equal(harness.requests.length, 1);
  assert.match(result.openedUrl, /\/movie\/existing-movie$/);
});

test("auto-add refuses invalid roots or profiles and remains opt-in", async (t) => {
  await t.test("invalid auto-add settings", async () => {
    const harness = createHarness({
      settings: {
        behavior: "autoAdd",
        radarrApiKey: "radarr-key",
        radarrRootFolderPath: "",
        radarrQualityProfileId: "-1"
      },
      fetchImpl(url, options) {
        assert.notEqual(options.method, "POST");
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/api/v3/movie/lookup")) {
          return response([{ title: "Movie", tmdbId: 101, titleSlug: "movie" }]);
        }
        throw new Error(`Unexpected request: ${url}`);
      }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "radarr",
      media: { title: "Movie", mediaType: "movie" }
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /root folder and quality profile/i);
    assert.equal(harness.requests.some((request) => request.options.method === "POST"), false);
  });

  await t.test("default behavior never posts", async () => {
    const harness = createHarness({
      settings: { radarrApiKey: "radarr-key" },
      fetchImpl(url, options) {
        assert.notEqual(options.method, "POST");
        return response([{ title: "Movie", titleSlug: "movie" }]);
      }
    });
    await harness.send({
      type: "ADB_LOOKUP",
      service: "radarr",
      media: { title: "Movie", mediaType: "movie" }
    });
    assert.equal(harness.requests.some((request) => request.options.method === "POST"), false);
  });
});

test("alternative Prowlarr and Jackett queries are capped", async (t) => {
  // Every retry fans out to all enabled trackers, so unbounded title variants
  // used to turn one click into a long chain of aggregate searches.
  const media = {
    title: "Deep Title",
    searchTitle: "Variant One",
    originalTitle: "Variant Two",
    alternativeTitles: ["Variant Three", "Variant Four", "Variant Five"],
    releaseTitles: ["Variant Six", "Variant Seven"],
    year: 2024,
    mediaType: "movie"
  };

  await t.test("prowlarr", async () => {
    const harness = createHarness({
      settings: { behavior: "showPopupResults", prowlarrApiKey: "prowlarr-key" },
      fetchImpl: () => response([])
    });
    const result = await harness.send({ type: "ADB_LOOKUP", service: "prowlarr", media });

    assert.equal(result.ok, false);
    assert.equal(harness.requests.length, 3);
  });

  await t.test("jackett", async () => {
    const harness = createHarness({
      settings: { behavior: "showPopupResults", jackettApiKey: "jackett-key" },
      fetchImpl: () => response({ Results: [] })
    });
    const result = await harness.send({ type: "ADB_LOOKUP", service: "jackett", media });

    assert.equal(result.ok, false);
    assert.equal(harness.requests.length, 3);
  });

  await t.test("a first-query hit still stops after one request", async () => {
    const harness = createHarness({
      settings: { behavior: "showPopupResults", prowlarrApiKey: "prowlarr-key" },
      fetchImpl: () => response([{ title: "Variant One 2024", indexer: "Mock" }])
    });
    const result = await harness.send({ type: "ADB_LOOKUP", service: "prowlarr", media });

    assert.equal(result.ok, true);
    assert.equal(harness.requests.length, 1);
  });
});

test("Prowlarr popup results honour the configured limit", async () => {
  const harness = createHarness({
    settings: {
      behavior: "showPopupResults",
      prowlarrApiKey: "prowlarr-key",
      prowlarrLimit: 2
    },
    fetchImpl: () =>
      response([
        { title: "One", indexer: "Mock" },
        { title: "Two", indexer: "Mock" },
        { title: "Three", indexer: "Mock" }
      ])
  });
  const result = await harness.send({
    type: "ADB_LOOKUP",
    service: "prowlarr",
    media: { title: "Movie", year: 2024, mediaType: "movie" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  assert.equal(new URL(harness.requests[0].url).searchParams.get("limit"), "2");
});

test("aggregate searches get a longer timeout than plain API calls", async () => {
  const timeouts = [];
  const harness = createHarness({
    settings: {
      behavior: "showPopupResults",
      jackettApiKey: "jackett-key",
      radarrApiKey: "radarr-key"
    },
    fetchImpl(url, options) {
      timeouts.push(options.signal ? "aborted-signal" : "no-signal");
      return new URL(url).pathname.includes("/indexers/")
        ? response({ Results: [{ Title: "Result", Seeders: 1 }] })
        : response([{ title: "Movie", tmdbId: 101 }]);
    }
  });

  await harness.send({
    type: "ADB_LOOKUP",
    service: "jackett",
    media: { title: "Movie", year: 2024, mediaType: "movie" }
  });
  await harness.send({
    type: "ADB_LOOKUP",
    service: "radarr",
    media: { title: "Movie", year: 2024, mediaType: "movie" }
  });

  assert.deepEqual(timeouts, ["aborted-signal", "aborted-signal"]);
  assert.equal(harness.timeouts[0], 30000);
  assert.equal(harness.timeouts.at(-1), 10000);
});

test("IPv6 service URLs skip the unsupported permission pattern and still fetch", async () => {
  // permissions.contains() throws on `http://[::1]/*`, so the pre-flight check
  // is skipped and the browser enforces host access for the request instead.
  const harness = createHarness({
    settings: {
      behavior: "showPopupResults",
      jackettBaseUrl: "http://[::1]:9117",
      jackettApiKey: "jackett-key"
    },
    permissionAllowed: false,
    fetchImpl: () => response({ Results: [{ Title: "Result", Seeders: 3 }] })
  });
  const result = await harness.send({
    type: "ADB_LOOKUP",
    service: "jackett",
    media: { title: "Movie", year: 2024, mediaType: "movie" }
  });

  assert.equal(result.ok, true);
  assert.equal(harness.requests.length, 1);
  assert.equal(new URL(harness.requests[0].url).hostname, "[::1]");
  assert.deepEqual(harness.permissionQueries, []);
});

test("IPv6 loopback failures report localhost guidance", async () => {
  const harness = createHarness({
    settings: {
      behavior: "showPopupResults",
      jackettBaseUrl: "http://[::1]:9117",
      jackettApiKey: "jackett-key"
    },
    fetchImpl() {
      throw new TypeError("NetworkError when attempting to fetch resource");
    }
  });
  const result = await harness.send({
    type: "ADB_LOOKUP",
    service: "jackett",
    media: { title: "Movie", year: 2024, mediaType: "movie" }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /localhost Jackett/i);
  assert.match(result.error, /service is running and the URL and port are correct/i);
});

test("magnet and active result URLs fall back to the configured search page", async () => {
  const harness = createHarness({
    settings: { prowlarrBaseUrl: "http://127.0.0.1:9696" }
  });

  for (const infoUrl of ["magnet:?xt=urn:btih:abc", "javascript:alert(1)"]) {
    const result = await harness.send({
      type: "ADB_OPEN_RESULT",
      service: "prowlarr",
      media: { title: "Movie", year: 2024 },
      result: { title: "Movie.2024", infoUrl, searchTerm: "Movie 2024" }
    });

    assert.equal(new URL(result.openedUrl).pathname, "/search");
    assert.equal(new URL(result.openedUrl).searchParams.get("query"), "Movie 2024");
  }
});

const AUTO_ADD_SERVICES = {
  radarr: {
    settings: {
      behavior: "autoAdd",
      radarrApiKey: "radarr-key",
      radarrRootFolderPath: "/movies",
      radarrQualityProfileId: "1"
    },
    lookupPath: "/api/v3/movie/lookup",
    itemPath: "/api/v3/movie",
    mediaType: "movie",
    idMedia: { tmdbId: 101, tmdbType: "movie" },
    idResult: { tmdbId: 101 }
  },
  sonarr: {
    settings: {
      behavior: "autoAdd",
      sonarrApiKey: "sonarr-key",
      sonarrRootFolderPath: "/series",
      sonarrQualityProfileId: "2"
    },
    lookupPath: "/api/v3/series/lookup",
    itemPath: "/api/v3/series",
    mediaType: "series",
    idMedia: { tvdbId: 202 },
    idResult: { tvdbId: 202 }
  }
};

function autoAddHarness(service, lookupResults) {
  const config = AUTO_ADD_SERVICES[service];
  const posted = [];
  const harness = createHarness({
    settings: config.settings,
    fetchImpl(url, options) {
      const pathname = new URL(url).pathname;

      if (pathname.startsWith(config.lookupPath)) {
        return response(lookupResults);
      }

      if (pathname === config.itemPath && options.method === "POST") {
        posted.push(JSON.parse(options.body));
        return response({ titleSlug: "added-item" });
      }

      if (pathname === config.itemPath) {
        return response([]);
      }

      throw new Error(`Unexpected request: ${url}`);
    }
  });

  return { harness, posted };
}

function writeRequests(harness) {
  return harness.requests.filter((request) =>
    (request.options.method || "GET") !== "GET"
  );
}

test("auto-add only posts an exact match and otherwise opens the add search", async (t) => {
  for (const service of ["radarr", "sonarr"]) {
    const config = AUTO_ADD_SERVICES[service];
    const label = service === "radarr" ? "Radarr" : "Sonarr";

    await t.test(`${service}: unrelated title opens the add search instead`, async () => {
      const { harness, posted } = autoAddHarness(service, [
        { title: "Completely Different", year: 2024, tmdbId: 999, tvdbId: 999, titleSlug: "wrong" }
      ]);
      const result = await harness.send({
        type: "ADB_LOOKUP",
        service,
        media: { title: "Wanted Title", year: 2024, mediaType: config.mediaType }
      });

      assert.equal(posted.length, 0);
      assert.deepEqual(writeRequests(harness), []);
      assert.equal(result.ok, true);
      assert.equal(result.opened, true);
      assert.match(result.message, new RegExp(`No exact match; opened ${label} add search`));
      assert.equal(harness.openedTabs.length, 1);
      assert.equal(new URL(harness.openedTabs[0]).pathname, "/add/new");
      assert.equal(new URL(harness.openedTabs[0]).searchParams.get("term"), "Wanted Title 2024");
      assert.equal(result.openedUrl, harness.openedTabs[0]);
    });

    await t.test(`${service}: same title with a different year does not post`, async () => {
      const { harness, posted } = autoAddHarness(service, [
        { title: "Wanted Title", year: 1999, tmdbId: 999, tvdbId: 999, titleSlug: "remake" }
      ]);
      const result = await harness.send({
        type: "ADB_LOOKUP",
        service,
        media: { title: "Wanted Title", year: 2024, mediaType: config.mediaType }
      });

      assert.equal(posted.length, 0);
      assert.deepEqual(writeRequests(harness), []);
      assert.equal(result.ok, true);
      assert.equal(result.opened, true);
      assert.match(result.message, /No exact match/);
    });

    await t.test(`${service}: same title and year posts, ignoring Turkish letters and punctuation`, async () => {
      const { harness, posted } = autoAddHarness(service, [
        { title: "Other Show", year: 2024, tmdbId: 1, tvdbId: 1, titleSlug: "first" },
        { title: "Cilgin Kiz - Sohret!", year: 2024, tmdbId: 2, tvdbId: 2, titleSlug: "second" }
      ]);
      const result = await harness.send({
        type: "ADB_LOOKUP",
        service,
        media: { title: "Çılgın Kız: Şöhret", year: 2024, mediaType: config.mediaType }
      });

      assert.equal(result.ok, true);
      assert.equal(posted.length, 1);
      assert.equal(posted[0].titleSlug, "second");
      assert.equal(writeRequests(harness).length, 1);
    });

    await t.test(`${service}: a strong ID match posts even when the title differs`, async () => {
      const { harness, posted } = autoAddHarness(service, [
        { title: "Localized Name", year: 2024, ...config.idResult, titleSlug: "by-id" }
      ]);
      const result = await harness.send({
        type: "ADB_LOOKUP",
        service,
        media: {
          title: "Wanted Title",
          year: 2024,
          mediaType: config.mediaType,
          ...config.idMedia
        }
      });

      assert.equal(result.ok, true);
      assert.equal(posted.length, 1);
      assert.equal(posted[0].titleSlug, "by-id");
    });
  }
});

test("open result falls back to the add page when the existing-item check fails", async (t) => {
  const failures = {
    network: () => {
      throw new TypeError("NetworkError when attempting to fetch resource");
    },
    "rejected key": () => response({ message: "denied" }, 401)
  };

  for (const [name, fetchImpl] of Object.entries(failures)) {
    await t.test(name, async () => {
      const harness = createHarness({
        settings: { radarrApiKey: "radarr-key" },
        fetchImpl
      });
      const outcome = await settle(harness.send({
        type: "ADB_OPEN_RESULT",
        service: "radarr",
        media: { title: "Movie", year: 2024 },
        result: { title: "Movie", year: 2024, tmdbId: 101 }
      }));

      assert.equal(outcome.rejected, undefined);
      assert.equal(outcome.value.ok, true);
      assert.equal(harness.requests.length, 1);
      assert.equal(harness.openedTabs.length, 1);
      assert.equal(new URL(harness.openedTabs[0]).pathname, "/add/new");
      assert.equal(new URL(harness.openedTabs[0]).searchParams.get("term"), "tmdb:101");
    });
  }
});

test("open result reports invalid service URLs without opening a tab", async (t) => {
  for (const api of ["browser", "chrome"]) {
    for (const [service, label] of [
      ["radarr", "Radarr"],
      ["sonarr", "Sonarr"],
      ["prowlarr", "Prowlarr"],
      ["jackett", "Jackett"]
    ]) {
      await t.test(`${api} ${service}`, async () => {
        const harness = createHarness({
          api,
          settings: { [`${service}BaseUrl`]: "http://[broken" }
        });
        const outcome = await settle(harness.send({
          type: "ADB_OPEN_RESULT",
          service,
          media: { title: "Movie", year: 2024 },
          result: { title: "Movie", year: 2024 }
        }));

        assert.equal(outcome.rejected, undefined);
        assert.equal(outcome.value.ok, false);
        assert.match(outcome.value.error, new RegExp(`^${label} URL is invalid\\.`));
        assert.deepEqual(harness.openedTabs, []);
      });
    }
  }
});

test("open messages answer with an error when the tab cannot be opened", async (t) => {
  for (const api of ["browser", "chrome"]) {
    await t.test(`${api} ADB_OPEN_URL`, async () => {
      const harness = createHarness({
        api,
        settings: { radarrBaseUrl: "https://arr.example.test/radarr" },
        failures: { tabsCreate: "No current window" }
      });
      const outcome = await settle(harness.send({
        type: "ADB_OPEN_URL",
        service: "radarr",
        url: "https://arr.example.test/radarr/add/new?term=Movie"
      }));

      assert.equal(outcome.rejected, undefined);
      assert.equal(outcome.value.ok, false);
      assert.notEqual(outcome.value.opened, true);
      assert.match(outcome.value.error, /No current window/);
    });

    await t.test(`${api} ADB_OPEN_RESULT`, async () => {
      const harness = createHarness({
        api,
        failures: { tabsCreate: "No current window" }
      });
      const outcome = await settle(harness.send({
        type: "ADB_OPEN_RESULT",
        service: "prowlarr",
        media: { title: "Movie", year: 2024 },
        result: { title: "Movie.2024", infoUrl: "https://tracker.example/details/1" }
      }));

      assert.equal(outcome.rejected, undefined);
      assert.equal(outcome.value.ok, false);
      assert.match(outcome.value.error, /No current window/);
    });
  }
});

test("open result errors never expose the API key", async (t) => {
  const secret = "radarr-secret-value";

  for (const api of ["browser", "chrome"]) {
    await t.test(api, async () => {
      const harness = createHarness({
        api,
        settings: { radarrApiKey: secret },
        fetchImpl: () => response([]),
        failures: {
          tabsCreate: `Cannot open http://127.0.0.1:7878/?apikey=${secret}&x=1 (${secret})`
        }
      });
      const outcome = await settle(harness.send({
        type: "ADB_OPEN_RESULT",
        service: "radarr",
        media: { title: "Movie", year: 2024 },
        result: { title: "Movie", year: 2024, tmdbId: 101 }
      }));

      assert.equal(outcome.rejected, undefined);
      assert.equal(outcome.value.ok, false);
      assert.doesNotMatch(outcome.value.error, new RegExp(secret));
      assert.doesNotMatch(outcome.value.error, /apikey=(?!\[REDACTED\])/i);
    });
  }
});

test("chrome callback APIs surface runtime.lastError", async (t) => {
  await t.test("successful callbacks still work", async () => {
    const harness = createHarness({
      api: "chrome",
      settings: { radarrBaseUrl: "https://arr.example.test/radarr" }
    });
    const result = await harness.send({
      type: "ADB_OPEN_URL",
      service: "radarr",
      url: "https://arr.example.test/radarr/add/new?term=Movie"
    });

    assert.equal(result.ok, true);
    assert.deepEqual(harness.openedTabs, ["https://arr.example.test/radarr/add/new?term=Movie"]);
  });

  await t.test("storage.local.get", async () => {
    const harness = createHarness({
      api: "chrome",
      settings: { radarrApiKey: "radarr-key" },
      failures: { storageGet: "Storage is unavailable" }
    });
    const result = await harness.send({ type: "ADB_TEST_CONNECTION", service: "radarr" });

    assert.equal(result.ok, false);
    assert.match(result.error, /Storage is unavailable/);
    assert.equal(harness.requests.length, 0);
  });

  await t.test("permissions.contains", async () => {
    const harness = createHarness({
      api: "chrome",
      settings: { behavior: "showPopupResults", radarrApiKey: "radarr-key" },
      failures: { permissionsContains: "Permission query failed" }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "radarr",
      media: { title: "Movie", year: 2024, mediaType: "movie" }
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /Permission query failed/);
    assert.equal(harness.requests.length, 0);
  });

  await t.test("tabs.create during lookup", async () => {
    const harness = createHarness({
      api: "chrome",
      settings: { behavior: "openSearchPage", radarrApiKey: "radarr-key" },
      fetchImpl: () => response([{ tmdbId: 101, titleSlug: "existing-movie" }]),
      failures: { tabsCreate: "No current window" }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "radarr",
      media: { title: "Movie", mediaType: "movie", tmdbId: 101, tmdbType: "movie" }
    });

    assert.equal(result.ok, false);
    assert.notEqual(result.opened, true);
    assert.match(result.error, /No current window/);
  });

  await t.test("tabs.create during no-key fallback", async () => {
    const harness = createHarness({
      api: "chrome",
      settings: { radarrApiKey: "" },
      failures: { tabsCreate: "No current window" }
    });
    const result = await harness.send({
      type: "ADB_LOOKUP",
      service: "radarr",
      media: { title: "Movie", mediaType: "movie" }
    });

    assert.equal(result.ok, false);
    assert.notEqual(result.opened, true);
    assert.match(result.error, /No current window/);
  });
});
