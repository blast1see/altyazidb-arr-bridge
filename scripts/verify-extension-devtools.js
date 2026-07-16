"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const chromeDir = path.join(root, "altyazidb-arr-bridge-chrome-0.1.1");
const firefoxDir = path.join(root, "altyazidb-arr-bridge-firefox-0.1.1");
const version = "0.1.4";
let checks = 0;

function check(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateReferencedFiles(dir, manifest) {
  const references = [];

  if (manifest.background?.service_worker) {
    references.push(manifest.background.service_worker);
  }

  references.push(...(manifest.background?.scripts || []));

  for (const script of manifest.content_scripts || []) {
    references.push(...(script.js || []), ...(script.css || []));
  }

  if (manifest.options_page) {
    references.push(manifest.options_page);
  }

  references.push(...Object.values(manifest.icons || {}));
  references.push(...Object.values(manifest.action?.default_icon || {}));
  references.push(...Object.values(manifest.browser_action?.default_icon || {}));

  const webResources = manifest.manifest_version === 3
    ? (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
    : (manifest.web_accessible_resources || []);
  references.push(...webResources);

  for (const reference of new Set(references)) {
    check(
      fs.existsSync(path.join(dir, reference)),
      `${path.basename(dir)} references missing file: ${reference}`
    );
  }
}

function validateManifest(dir, manifest, expectedManifestVersion) {
  check(manifest.version === version, `${path.basename(dir)} version must be ${version}`);
  check(
    manifest.manifest_version === expectedManifestVersion,
    `${path.basename(dir)} manifest version mismatch`
  );
  check(!(manifest.permissions || []).includes("tabs"), `${path.basename(dir)} must not request tabs`);

  const hostPermissions = expectedManifestVersion === 3
    ? manifest.host_permissions || []
    : manifest.permissions || [];

  check(hostPermissions.includes("http://localhost/*"), `${path.basename(dir)} localhost permission missing`);
  check(hostPermissions.includes("http://127.0.0.1/*"), `${path.basename(dir)} 127.0.0.1 permission missing`);
  check(
    hostPermissions.every((permission) => !/localhost:\d+|127\.0\.0\.1:\d+/.test(permission)),
    `${path.basename(dir)} contains a port-specific match pattern`
  );

  validateReferencedFiles(dir, manifest);
}

const chromeManifest = readJson(path.join(chromeDir, "manifest.json"));
const firefoxManifest = readJson(path.join(firefoxDir, "manifest.json"));
validateManifest(chromeDir, chromeManifest, 3);
validateManifest(firefoxDir, firefoxManifest, 2);

check(
  (chromeManifest.optional_host_permissions || []).includes("http://*/*") &&
    (chromeManifest.optional_host_permissions || []).includes("https://*/*"),
  "Chrome optional host permissions missing"
);
check(
  (firefoxManifest.optional_permissions || []).includes("http://*/*") &&
    (firefoxManifest.optional_permissions || []).includes("https://*/*"),
  "Firefox optional host permissions missing"
);

for (const relativePath of [
  "src/background.js",
  "src/config.js",
  "src/content.js",
  "src/options.js",
  "options.html",
  "styles/content.css"
]) {
  const chromeFile = fs.readFileSync(path.join(chromeDir, relativePath));
  const firefoxFile = fs.readFileSync(path.join(firefoxDir, relativePath));
  check(chromeFile.equals(firefoxFile), `Chrome/Firefox mismatch: ${relativePath}`);
}

const background = read("altyazidb-arr-bridge-chrome-0.1.1/src/background.js");
const content = read("altyazidb-arr-bridge-chrome-0.1.1/src/content.js");
const options = read("altyazidb-arr-bridge-chrome-0.1.1/src/options.js");
const optionsHtml = read("altyazidb-arr-bridge-chrome-0.1.1/options.html");
const userscript = read("tampermonkey/altyazidb-arr-bridge.user.js");
const packageScript = read("scripts/package.ps1");

check(!/Jackett blocked by CORS|AllowCORS=false/.test(background), "Background still reports generic network failures as CORS");
check(background.includes("/results/torznab/api"), "Jackett caps endpoint missing");
check(background.includes('params: { t: "caps" }'), "Jackett caps request missing t=caps");
check(background.includes("host permission is missing"), "Background permission guard missing");
check(background.includes("CFG.safeHttpUrl(result.infoUrl)"), "Safe infoUrl handling missing");
check(content.includes("CFG.detectSeasonEpisode(window.location.pathname, rawTitle)"), "Page-level season parser missing");
check(!/detectSeasonEpisode\(snapshot\)/.test(content), "Content parser still passes the full page snapshot");
check(options.includes("CFG.hostPermissionPattern(baseUrl)"), "Options do not use portless host permission patterns");
check(options.includes("No connection request was sent."), "Permission rejection message missing");
check(optionsHtml.includes("Popup result limit"), "Jackett popup limit label missing");
check(userscript.includes("@version      0.1.4-tm"), "Tampermonkey version mismatch");
check(!/Jackett blocked by CORS|AllowCORS=false/.test(userscript), "Tampermonkey still reports generic failures as CORS");
check(packageScript.includes("0.1.4"), "Package script release version was not updated");

console.log(`Package verification OK (${checks} checks).`);
