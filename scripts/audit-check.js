"use strict";

// The CI dependency gate: `npm audit`, failing on any high or critical advisory,
// with an explicit list of advisories that cannot be fixed yet. npm itself has no
// way to accept a single advisory, so `npm audit --audit-level=high` would stay red
// until upstream publishes a fix, hiding any new advisory behind the old one.

const { spawnSync } = require("child_process");

// Each entry: advisory id -> reason, with the latest release checked and why the
// affected code is not reached by anything this project runs or ships. Empty since
// node-forge 1.4.3 fixed GHSA-86w9-cpqp-85rv (checked 2026-11-22).
const ACCEPTED = {};

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
