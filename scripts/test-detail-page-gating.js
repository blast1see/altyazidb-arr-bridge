// Verifies detail-page gating against real AltyaziDB paths and unknown detail routes.
require("../altyazidb-arr-bridge-chrome-0.1.1/src/config.js");

const { isLikelyDetailPage } = globalThis.AdbArrConfig;
const cases = [
  // Non-detail locations stay blocked even if their layout contains generic markers.
  { expected: false, marker: true, url: "https://altyazidb.com/forum/moduller-eklentiler/7-altyazidb-arr-bridge.html" },
  { expected: false, marker: true, url: "https://altyazidb.com/forum/" },
  { expected: false, marker: true, url: "https://altyazidb.com/user/blast1see/" },
  { expected: false, marker: true, url: "https://altyazidb.com/search/" },
  { expected: false, marker: true, url: "https://altyazidb.com/" },
  { expected: false, marker: true, url: "https://altyazidb.com/index.php?do=feedback" },
  { expected: false, marker: true, url: "https://altyazidb.com/index.html" },
  { expected: false, marker: true, url: "https://altyazidb.com/admin.php" },
  { expected: false, marker: true, url: "https://altyazidb.com/lastnews/" },
  { expected: false, marker: true, url: "https://altyazidb.com/page/2/" },
  { expected: false, marker: true, url: "https://altyazidb.com/register.html" },

  // Known media routes still require a resolved detail DOM marker.
  { expected: false, marker: false, url: "https://altyazidb.com/film/724-michael.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/film/724-michael.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/dizi/186-the-boys.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/anime-dizileri/123-one-piece.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/anime-filmleri/45-akira.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/animasyon-filmleri/9-wall-e.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/animasyon-dizileri/7-arcane.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/asya-filmleri/77-parasite.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/asya-dizileri/50-squid-game.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/belgesel-filmleri/21-planet-earth.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/belgesel-dizileri/33-chefs-table.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/tv-programlari/15-some-show.html" },

  // An unrecognized route may be a genuine detail page, but only with a strong marker.
  { expected: false, marker: false, url: "https://altyazidb.com/detay/mystery.html" },
  { expected: true, marker: true, url: "https://altyazidb.com/detay/mystery.html" }
];

let pass = 0;
let fail = 0;

for (const testCase of cases) {
  const url = new URL(testCase.url);
  const actual = isLikelyDetailPage(url.pathname, testCase.marker);
  const ok = actual === testCase.expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  expected=${testCase.expected}  actual=${actual}  marker=${testCase.marker}  ${testCase.url}`);
}

console.log(`\n${pass} passed, ${fail} failed (of ${cases.length}).`);
process.exit(fail ? 1 : 0);
