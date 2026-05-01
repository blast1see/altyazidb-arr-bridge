/* eslint-disable no-console */
/**
 * Functional test: verify Jackett IMDB ID search path.
 * Loads AdbArrConfig and asserts that:
 *   - media with imdbId → search plan Query = "tt..."
 *   - media without imdbId → search plan Query = "Title 2024" (text fallback)
 *   - dashboard URL uses the tt-id when imdb present
 */
"use strict";
const fs = require("fs");
const path = require("path");

const EXT = path.resolve(
  __dirname,
  "..",
  "altyazidb-arr-bridge-chrome-0.1.1",
);
const src = fs.readFileSync(path.join(EXT, "src", "config.js"), "utf8");
const sandbox = { globalThis: {}, console };
// eslint-disable-next-line no-new-func
new Function("globalThis", src)(sandbox.globalThis);
const cfg = sandbox.globalThis.AdbArrConfig;

let fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `\n   got=${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`);
  if (!ok) fail++;
}

// 1) With IMDb ID (the user's example: Monarch: Legacy of Monsters)
const withImdb = { title: "Monarch: Legacy of Monsters", year: 2023, imdbId: "tt17220216" };
const planA = cfg.buildSearchPlan("jackett", withImdb);
eq("plan.kind with imdbId", planA.kind, "imdb");
eq("plan.term with imdbId", planA.term, "tt17220216");
eq("plan.apiParams.Query with imdbId", planA.apiParams.Query, "tt17220216");
eq("plan.fallbackTerm with imdbId", planA.fallbackTerm, "tt17220216");
eq(
  "jackettTerms[0] is the imdb id",
  cfg.jackettTerms(withImdb)[0],
  "tt17220216",
);
console.log("  jackettTerms cascade:", cfg.jackettTerms(withImdb));
eq(
  "dashboard URL uses tt id",
  cfg.buildJackettSearchPageUrl("http://localhost:9117", cfg.jackettTerm(withImdb)),
  "http://localhost:9117/UI/Dashboard#search=tt17220216",
);

// 2) Without IMDb ID → title+year fallback
const noImdb = { title: "The Boys", year: 2019 };
const planB = cfg.buildSearchPlan("jackett", noImdb);
eq("plan.kind without imdbId", planB.kind, "query");
eq("plan.term without imdbId contains title", planB.term.toLowerCase().includes("boys"), true);
eq("plan.term without imdbId contains year", planB.term.includes("2019"), true);
console.log("  jackettTerms cascade:", cfg.jackettTerms(noImdb));

// 3) Malformed imdbId should be ignored (falls back to title)
const bogus = { title: "Foo", year: 2024, imdbId: "not-an-id" };
const planC = cfg.buildSearchPlan("jackett", bogus);
eq("malformed imdbId ignored → kind=query", planC.kind, "query");
eq("malformed imdbId ignored → Query is text", planC.apiParams.Query.includes("Foo"), true);

// 4) Case tolerance: TT17220216 → normalized to tt17220216
const mixedCase = { title: "X", year: 2024, imdbId: "TT17220216" };
const planD = cfg.buildSearchPlan("jackett", mixedCase);
eq("uppercase TT normalized to tt", planD.apiParams.Query, "tt17220216");

if (fail) {
  console.log(`\nFAILED: ${fail} check(s)`);
  process.exit(1);
}
console.log("\nAll Jackett IMDb ID search checks passed.");
