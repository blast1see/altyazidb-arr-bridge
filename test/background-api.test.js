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

function response(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text
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
    send(message) {
      return messageHandler(message);
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
