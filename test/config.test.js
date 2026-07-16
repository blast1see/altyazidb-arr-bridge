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
    config.safeHttpUrl("https://tracker.example/details/42"),
    "https://tracker.example/details/42"
  );
  assert.equal(config.safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(config.safeHttpUrl("https://user:secret@example.test/path"), "");
});
