/* eslint-disable no-console */
/**
 * Alternative E2E: inject the v0.1.4 content script INTO the page with
 * stubbed chrome/browser API so we can verify the code works on live DOM
 * without relying on Chrome's --load-extension flag (which is blocked by
 * policy in newer Chrome versions).
 *
 *   node scripts/verify-inject-e2e.js
 */
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const REPO = path.resolve(__dirname, "..");
const EXT_DIR = path.join(REPO, "altyazidb-arr-bridge-chrome-0.1.1");
const CONFIG_JS = fs.readFileSync(
  path.join(EXT_DIR, "src", "config.js"),
  "utf8",
);
const CONTENT_JS = fs.readFileSync(
  path.join(EXT_DIR, "src", "content.js"),
  "utf8",
);
const CONTENT_CSS = fs.readFileSync(
  path.join(EXT_DIR, "styles", "content.css"),
  "utf8",
);
const OUT_DIR = path.join("C:", "Users", "Mert", "Desktop");
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
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

// This will be serialized and run IN THE PAGE CONTEXT.
// It stubs chrome/browser APIs and then evaluates config.js + content.js.
const pageBootstrap = `
(function(adbConfigSrc, adbContentSrc, adbCssSrc) {
  // Stub extension API surface used by content.js
  const noop = () => {};
  const stub = {
    runtime: {
      sendMessage: () => new Promise(() => {}), // never resolves — prevents network calls
      getURL: (p) => "data:," + encodeURIComponent(p),
      lastError: null,
      id: "adb-e2e-injected",
    },
    storage: {
      local: {
        get: (defaults) => Promise.resolve(defaults || {}),
        set: () => Promise.resolve(),
      },
    },
  };
  if (!globalThis.browser) globalThis.browser = stub;
  if (!globalThis.chrome) globalThis.chrome = stub;

  // Inject the extension CSS
  try {
    const style = document.createElement("style");
    style.id = "adb-e2e-injected-css";
    style.textContent = adbCssSrc;
    document.head.appendChild(style);
  } catch (e) { console.error("css inject failed", e); }

  // Evaluate config.js then content.js in page scope
  try {
    const s1 = document.createElement("script");
    s1.textContent = adbConfigSrc + "\\n//# sourceURL=adb_config_injected.js";
    document.documentElement.appendChild(s1);
    const s2 = document.createElement("script");
    s2.textContent = adbContentSrc + "\\n//# sourceURL=adb_content_injected.js";
    document.documentElement.appendChild(s2);
    return { injected: true };
  } catch (e) {
    return { injected: false, error: String(e) };
  }
})
`;

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error("chrome.exe not found");
}

async function waitForShell(page, ms = 30000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < ms) {
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
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

(async () => {
  const chromePath = findChrome();
  console.log("Chrome:", chromePath);
  console.log("Extension source dir:", EXT_DIR);
  const userDataDir = path.join(
    process.env["TEMP"] || "C:\\Windows\\Temp",
    `adb-inject-profile-${Date.now()}`,
  );
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    defaultViewport: { width: 1366, height: 900 },
    userDataDir,
    args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check"],
  });

  const results = [];
  try {
    for (const target of URLS) {
      const page = await browser.newPage();
      const consoleMsgs = [];
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning")
          consoleMsgs.push(`[${m.type()}] ${m.text()}`);
      });
      page.on("pageerror", (e) =>
        consoleMsgs.push(`[pageerror] ${e.message}`),
      );

      console.log(`\n== ${target.label} == ${target.url}`);
      try {
        await page.goto(target.url, {
          waitUntil: "networkidle2",
          timeout: 45000,
        });
      } catch (e) {
        console.log("  goto warning:", e.message);
      }

      // Inject v0.1.4 content.js into the page
      const injectRes = await page.evaluate(
        (bootstrap, cfg, content, css) => {
          // eslint-disable-next-line no-eval
          return eval(bootstrap)(cfg, content, css);
        },
        pageBootstrap,
        CONFIG_JS,
        CONTENT_JS,
        CONTENT_CSS,
      );
      console.log("  inject:", JSON.stringify(injectRes));

      const snap = await waitForShell(page, 30000);
      console.log("  snap:", JSON.stringify(snap));

      const pass =
        (target.expectButtons && snap?.shell && snap.buttons > 0) ||
        (!target.expectButtons && !snap?.shell && (snap?.buttons ?? 0) === 0);

      const screenshot = path.join(
        OUT_DIR,
        `inject_v014_${target.label}.png`,
      );
      try {
        await page.screenshot({ path: screenshot, fullPage: false });
      } catch (e) {
        console.log("  screenshot err:", e.message);
      }

      if (consoleMsgs.length) {
        console.log("  console:", consoleMsgs.slice(0, 8).join(" | "));
      }

      results.push({
        ...target,
        ...snap,
        screenshot,
        pass,
      });
      console.log(" ", pass ? "PASS ✅" : "FAIL ❌");
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
    "pass",
  );
  for (const r of results) {
    console.log(
      pad(r.label, 18),
      pad(r.expectButtons ? "render" : "skip", 10),
      pad(r.shell ? "yes" : "no", 6),
      pad(r.buttons ?? 0, 5),
      pad(r.mediaType || "-", 10),
      r.pass ? "✅" : "❌",
    );
  }
  const allPass = results.every((r) => r.pass);
  console.log("\nOverall:", allPass ? "ALL PASS ✅" : "FAILURES ❌");
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(3);
});
