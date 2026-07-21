/* eslint-disable no-console */
/**
 * Manual test helper: replicate exactly what the extension does when you
 * click the Jackett button on a page with IMDb ID tt17220216.
 *
 * Usage:
 *   $env:JACKETT_APIKEY = "..."
 *   $env:JACKETT_BASE_URL = "http://localhost:9117" # optional
 *   node scripts/manual-test-jackett.js
 *
 * Reports:
 *   - Jackett server reachability
 *   - /api/v2.0/indexers/all/results/torznab/api?apikey=...&t=caps (what "Test Jackett" hits)
 *   - /api/v2.0/indexers/all/results?apikey=...&Query=tt17220216 (the real search)
 *   - Top 5 results summarized via the same summarizeJackettRelease() the UI uses
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const EXT = path.resolve(__dirname, "..", "altyazidb-arr-bridge-chrome-0.1.1");
const cfgSrc = fs.readFileSync(path.join(EXT, "src", "config.js"), "utf8");
const sandbox = { globalThis: {}, console };
// eslint-disable-next-line no-new-func
new Function("globalThis", cfgSrc)(sandbox.globalThis);
const CFG = sandbox.globalThis.AdbArrConfig;

if (process.argv.length > 2) {
  console.error("Command-line secrets are not accepted. Use the temporary JACKETT_APIKEY environment variable.");
  process.exit(2);
}

const apikey = process.env.JACKETT_APIKEY || "";
const baseUrl = process.env.JACKETT_BASE_URL || "http://localhost:9117";
const media = {
  title: "Monarch: Legacy of Monsters",
  year: 2023,
  imdbId: "tt17220216",
};

if (!apikey) {
  console.log(
    "No API key provided. Set a temporary JACKETT_APIKEY environment variable.\n" +
      "You can copy it from the Jackett dashboard\n" +
      "(top-right, under 'API Key').",
  );
}

function redact(value) {
  let output = String(value || "");
  if (apikey) output = output.split(apikey).join("[REDACTED]");
  return output.replace(/(apikey\s*[=:]\s*)[^&\s<>'"]+/gi, "$1[REDACTED]");
}

function get(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
  });
}

(async () => {
  console.log("=== Manual Jackett IMDb Search Test ===");
  console.log("Target :", baseUrl);
  console.log("Media  :", media.title, `(${media.year})  imdb:${media.imdbId}`);
  console.log();

  // 1) Reachability
  console.log("[1/3] Reachability probe");
  try {
    const r = await get(baseUrl + "/");
    console.log("  Jackett UI HTTP", r.status, "- OK");
  } catch (e) {
    console.log("  Jackett NOT reachable:", e.message);
    console.log("  → Start Jackett first, then re-run this script.");
    process.exit(1);
  }

  if (!apikey) {
    console.log("\nSkipping API calls (no key provided).");
    const plan = CFG.buildSearchPlan("jackett", media);
    const previewUrl = CFG.buildUrl(baseUrl, plan.apiPath, {
      apikey: "<YOUR_API_KEY>",
      ...plan.apiParams,
    });
    const dashUrl = CFG.buildJackettSearchPageUrl(baseUrl, plan.term);
    console.log("\nURLs the extension would produce:");
    console.log("  search API :", previewUrl);
    console.log("  dashboard  :", dashUrl);
    process.exit(0);
  }

  // 2) Status endpoint (what the fixed "Test Jackett" button hits)
  console.log(
    "\n[2/3] Torznab caps       →  /api/v2.0/indexers/all/results/torznab/api?t=caps",
  );
  try {
    const statusUrl = CFG.buildUrl(
      baseUrl,
      "/api/v2.0/indexers/all/results/torznab/api",
      { apikey, t: "caps" },
    );
    const r = await get(statusUrl);
    console.log("  HTTP", r.status, r.status === 200 ? "(auth OK)" : "");
    if (r.status === 200) {
      console.log("  Caps XML:", /<caps[\s>]/i.test(r.body) ? "present" : "not detected");
    } else {
      console.log("  Response body (truncated):", redact(r.body).slice(0, 200));
    }
  } catch (e) {
    console.log("  ERROR:", e.message);
  }

  // 2b) Invalid key should 401 (proves auth gating works)
  try {
    const bad = "0".repeat(32);
    const badUrl = CFG.buildUrl(
      baseUrl,
      "/api/v2.0/indexers/all/results/torznab/api",
      { apikey: bad, t: "caps" },
    );
    const r = await get(badUrl);
    console.log(
      "  Invalid-key ping:",
      r.status,
      r.status === 401 ? "(rejected, good)" : "(unexpected)",
    );
  } catch (e) {
    console.log("  Invalid-key ping ERROR:", e.message);
  }

  // 3) The actual IMDb search (matches what the extension does)
  console.log(
    "\n[3/3] IMDb search            →  /api/v2.0/indexers/all/results?Query=tt17220216",
  );
  const plan = CFG.buildSearchPlan("jackett", media);
  console.log("  plan.kind   :", plan.kind);
  console.log("  plan.term   :", plan.term);
  console.log("  plan.Query  :", plan.apiParams.Query);
  console.log(
    "  all terms   :",
    JSON.stringify(CFG.jackettTerms(media)),
  );

  const searchUrl = CFG.buildUrl(baseUrl, plan.apiPath, {
    apikey,
    ...plan.apiParams,
  });
  console.log("  URL         :", redact(searchUrl));

  try {
    const r = await get(searchUrl, 30000);
    console.log("  HTTP", r.status);
    if (r.status !== 200) {
      console.log("  Body:", redact(r.body).slice(0, 300));
      process.exit(1);
    }
    const data = JSON.parse(r.body);
    const results = Array.isArray(data?.Results) ? data.Results : [];
    const indexers = Array.isArray(data?.Indexers) ? data.Indexers : [];
    console.log(`  Results: ${results.length}  |  Indexers: ${indexers.length}`);

    // Sort by Seeders desc, same as the extension
    results.sort((a, b) => (b.Seeders || 0) - (a.Seeders || 0));

    const top = results.slice(0, 5).map((r) => CFG.summarizeJackettRelease(r));
    console.log("\n  Top results (as the popup would show them):");
    for (const s of top) {
      console.log(
        `    • [${s.seeders}S/${s.leechers}L] ${s.indexer} :: ${s.title.slice(0, 90)}`,
      );
    }

    // Indexer error diagnostics
    const errs = indexers.filter((i) => i.Error);
    if (errs.length) {
      console.log(`\n  Note: ${errs.length} indexers reported errors:`);
      for (const i of errs.slice(0, 5)) {
        console.log(`    - ${i.ID}: ${i.Error}`);
      }
    }

    const dashUrl = CFG.buildJackettSearchPageUrl(baseUrl, plan.term);
    console.log("\n  Dashboard URL (fallback if popup closes):");
    console.log("   ", dashUrl);
  } catch (e) {
    console.log("  ERROR:", e.message);
    process.exit(1);
  }
})();
