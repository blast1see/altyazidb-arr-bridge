/* eslint-disable no-console */
/**
 * End-to-end verification for AltyaziDB Arr Bridge v0.1.4.
 * Launches system Chrome with the unpacked extension loaded, visits
 * forum + subtitle URLs, and reports button/shell state.
 *
 *   node scripts/verify-extension-e2e.js
 */
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const REPO = path.resolve(__dirname, "..");
const EXT_DIR = path.join(REPO, "altyazidb-arr-bridge-chrome-0.1.1");
const OUT_DIR = path.join("C:", "Users", "Mert", "Desktop");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env["LOCALAPPDATA"] + "\\Google\\Chrome\\Application\\chrome.exe",
];

const URLS = [
  {
    label: "forum_topic",
    url: "https://altyazidb.com/forum/moduller-eklentiler/7-altyazidb-arr-bridge-altyazidbyi-radarr-sonarr-prowlarr-ile-eslestiren-tarayici-eklentisi.html",
    expectButtons: false,
  },
  {
    label: "forum_root",
    url: "https://altyazidb.com/forum/",
    expectButtons: false,
  },
  {
    label: "home",
    url: "https://altyazidb.com/",
    expectButtons: false,
  },
  {
    label: "film_michael",
    url: "https://altyazidb.com/film/724-michael.html",
    expectButtons: true,
  },
  {
    label: "dizi_theboys",
    url: "https://altyazidb.com/dizi/186-the-boys.html",
    expectButtons: true,
  },
];

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error("Could not locate chrome.exe");
}

