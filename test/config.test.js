"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const configSource = fs.readFileSync(
  path.join(root, "altyazidb-arr-bridge-chrome-0.1.1", "src", "config.js"),
  "utf8"
);
const sandbox = { globalThis: {} };
new Function("globalThis", configSource)(sandbox.globalThis);
const config = sandbox.globalThis.AdbArrConfig;
const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "media-pages.json"), "utf8")
);

test("media fixtures use only URL/title page-level signals", async (t) => {
  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const seasonEpisode = config.detectSeasonEpisode(
        fixture.pathname,
        fixture.title
      );
      const mediaType = config.detectMediaType({
        pathname: fixture.pathname,
        seasonNumber: seasonEpisode.seasonNumber,
        episodeNumber: seasonEpisode.episodeNumber
      });

      assert.deepEqual(
        { mediaType, ...seasonEpisode },
        fixture.expected,
        `Subtitle table noise must not affect ${fixture.name}: ${fixture.subtitleTableNoise}`
      );
    });
  }
});

test("Firefox-compatible host patterns drop ports", () => {
  assert.equal(
    config.hostPermissionPattern("http://127.0.0.1:7878"),
    "http://127.0.0.1/*"
  );
  assert.equal(
    config.hostPermissionPattern("https://arr.example.test:9443/base"),
    "https://arr.example.test/*"
  );
  assert.equal(config.hostPermissionPattern("http://[broken"), "");
});

test("safe result URLs allow only credential-free HTTP(S)", () => {
  assert.equal(
    config.safeHttpUrl("http://tracker.example/details/41"),
    "http://tracker.example/details/41"
  );
  assert.equal(
    config.safeHttpUrl("https://tracker.example/details/42"),
    "https://tracker.example/details/42"
  );
  assert.equal(config.safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(config.safeHttpUrl("https://user:secret@example.test/path"), "");
});

test("service URLs reject active schemes and embedded credentials", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,boom",
    "blob:https://example.test/id",
    "file:///tmp/secret",
    "https://user:secret@example.test/base",
    "http://[broken"
  ]) {
    assert.equal(config.normalizeBaseUrl(value, value), "", value);
    assert.equal(config.hostPermissionPattern(value), "", value);
  }

  assert.equal(
    config.normalizeBaseUrl("localhost:7878/radarr", ""),
    "http://localhost:7878/radarr"
  );
  assert.equal(
    config.normalizeBaseUrl("http://[::1]:8989/sonarr/", ""),
    "http://[::1]:8989/sonarr"
  );
});

test("base URL normalization preserves supported hosts and reverse-proxy paths", async (t) => {
  const cases = [
    ["http://127.0.0.1:7878", "http://127.0.0.1:7878"],
    ["http://localhost:8989", "http://localhost:8989"],
    ["http://[::1]:9696", "http://[::1]:9696"],
    ["http://192.168.1.10:9117", "http://192.168.1.10:9117"],
    ["https://arr.example.com", "https://arr.example.com"],
    ["https://arr.example.com/radarr", "https://arr.example.com/radarr"],
    ["https://arr.example.com/sonarr", "https://arr.example.com/sonarr"],
    ["https://arr.example.com/prowlarr", "https://arr.example.com/prowlarr"],
    ["https://arr.example.com/jackett", "https://arr.example.com/jackett"],
    ["https://example.com/apps/radarr/", "https://example.com/apps/radarr"],
    [
      "https://example.com/apps/radarr/?token=not-a-base-setting#panel",
      "https://example.com/apps/radarr"
    ]
  ];

  for (const [value, expected] of cases) {
    await t.test(value, () => {
      assert.equal(config.normalizeBaseUrl(value, ""), expected);
    });
  }
});

test("API endpoints are appended after reverse-proxy path prefixes", () => {
  const cases = [
    ["https://example.com/apps/radarr", "/api/v3/system/status", {}, "https://example.com/apps/radarr/api/v3/system/status"],
    ["https://example.com/apps/sonarr/", "/api/v3/series/lookup", { term: "tvdb:121361" }, "https://example.com/apps/sonarr/api/v3/series/lookup?term=tvdb%3A121361"],
    ["https://example.com/apps/prowlarr", "/api/v1/search", { query: "Movie" }, "https://example.com/apps/prowlarr/api/v1/search?query=Movie"],
    ["https://example.com/apps/jackett/", "/api/v2.0/indexers/all/results", { t: "caps" }, "https://example.com/apps/jackett/api/v2.0/indexers/all/results?t=caps"]
  ];

  for (const [baseUrl, pathValue, params, expected] of cases) {
    assert.equal(config.buildUrl(baseUrl, pathValue, params), expected);
  }

  assert.equal(
    config.buildUrl("https://example.com/apps/radarr", "/api/v3/system/status"),
    config.buildUrl("https://example.com/apps/radarr/", "/api/v3/system/status")
  );
});

