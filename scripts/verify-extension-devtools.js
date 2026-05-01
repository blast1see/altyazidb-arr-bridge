/* eslint-disable no-console */
/**
 * Static "Chrome dev-tools" grade verification for v0.1.3.
 *
 * Because Chrome (policy-controlled) blocks automated --load-extension in
 * headless mode, we instead validate every invariant the chrome://extensions
 * loader would enforce:
 *   1. manifest.json parses, is MV3, version=0.1.3, all referenced files exist
 *   2. host_permissions include Jackett (9117), web_accessible_resources grant
 *      the Jackett reference icon
 *   3. service_worker (background.js) syntax-checks and has access to config
 *   4. content.js + config.js evaluate cleanly and expose AdbArrConfig
 *   5. options.html references every form field that options.js reads
 *   6. PNG assets are real PNG files (magic bytes) with reasonable size
 *   7. Summarize: list every Jackett integration touchpoint for auditor review
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXT_DIR = path.join(ROOT, "altyazidb-arr-bridge-chrome-0.1.1");
const FF_DIR = path.join(ROOT, "altyazidb-arr-bridge-firefox-0.1.1");
const TM = path.join(ROOT, "tampermonkey", "altyazidb-arr-bridge.user.js");

const issues = [];
const ok = [];

function check(name, cond, detail = "") {
  if (cond) {
    ok.push(name + (detail ? `: ${detail}` : ""));
  } else {
    issues.push(name + (detail ? `: ${detail}` : ""));
  }
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function validatePng(p) {
  if (!fileExists(p)) return { ok: false, reason: "missing" };
  const buf = fs.readFileSync(p);
  const header = buf.subarray(0, 8);
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!header.equals(expected)) return { ok: false, reason: "not a PNG" };
  return { ok: true, size: buf.length };
}

// ---------- 1. Manifest checks ----------
function validateManifest(dir, label, expectMv3) {
  console.log(`\n--- ${label} manifest ---`);
  const mfPath = path.join(dir, "manifest.json");
  if (!fileExists(mfPath)) {
    check(`${label} manifest exists`, false);
    return;
  }
  const mf = readJson(mfPath);
  check(`${label} manifest version`, mf.version === "0.1.3", `got ${mf.version}`);
  check(
    `${label} manifest_version`,
    mf.manifest_version === (expectMv3 ? 3 : 2),
    `expected ${expectMv3 ? 3 : 2}, got ${mf.manifest_version}`,
  );
  const hostPerms = expectMv3 ? (mf.host_permissions || []) : (mf.permissions || []);
  const hasJackettLocal = hostPerms.some((p) => p.includes("localhost:9117"));
  const hasJackett127 = hostPerms.some((p) => p.includes("127.0.0.1:9117"));
  check(`${label} has http://localhost:9117 permission`, hasJackettLocal);
  check(`${label} has http://127.0.0.1:9117 permission`, hasJackett127);

  // web_accessible_resources (MV3 is object-array, MV2 is string array)
  let warResources;
  if (expectMv3) {
    warResources = (mf.web_accessible_resources || []).flatMap((g) => g.resources || []);
  } else {
    warResources = mf.web_accessible_resources || [];
  }
  check(
    `${label} exposes jackett-reference.png`,
    warResources.some((r) => r.includes("jackett-reference.png")),
  );
  check(
    `${label} exposes prowlarr-reference.png`,
    warResources.some((r) => r.includes("prowlarr-reference.png")),
  );

  // Every referenced file must exist
  const refs = [];
  if (expectMv3) {
    if (mf.background?.service_worker) refs.push(mf.background.service_worker);
  } else if (mf.background?.scripts) {
    refs.push(...mf.background.scripts);
  }
  for (const entry of mf.content_scripts || []) {
    refs.push(...(entry.js || []), ...(entry.css || []));
  }
  if (mf.options_page) refs.push(mf.options_page);
  if (mf.options_ui?.page) refs.push(mf.options_ui.page);
  for (const iconPath of Object.values(mf.icons || {})) refs.push(iconPath);
  for (const iconPath of Object.values(mf.action?.default_icon || {})) refs.push(iconPath);
  for (const iconPath of Object.values(mf.browser_action?.default_icon || {})) refs.push(iconPath);
  for (const r of refs) {
    check(`${label} file exists: ${r}`, fileExists(path.join(dir, r)));
  }
  for (const r of warResources) {
    check(`${label} WAR file exists: ${r}`, fileExists(path.join(dir, r)));
  }
}

validateManifest(EXT_DIR, "Chrome", true);
validateManifest(FF_DIR, "Firefox", false);

// ---------- 2. PNG assets ----------
console.log("\n--- PNG assets ---");
for (const base of [EXT_DIR, FF_DIR]) {
  const assetDir = path.join(base, "assets");
  for (const f of [
    "icon-16.png",
    "icon-32.png",
    "icon-48.png",
    "icon-128.png",
    "radarr-reference.png",
    "sonarr-reference.png",
    "prowlarr-reference.png",
    "jackett-reference.png",
  ]) {
    const res = validatePng(path.join(assetDir, f));
    check(`${path.basename(base)}/assets/${f}`, res.ok, res.ok ? `${res.size} bytes` : res.reason);
  }
}

// ---------- 3. Source syntax ----------
console.log("\n--- Source syntax ---");
const { execSync } = require("child_process");
for (const base of [EXT_DIR, FF_DIR]) {
  for (const src of ["src/config.js", "src/background.js", "src/content.js", "src/options.js"]) {
    try {
      execSync(`node --check "${path.join(base, src)}"`, { stdio: "pipe" });
      check(`${path.basename(base)}/${src} syntax`, true);
    } catch (e) {
      check(`${path.basename(base)}/${src} syntax`, false, e.stderr?.toString() || e.message);
    }
  }
}
try {
  execSync(`node --check "${TM}"`, { stdio: "pipe" });
  check("tampermonkey/altyazidb-arr-bridge.user.js syntax", true);
} catch (e) {
  check("tampermonkey userscript syntax", false, e.stderr?.toString() || e.message);
}

// ---------- 4. Config integration (load config.js in node, check exports) ----------
console.log("\n--- Config evaluation ---");
try {
  const cfgSrc = fs.readFileSync(path.join(EXT_DIR, "src", "config.js"), "utf8");
  const sandbox = { globalThis: {}, console };
  // eslint-disable-next-line no-new-func
  new Function("globalThis", cfgSrc)(sandbox.globalThis);
  const cfg = sandbox.globalThis.AdbArrConfig;
  check("AdbArrConfig global exposed", !!cfg);
  check("DEFAULT_SETTINGS.jackettBaseUrl (v0.1.3 uses 127.0.0.1)", cfg?.DEFAULT_SETTINGS?.jackettBaseUrl === "http://127.0.0.1:9117");
  check("DEFAULT_SETTINGS.radarrBaseUrl (v0.1.3 uses 127.0.0.1)", cfg?.DEFAULT_SETTINGS?.radarrBaseUrl === "http://127.0.0.1:7878");
  check("DEFAULT_SETTINGS.sonarrBaseUrl (v0.1.3 uses 127.0.0.1)", cfg?.DEFAULT_SETTINGS?.sonarrBaseUrl === "http://127.0.0.1:8989");
  check("DEFAULT_SETTINGS.prowlarrBaseUrl (v0.1.3 uses 127.0.0.1)", cfg?.DEFAULT_SETTINGS?.prowlarrBaseUrl === "http://127.0.0.1:9696");
  check("DEFAULT_SETTINGS.jackettApiKey defined", typeof cfg?.DEFAULT_SETTINGS?.jackettApiKey === "string");
  check("DEFAULT_SETTINGS.showJackettButton=true", cfg?.DEFAULT_SETTINGS?.showJackettButton === true);
  check("DEFAULT_SETTINGS.jackettLimit=25", cfg?.DEFAULT_SETTINGS?.jackettLimit === 25);
  check("DEFAULT_SETTINGS.jackettIndexer='all'", cfg?.DEFAULT_SETTINGS?.jackettIndexer === "all");
  check("SERVICE_LABELS.jackett='Jackett'", cfg?.SERVICE_LABELS?.jackett === "Jackett");
  check("buildJackettSearchPageUrl is a fn", typeof cfg?.buildJackettSearchPageUrl === "function");
  check("summarizeJackettRelease is a fn", typeof cfg?.summarizeJackettRelease === "function");
  check("jackettTerm is a fn", typeof cfg?.jackettTerm === "function");
  check("jackettTerms is a fn", typeof cfg?.jackettTerms === "function");

  // Functional smoke tests
  const url = cfg.buildJackettSearchPageUrl("http://127.0.0.1:9117", "The Boys 2019");
  check(
    "buildJackettSearchPageUrl → hash-fragment",
    url === "http://127.0.0.1:9117/UI/Dashboard#search=The%20Boys%202019",
    url,
  );
  const plan = cfg.buildSearchPlan("jackett", { title: "Michael", year: 2024 });
  check("buildSearchPlan('jackett') returns apiPath", plan.apiPath === "/api/v2.0/indexers/all/results");
  check("buildSearchPlan('jackett') returns Query param", typeof plan.apiParams?.Query === "string");

  const summary = cfg.summarizeJackettRelease({
    Title: "Test.Movie.2024.1080p",
    Tracker: "Test Indexer",
    Size: 123456789,
    Seeders: 42,
    Peers: 50,
    PublishDate: "2024-01-01",
    MagnetUri: "magnet:?xt=urn:btih:abc",
    Details: "https://example/details",
    Guid: "abc-guid",
    TrackerId: "test-id",
  });
  check("summarizeJackettRelease normalizes Title→title", summary.title === "Test.Movie.2024.1080p");
  check("summarizeJackettRelease normalizes Tracker→indexer", summary.indexer === "Test Indexer");
  check("summarizeJackettRelease protocol=torrent for magnet", summary.protocol === "torrent");
  check("summarizeJackettRelease leechers = peers-seeders", summary.leechers === 8);

  check("serviceBaseUrl('jackett')", cfg.serviceBaseUrl({ jackettBaseUrl: "X" }, "jackett") === "X");
  check("serviceApiKey('jackett')", cfg.serviceApiKey({ jackettApiKey: "KEY" }, "jackett") === "KEY");
} catch (e) {
  check("Config evaluation", false, e.message);
}

// ---------- 5. Options form/JS wiring ----------
console.log("\n--- Options wiring ---");
const optionsHtml = fs.readFileSync(path.join(EXT_DIR, "options.html"), "utf8");
const optionsJs = fs.readFileSync(path.join(EXT_DIR, "src", "options.js"), "utf8");
for (const id of [
  "jackettBaseUrl",
  "jackettApiKey",
  "jackettIndexer",
  "jackettLimit",
  "showJackettButton",
  "testJackett",
]) {
  check(`options.html has id="${id}"`, optionsHtml.includes(`id="${id}"`));
  check(`options.js references "${id}"`, optionsJs.includes(id));
}
check(
  "options.js wires testJackett click handler",
  /testJackett[^)]*click.*\btestConnection\("jackett"/s.test(optionsJs) ||
    optionsJs.includes('testConnection("jackett"'),
);

// ---------- 6. Content script rendering wiring ----------
console.log("\n--- Content script Jackett wiring ---");
const contentJs = fs.readFileSync(path.join(EXT_DIR, "src", "content.js"), "utf8");
check('content.js includes jackett in serviceForMedia', contentJs.includes('extras.push("jackett")'));
check('content.js buttonLabel handles jackett', /service === "jackett"/.test(contentJs));
check('content.js iconAssetPath for jackett', contentJs.includes("jackett-reference.png"));
check(
  "content.js resultMeta treats jackett like prowlarr",
  /service === "prowlarr" \|\| service === "jackett"/.test(contentJs),
);

// ---------- 7. Background.js Jackett integration ----------
console.log("\n--- Background Jackett integration ---");
const bgJs = fs.readFileSync(path.join(EXT_DIR, "src", "background.js"), "utf8");
check("background.js has lookupJackett fn", /async function lookupJackett/.test(bgJs));
check(
  "background.js statusPath jackett uses apikey-compatible endpoint",
  bgJs.includes("/api/v2.0/indexers/all/results") &&
    bgJs.includes('"__adb_ping__"'),
);
check(
  "background.js no longer CALLS /api/v2.0/server/config (302s with apikey)",
  !/return\s+[{"'`][^}]*\/api\/v2\.0\/server\/config/.test(bgJs) &&
    !/callArrApi\([^)]*["'`]\/api\/v2\.0\/server\/config["'`]/.test(bgJs),
);
check(
  "background.js callArrApi uses apikey query param for jackett",
  /service === "jackett" && apiKey/.test(bgJs),
);
check(
  "background.js skips X-Api-Key header for jackett",
  /service !== "jackett"/.test(bgJs),
);
check(
  "background.js has isLikelyCorsError helper (v0.1.3 CORS detection)",
  /function\s+isLikelyCorsError/.test(bgJs),
);
check(
  "background.js has fetchFailureMessage helper (v0.1.3 CORS detection)",
  /function\s+fetchFailureMessage/.test(bgJs),
);
check(
  "background.js surfaces CORS-specific Jackett hint",
  /Jackett blocked by CORS/.test(bgJs),
);
check(
  "background.js catch block routes through fetchFailureMessage",
  /fetchFailureMessage\(service,\s*baseUrl,\s*error\)/.test(bgJs),
);

// Mirror assertions against the Firefox bundle
const ffBgJs = fs.readFileSync(path.join(FF_DIR, "src", "background.js"), "utf8");
check(
  "firefox background.js has isLikelyCorsError helper",
  /function\s+isLikelyCorsError/.test(ffBgJs),
);
check(
  "firefox background.js surfaces CORS-specific Jackett hint",
  /Jackett blocked by CORS/.test(ffBgJs),
);
check(
  "firefox background.js catch block routes through fetchFailureMessage",
  /fetchFailureMessage\(service,\s*baseUrl,\s*error\)/.test(ffBgJs),
);

// ---------- 8. Tampermonkey Jackett integration ----------
console.log("\n--- Tampermonkey Jackett integration ---");
const tm = fs.readFileSync(TM, "utf8");
check("tm userscript @version 0.1.3-tm", tm.includes("@version      0.1.3-tm"));
check("tm userscript mentions Jackett in @description", tm.includes("Jackett buttons"));
check("tm DEFAULT_SETTINGS.jackettBaseUrl (v0.1.3 uses 127.0.0.1)", tm.includes('jackettBaseUrl: "http://127.0.0.1:9117"'));
check("tm SERVICE_LABELS.jackett", tm.includes('jackett: "Jackett"'));
check("tm ICONS.jackett defined", /jackett:\s*pngData/.test(tm));
check("tm lookupJackett function", /async function lookupJackett/.test(tm));
check("tm buildJackettSearchPageUrl function", /function buildJackettSearchPageUrl/.test(tm));
check("tm options form has adbJackettBaseUrl", tm.includes('id="adbJackettBaseUrl"'));

// ---------- 9. Summary ----------
console.log(`\n==== SUMMARY ====`);
console.log(`PASS: ${ok.length}`);
console.log(`FAIL: ${issues.length}`);
if (issues.length) {
  console.log("\nFailures:");
  for (const i of issues) console.log("  ✗", i);
  process.exit(1);
}
console.log("\nAll Chrome dev-tools loader invariants satisfied for v0.1.3.");
console.log("To verify the runtime service worker in a live Chrome UI:");
console.log("  1. Open chrome://extensions, enable Developer mode");
console.log(`  2. Click 'Load unpacked', pick: ${EXT_DIR}`);
console.log("  3. Click 'service worker' (blue link) to open DevTools on the SW");
console.log("  4. Network tab will show Radarr/Sonarr/Prowlarr/Jackett pings");