async function waitForInjection(page, timeoutMs = 30000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate(() => ({
      shell: !!document.getElementById("altyazidb-arr-bridge"),
      buttons: document.querySelectorAll(".adb-arr-button").length,
      mediaType:
        document.getElementById("altyazidb-arr-bridge")?.dataset?.mediaType ||
        null,
      status:
        document.querySelector(".adb-arr-status")?.textContent?.trim() || null,
      pathname: location.pathname,
    }));
    if (last.shell || last.buttons > 0) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

(async () => {
  if (!fs.existsSync(path.join(EXT_DIR, "manifest.json"))) {
    console.error("Extension manifest not found at", EXT_DIR);
    process.exit(2);
  }
  const chromePath = findChrome();
  console.log("Chrome:", chromePath);
  console.log("Extension:", EXT_DIR);

  const userDataDir = path.join(
    process.env["TEMP"] || "C:\\Windows\\Temp",
    `adb-e2e-profile-${Date.now()}`,
  );
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: { width: 1366, height: 900 },
    userDataDir,
    ignoreDefaultArgs: [
      "--disable-extensions",
      "--enable-automation",
      "--disable-component-extensions-with-background-pages",
    ],
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,DisableLoadExtensionCommandLineSwitch",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  // Give Chrome/extension SW time to register before first nav
  await new Promise((r) => setTimeout(r, 5000));

  // Open chrome://extensions briefly to force Chrome to register the load-extension arg
  try {
    const setupPage = await browser.newPage();
    await setupPage.goto("chrome://extensions/", { timeout: 5000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    await setupPage.close().catch(() => {});
  } catch (_) {}

  // Dump loaded extension targets for visibility
  let ourExtId = null;
  try {
    const targets = await browser.targets();
    const extTargets = targets
      .filter((t) => t.url().startsWith("chrome-extension://"))
      .map((t) => ({ type: t.type(), url: t.url() }));
    console.log("Extension targets:", JSON.stringify(extTargets, null, 2));
    // Probe each extension ID's manifest to find ours
    const probePage = await browser.newPage();
    const ids = new Set();
    for (const t of extTargets) {
      const m = /chrome-extension:\/\/([a-z]+)/.exec(t.url);
      if (m) ids.add(m[1]);
    }
    for (const id of ids) {
      try {
        await probePage.goto(`chrome-extension://${id}/manifest.json`, {
          timeout: 5000,
        });
        const body = await probePage.evaluate(() => document.body?.innerText || "");
        if (body.includes("AltyaziDB Arr Bridge")) {
          ourExtId = id;
          console.log("  >>> our extension id:", id);
          console.log("  >>> manifest snippet:", body.slice(0, 200));
        } else {
          console.log("  other ext", id, body.slice(0, 80));
        }
      } catch (e) {
        console.log("  probe error", id, e.message);
      }
    }
    await probePage.close().catch(() => {});
  } catch (e) {
    console.log("targets introspection failed:", e.message);
  }

  if (!ourExtId) {
    console.log(
      "\n!!! Our extension did not register a target. Attempting chrome://extensions page to force load...",
    );
    const x = await browser.newPage();
    await x.goto("chrome://extensions/", { timeout: 8000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    await x.close().catch(() => {});
  }

  const results = [];
  try {
    for (const target of URLS) {
      const page = await browser.newPage();
      const consoleMsgs = [];
      page.on("console", (msg) =>
        consoleMsgs.push(`[${msg.type()}] ${msg.text()}`),
      );
      page.on("pageerror", (err) =>
        consoleMsgs.push(`[pageerror] ${err.message}`),
      );
      console.log(`\n== ${target.label} == ${target.url}`);
      try {
        await page.goto(target.url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
      } catch (e) {
        console.log("  goto warning:", e.message);
      }
      // Scroll through page to trigger lazy mounts
      await page.evaluate(() => {
        return new Promise((res) => {
          let y = 0;
          const step = () => {
            window.scrollTo(0, y);
            y += 500;
            if (y < document.body.scrollHeight) setTimeout(step, 120);
            else {
              window.scrollTo(0, 0);
              res();
            }
          };
          step();
        });
      }).catch(() => {});
      // Give the retry loop time
      const snap = await waitForInjection(page, 28000);
      // Dump mount-candidate info if shell absent
      if (!snap?.shell) {
        const diag = await page.evaluate(() => ({
          v2DetailTitle: !!document.querySelector(".v2-detail-title"),
          altyaziMerkezi: !!document.getElementById("altyazi-merkezi"),
          altyaziTablosu: !!document.getElementById("altyazi-tablosu-alani"),
          movieInfoCard: !!document.querySelector(".movie-info-card"),
          fsActionRow: !!document.querySelector(".fs-action-row"),
          dleContent: !!document.getElementById("dle-content"),
          bodyLen: document.body?.innerHTML?.length || 0,
        }));
        console.log("  DOM diag:", JSON.stringify(diag));
      }
      if (consoleMsgs.length) {
        console.log(
          "  console (" + consoleMsgs.length + "):",
          consoleMsgs.slice(0, 15).join(" | "),
        );
      }
      const screenshot = path.join(
        OUT_DIR,
        `e2e_v014_${target.label}.png`,
      );
      try {
        await page.screenshot({ path: screenshot, fullPage: true });
      } catch (e) {
        console.log("  screenshot error:", e.message);
      }
      const pass =
        (target.expectButtons && snap?.shell && snap.buttons > 0) ||
        (!target.expectButtons && !snap?.shell && (snap?.buttons ?? 0) === 0);
      results.push({
        label: target.label,
        url: target.url,
        expected: target.expectButtons ? "render" : "skip",
        ...snap,
        screenshot,
        pass,
      });
      console.log(" ", JSON.stringify(snap));
      console.log(" ", pass ? "PASS" : "FAIL");
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log("\n==== SUMMARY ====");
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    pad("label", 18),
    pad("expected", 10),
    pad("shell", 6),
    pad("btns", 5),
    pad("mediaType", 10),
    "status",
  );
  for (const r of results) {
    console.log(
      pad(r.label, 18),
      pad(r.expected, 10),
      pad(r.shell ? "yes" : "no", 6),
      pad(r.buttons ?? 0, 5),
      pad(r.mediaType || "-", 10),
      r.status || "-",
    );
  }
  const allPass = results.every((r) => r.pass);
  console.log(
    "\nOverall:",
    allPass ? "ALL PASS ✅" : "FAILURES PRESENT ❌",
  );
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(3);
});
