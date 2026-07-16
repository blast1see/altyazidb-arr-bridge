// Verifies the v0.1.4 isLikelyDetailPage() URL gating against real AltyaziDB URLs.
const SUBTITLE_PATH_RE =
  /^\/(?:film|dizi|anime-filmleri|anime-dizileri|animasyon-filmleri|animasyon-dizileri|asya-filmleri|asya-dizileri|belgesel-filmleri|belgesel-dizileri|tv-programlari)\//i;
const NON_SUBTITLE_PATH_RE =
  /^\/(?:forum|user|uploads|engine|index\.php|search|page|lastnews|allnews|tags|stats|statistics|register|login|lostpassword|autobackup|admin|index)(?:\/|$)/i;

function isLikelyDetailPage(pathname) {
  const path = pathname || "/";
  if (NON_SUBTITLE_PATH_RE.test(path)) return false;
  return SUBTITLE_PATH_RE.test(path);
}

const cases = [
  // Should be FALSE (no buttons)
  { expected: false, url: "https://altyazidb.com/forum/moduller-eklentiler/7-altyazidb-arr-bridge-altyazidbyi-radarr-sonarr-prowlarr-ile-eslestiren-tarayici-eklentisi.html" },
  { expected: false, url: "https://altyazidb.com/forum/" },
  { expected: false, url: "https://altyazidb.com/forum" },
  { expected: false, url: "https://altyazidb.com/user/blast1see/" },
  { expected: false, url: "https://altyazidb.com/search/" },
  { expected: false, url: "https://altyazidb.com/" },
  { expected: false, url: "https://altyazidb.com/index.php?do=feedback" },
  { expected: false, url: "https://altyazidb.com/admin.php" },
  { expected: false, url: "https://altyazidb.com/lastnews/" },
  { expected: false, url: "https://altyazidb.com/page/2/" },
  { expected: false, url: "https://altyazidb.com/register.html" },

  // Should be TRUE (buttons render)
  { expected: true, url: "https://altyazidb.com/film/724-michael.html" },
  { expected: true, url: "https://altyazidb.com/dizi/186-the-boys.html" },
  { expected: true, url: "https://altyazidb.com/anime-dizileri/123-one-piece.html" },
  { expected: true, url: "https://altyazidb.com/anime-filmleri/45-akira.html" },
  { expected: true, url: "https://altyazidb.com/animasyon-filmleri/9-wall-e.html" },
  { expected: true, url: "https://altyazidb.com/animasyon-dizileri/7-arcane.html" },
  { expected: true, url: "https://altyazidb.com/asya-filmleri/77-parasite.html" },
  { expected: true, url: "https://altyazidb.com/asya-dizileri/50-squid-game.html" },
  { expected: true, url: "https://altyazidb.com/belgesel-filmleri/21-planet-earth.html" },
  { expected: true, url: "https://altyazidb.com/belgesel-dizileri/33-chefs-table.html" },
  { expected: true, url: "https://altyazidb.com/tv-programlari/15-some-show.html" },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const u = new URL(c.url);
  const actual = isLikelyDetailPage(u.pathname);
  const ok = actual === c.expected;
  if (ok) pass++; else fail++;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  expected=${c.expected}  actual=${actual}  ${c.url}`);
}

console.log(`\n${pass} passed, ${fail} failed (of ${cases.length}).`);
process.exit(fail ? 1 : 0);
