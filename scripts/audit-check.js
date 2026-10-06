"use strict";

// The CI dependency gate: `npm audit`, failing on any high or critical advisory,
// with an explicit list of advisories that cannot be fixed yet. npm itself has no
// way to accept a single advisory, so `npm audit --audit-level=high` would stay red
// until upstream publishes a fix, hiding any new advisory behind the old one.

const { spawnSync } = require("child_process");

const ACCEPTED = {
  // node-forge <= 1.4.0, and 1.4.0 is the latest release (checked 2026-10-06).
  // Reached only through web-ext -> @devicefarmer/adbkit, which web-ext loads to run
  // an extension on Firefox for Android; this project runs `web-ext lint` only, and
  // none of it ships in the extension or the userscript. Remove once node-forge
  // publishes a fixed version.
  "GHSA-86w9-cpqp-85rv": "node-forge RSA PKCS#1 v1.5 signature verification"
};

const BLOCKING = new Set(["high", "critical"]);

function runAudit() {
  // npm is npm.cmd on Windows and needs a shell there; one command string keeps
  // Node from warning about unescaped arguments.
  const result = process.platform === "win32"
    ? spawnSync("npm audit --json", { encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 })
    : spawnSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  if (!result.stdout) {
    console.error(result.stderr || "npm audit produced no output");
    process.exit(2);
  }

  return JSON.parse(result.stdout);
}

function advisoryId(advisory) {
  const match = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(advisory.url || "");
  return match ? match[0] : String(advisory.source);
}

const report = runAudit();
const found = new Map();

for (const [name, vulnerability] of Object.entries(report.vulnerabilities || {})) {
  for (const via of vulnerability.via) {
    // A string names the package that carries the advisory; the advisory itself
    // appears on that package's own entry.
    if (typeof via === "string" || !BLOCKING.has(via.severity)) {
      continue;
    }

    const id = advisoryId(via);
    found.set(id, { name, title: via.title, url: via.url, severity: via.severity });
  }
}

const blocking = [...found].filter(([id]) => !Object.hasOwn(ACCEPTED, id));
const accepted = [...found].filter(([id]) => Object.hasOwn(ACCEPTED, id));
const stale = Object.keys(ACCEPTED).filter((id) => !found.has(id));

for (const [id, item] of accepted) {
  console.log(`accepted ${id} (${item.name}): ${ACCEPTED[id]}`);
}

for (const id of stale) {
  console.log(`accepted ${id} is no longer reported; remove it from scripts/audit-check.js`);
}

if (blocking.length) {
  for (const [id, item] of blocking) {
    console.error(`${item.severity} ${id} (${item.name}): ${item.title} ${item.url}`);
  }
  console.error(`${blocking.length} blocking advisor${blocking.length === 1 ? "y" : "ies"}`);
  process.exit(1);
}

console.log(`npm audit: no blocking advisories (${accepted.length} accepted)`);
