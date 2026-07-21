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

function createHarness({
  settings = {},
  permissionAllowed = true,
  fetchImpl = async () => response([])
} = {}) {
  const requests = [];
  const openedTabs = [];
  let messageHandler;

  const browser = {
    runtime: {
      id: "adb-test-extension",
      getURL(pathname = "") {
        return `moz-extension://adb-test-extension/${pathname}`;
      },
      onInstalled: {
        addListener() {}
      },
      onMessage: {
        addListener(listener) {
          messageHandler = listener;
        }
      }
    },
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...settings };
        },
        async set() {}
      }
    },
    tabs: {
      async create({ url }) {
        openedTabs.push(url);
        return { url };
      }
    },
    permissions: {
      async contains() {
        return permissionAllowed;
      }
    }
  };
  const sandbox = {
    AbortController,
    URL,
    browser,
    clearTimeout,
    console,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options: options || {} });
      return fetchImpl(String(url), options || {}, requests);
    },
    setTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(configSource, sandbox, { filename: "config.js" });
  vm.runInContext(backgroundSource, sandbox, { filename: "background.js" });

  assert.equal(typeof messageHandler, "function");

  return {
    openedTabs,
    requests,
    send(message, sender = { id: "adb-test-extension" }) {
      return messageHandler(message, sender);
    }
  };
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