test("stored settings normalize booleans, enums, ids, and limits", () => {
  const settings = config.mergeSettings({
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
  });

  assert.equal(settings.showProwlarrButton, false);
  assert.equal(settings.showJackettButton, false);
  assert.equal(settings.sonarrSeasonFolder, false);
  assert.equal(settings.prowlarrLimit, 100);
  assert.equal(settings.jackettLimit, 1);
  assert.equal(settings.behavior, config.DEFAULT_SETTINGS.behavior);
  assert.equal(
    settings.radarrMinimumAvailability,
    config.DEFAULT_SETTINGS.radarrMinimumAvailability
  );
  assert.equal(settings.sonarrSeriesType, config.DEFAULT_SETTINGS.sonarrSeriesType);
  assert.equal(settings.radarrQualityProfileId, "");
  assert.equal(settings.sonarrQualityProfileId, "12");
});

test("configured service URL checks stay on a trusted origin and base path", () => {
  const settings = config.mergeSettings({
    radarrBaseUrl: "https://arr.example.test/apps/radarr"
  });

  assert.equal(
    config.configuredServiceUrl(
      settings,
      "radarr",
      "https://arr.example.test/apps/radarr/add/new?term=Movie"
    ),
    "https://arr.example.test/apps/radarr/add/new?term=Movie"
  );
  assert.equal(
    config.configuredServiceUrl(settings, "radarr", "https://arr.example.test/apps/radarr"),
    "https://arr.example.test/apps/radarr"
  );
  assert.equal(
    config.configuredServiceUrl(settings, "radarr", "https://arr.example.test/apps/radarr-evil"),
    ""
  );
  assert.equal(
    config.configuredServiceUrl(settings, "radarr", "https://arr.example.test/apps/sonarr"),
    ""
  );
  assert.equal(
    config.configuredServiceUrl(settings, "radarr", "https://arr.example.test/apps/radarr/%2e%2e/admin"),
    ""
  );
  assert.equal(config.configuredServiceUrl(settings, "radarr", "https://evil.example/"), "");
  assert.equal(config.configuredServiceUrl(settings, "radarr", "javascript:alert(1)"), "");
  assert.equal(config.configuredServiceUrl(settings, "unknown", "https://arr.example.test/"), "");
});

test("page-level year signals ignore article and subtitle-row dates", () => {
  assert.equal(
    config.yearFromSignals({
      detailYears: ["2019"],
      jsonLdYears: ["2019-07-26"],
      titleValues: ["The Boys 2019"]
    }),
    2019
  );
  assert.equal(
    config.yearFromSignals({
      detailYears: [],
      jsonLdYears: ["2024-01-10"],
      titleValues: ["Example Show"]
    }),
    2024
  );
  assert.equal(config.yearFromSignals({ titleValues: ["Example Show"] }), null);
});

test("external IDs keep the first trusted page-level value", () => {
  assert.deepEqual(
    config.extractExternalIds([
      "https://www.imdb.com/title/tt0944947/",
      "https://www.themoviedb.org/tv/1399",
      "https://thetvdb.com/series/121361",
      "https://www.imdb.com/title/tt9999999/"
    ]),
    {
      imdbId: "tt0944947",
      tmdbId: 1399,
      tmdbType: "tv",
      tvdbId: 121361
    }
  );
});

test("unknown routes render only when a real detail marker exists", () => {
  assert.equal(config.isBlockedPagePath("/"), true);
  assert.equal(config.isBlockedPagePath("/forum/topic.html"), true);
  assert.equal(config.isBlockedPagePath("/detay/mystery.html"), false);
  assert.equal(config.isLikelyDetailPage("/film/724-michael.html", true), true);
  assert.equal(config.isLikelyDetailPage("/film/724-michael.html", false), false);
  assert.equal(config.isLikelyDetailPage("/detay/mystery.html", true), true);
  assert.equal(config.isLikelyDetailPage("/", true), false);
  assert.equal(config.isLikelyDetailPage("/index.html", true), false);
  assert.equal(config.isLikelyDetailPage("/register.html", true), false);
  assert.equal(config.isLikelyDetailPage("/forum/topic.html", true), false);
  assert.equal(config.isLikelyDetailPage("/admin.php", true), false);
});
