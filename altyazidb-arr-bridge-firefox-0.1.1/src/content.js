(() => {
  const CFG = globalThis.AdbArrConfig;
  const extensionApi = globalThis.browser || globalThis.chrome;
  const ROOT_ID = "altyazidb-arr-bridge";
  const DETAIL_SELECTOR = [
    ".movie-info-card",
    ".v2-detail-title",
    ".v2-movie-title-row",
    ".fs-action-row",
    ".fs-meta-list",
    "#film-tepesi",
    ".sub-page-only",
    "#altyazi-merkezi",
    "#altyazi-tablosu-alani"
  ].join(", ");
  const MOUNT_SELECTORS = [
    ".fs-action-row",
    ".v2-movie-title-row",
    ".movie-info-card",
    ".fs-meta-list",
    "#film-tepesi",
    "#dle-content"
  ];
  const SUBTITLE_PATH_RE = /^\/(?:film|dizi|anime-filmleri|anime-dizileri|animasyon-filmleri|animasyon-dizileri|asya-filmleri|asya-dizileri|belgesel-filmleri|belgesel-dizileri|tv-programlari)\//i;
  const NON_SUBTITLE_PATH_RE = /^\/(?:forum|user|uploads|engine|index\.php|search|page|lastnews|allnews|tags|stats|statistics|register|login|lostpassword|autobackup|admin|index)(?:\/|$)/i;

  function sendMessage(message) {
    if (globalThis.browser?.runtime?.sendMessage) {
      return globalThis.browser.runtime.sendMessage(message);
    }

    return new Promise((resolve, reject) => {
      extensionApi.runtime.sendMessage(message, (response) => {
        const error = extensionApi.runtime.lastError;

        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(response);
      });
    });
  }

  function storageGet(defaults = CFG.DEFAULT_SETTINGS) {
    if (globalThis.browser?.storage?.local) {
      return globalThis.browser.storage.local.get(defaults);
    }

    return new Promise((resolve) => {
      extensionApi.storage.local.get(defaults, resolve);
    });
  }

  function assetUrl(path) {
    return extensionApi.runtime.getURL(path);
  }

  function text(selector) {
    return CFG.normalizeSpace(document.querySelector(selector)?.textContent || "");
  }

  function meta(selector) {
    return CFG.normalizeSpace(document.querySelector(selector)?.getAttribute("content") || "");
  }

  function createPageSnapshot() {
    return {
      bodyText: CFG.normalizeSpace(document.body?.innerText || document.documentElement.innerText || ""),
      html: document.documentElement.innerHTML || "",
      hrefs: Array.from(document.querySelectorAll("a[href]"), (link) => link.href),
      jsonLd: readJsonLd()
    };
  }

  function stripSiteTitle(value) {
    return CFG.stripArrSuffix(value)
      .replace(/\s+Altyaz(?:i|\u0131)?\s*DB.*$/i, "")
      .replace(/\s+AltyaziDB.*$/i, "")
      .trim();
  }

  function readJsonLd() {
    const nodes = [];

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || "{}");
        nodes.push(parsed);
      } catch (_error) {
        // Ignore malformed JSON-LD. The DOM and URL still carry enough signal.
      }
    }

    return nodes;
  }

  function walkJson(value, visitor) {
    if (!value || typeof value !== "object") {
      return;
    }

    visitor(value);

    if (Array.isArray(value)) {
      value.forEach((item) => walkJson(item, visitor));
      return;
    }

    Object.values(value).forEach((item) => walkJson(item, visitor));
  }

  function jsonLdSignals(nodes = readJsonLd()) {
    const signals = {
      breadcrumbNames: [],
      breadcrumbUrls: [],
      schemaTypes: []
    };

    for (const node of nodes) {
      walkJson(node, (item) => {
        const type = item["@type"];

        if (typeof type === "string") {
          signals.schemaTypes.push(type);
        } else if (Array.isArray(type)) {
          signals.schemaTypes.push(...type);
        }

        if (item.itemListElement && Array.isArray(item.itemListElement)) {
          for (const element of item.itemListElement) {
            const breadcrumbItem = element.item || {};
            const name = element.name || breadcrumbItem.name;
            const url = breadcrumbItem["@id"] || breadcrumbItem.url || breadcrumbItem.id;

            if (name) {
              signals.breadcrumbNames.push(CFG.normalizeSpace(name));
            }

            if (url) {
              signals.breadcrumbUrls.push(String(url));
            }
          }
        }
      });
    }

    return signals;
  }

  function labelValue(labelRegex) {
    for (const strong of document.querySelectorAll("strong")) {
      const label = CFG.normalizeSpace(strong.textContent || "");

      if (!labelRegex.test(label)) {
        continue;
      }

      const holder = strong.closest("div") || strong.parentElement;
      const span = holder?.querySelector("span");
      const value = CFG.normalizeSpace(span?.textContent || "");

      if (value && value !== label) {
        return value;
      }

      const holderText = CFG.normalizeSpace(holder?.textContent || "");
      return CFG.normalizeSpace(holderText.replace(label, ""));
    }

    return "";
  }

  function isUsableMount(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    if (typeof getComputedStyle !== "function") {
      return true;
    }

    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function allPageText(snapshot) {
    return snapshot?.bodyText ||
      CFG.normalizeSpace(document.body?.innerText || document.documentElement.innerText || "");
  }

  function pageHtml(snapshot) {
    return snapshot?.html || document.documentElement.innerHTML || "";
  }

  function findYear(snapshot) {
    const yearLink =
      document.querySelector('a[href*="/xfsearch/year/"]') ||
      document.querySelector('a[href*="/year/"]');

    const linkYear = yearLink?.textContent?.match(/\b(19|20)\d{2}\b/);

    if (linkYear) {
      return Number(linkYear[0]);
    }

    const metaYear = [
      meta('meta[property="article:published_time"]'),
      meta('meta[name="date"]'),
      meta('meta[property="og:title"]'),
      document.title
    ].join(" ");
    const titleYear = metaYear.match(/\b(19|20)\d{2}\b/);

    if (titleYear) {
      return Number(titleYear[0]);
    }

    const bodyYear = allPageText(snapshot).match(/\b(19|20)\d{2}\b/);
    return bodyYear ? Number(bodyYear[0]) : null;
  }

  function extractIdsFromLinks(snapshot) {
    const ids = {
      imdbId: "",
      tmdbId: "",
      tmdbType: "",
      tvdbId: ""
    };

    const hrefs = snapshot?.hrefs || Array.from(document.querySelectorAll("a[href]"), (link) => link.href);
    const html = pageHtml(snapshot);

    for (const href of hrefs) {
      let url;

      try {
        url = new URL(href);
      } catch (_error) {
        continue;
      }

      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      const path = url.pathname;

      if (host === "imdb.com") {
        const imdbPathMatch = path.match(/\/title\/(tt\d{7,10})\b/i);

        if (imdbPathMatch) {
          ids.imdbId = imdbPathMatch[1].toLowerCase();
        }
      }

      if (host === "themoviedb.org") {
        const tmdbMatch = path.match(/\/(movie|tv)\/(\d+)/i);

        if (tmdbMatch) {
          ids.tmdbType = tmdbMatch[1].toLowerCase();
          ids.tmdbId = Number(tmdbMatch[2]);
        }
      }

      if (host === "thetvdb.com") {
        const pathMatch = path.match(/\/(?:dereferrer\/)?(?:series|movies)\/(\d+)/i);
        const queryId =
          url.searchParams.get("id") ||
          url.searchParams.get("seriesid") ||
          url.searchParams.get("tvdbid");

        if (pathMatch) {
          ids.tvdbId = Number(pathMatch[1]);
        } else if (queryId && /^\d+$/.test(queryId)) {
          ids.tvdbId = Number(queryId);
        }
      }
    }

    if (!ids.imdbId) {
      const imdbHtmlMatch = html.match(/imdb\.com\/title\/(tt\d{7,10})\b/i);

      if (imdbHtmlMatch) {
        ids.imdbId = imdbHtmlMatch[1].toLowerCase();
      }
    }

    const tvdbTextMatch = html.match(/\b(?:tvdb|thetvdb)[^\d]{0,30}(\d{3,})\b/i);

    if (!ids.tvdbId && tvdbTextMatch) {
      ids.tvdbId = Number(tvdbTextMatch[1]);
    }

    return ids;
  }

  function detectSeasonEpisode(snapshot) {
    const body = allPageText(snapshot);
    const compact = body.match(/\bS(?:eason)?\s*0?(\d{1,2})\s*(?:E|Ep|Episode|B[o\u00f6]l[u\u00fc]m|x)\s*0?(\d{1,3})\b/i);
    const xFormat = body.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,3})\b/);
    const seasonText =
      body.match(/\b(?:Season|Sezon)\s*0?(\d{1,2})\b/i) ||
      body.match(/\b0?(\d{1,2})\.\s*(?:Season|Sezon)\b/i);
    const episodeText =
      body.match(/\b(?:Episode|B[o\u00f6]l[u\u00fc]m)\s*0?(\d{1,3})\b/i) ||
      body.match(/\b0?(\d{1,3})\.\s*(?:Episode|B[o\u00f6]l[u\u00fc]m)\b/i);

    if (compact) {
      return {
        seasonNumber: Number(compact[1]),
        episodeNumber: Number(compact[2])
      };
    }

    if (xFormat) {
      return {
        seasonNumber: Number(xFormat[1]),
        episodeNumber: Number(xFormat[2])
      };
    }

    return {
      seasonNumber: seasonText ? Number(seasonText[1]) : null,
      episodeNumber: episodeText ? Number(episodeText[1]) : null
    };
  }

  function detectType(signals, ids, seasonEpisode) {
    const path = window.location.pathname.toLowerCase();
    const breadcrumbs = [...signals.breadcrumbNames, ...signals.breadcrumbUrls]
      .join(" ")
      .toLowerCase();
    const schemaTypes = signals.schemaTypes.join(" ").toLowerCase();

    if (/\/(?:film|anime-filmleri|animasyon-filmleri|asya-filmleri|belgesel-filmleri)\//.test(path)) {
      return "movie";
    }

    if (/\/anime-dizileri\//.test(path) || /\banime diz/i.test(breadcrumbs)) {
      return "anime";
    }

    if (/\/(?:dizi|animasyon-dizileri|asya-dizileri|belgesel-dizileri|tv-programlari)\//.test(path)) {
      if (seasonEpisode.episodeNumber) {
        return "episode";
      }

      if (seasonEpisode.seasonNumber) {
        return "season";
      }

      return "series";
    }

    if (/\bfilm\b|movie/.test(breadcrumbs) || /\bmovie\b/.test(schemaTypes) || ids.tmdbType === "movie") {
      return "movie";
    }

    if (/\bdizi\b|\bseries\b|\btv\b/.test(breadcrumbs) || /tvseries/.test(schemaTypes) || ids.tmdbType === "tv") {
      if (seasonEpisode.episodeNumber) {
        return "episode";
      }

      if (seasonEpisode.seasonNumber) {
        return "season";
      }

      return "series";
    }

    if (seasonEpisode.episodeNumber) {
      return "episode";
    }

    if (seasonEpisode.seasonNumber) {
      return "season";
    }

    return "unknown";
  }

  function extractReleaseTitles(year) {
    const selectors = [
      ".v4-surum-dosya",
      "[class*='surum-dosya']",
      "[class*='release']",
      "[class*='filename']"
    ];
    const values = [];

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const candidate = CFG.cleanReleaseSearchTitle(node.textContent || "", year);

        if (candidate) {
          values.push(candidate);
        }
      }
    }

    return CFG.uniqueSearchTitles(values).slice(0, 5);
  }

  function extractAlternativeTitles(title, originalTitle, releaseTitles) {
    const explicit = labelValue(/alternatif|alternative|di\u011fer ad/i);
    const values = [title, originalTitle, ...(releaseTitles || [])];

    if (explicit) {
      values.push(...explicit.split(/[,/|;]/).map(CFG.normalizeSpace));
    }

    return CFG.uniqueSearchTitles(values);
  }

  function extractMedia() {
    const snapshot = createPageSnapshot();
    const signals = jsonLdSignals(snapshot.jsonLd);
    const ids = extractIdsFromLinks(snapshot);
    const seasonEpisode = detectSeasonEpisode(snapshot);
    const rawTitle =
      text(".v2-detail-title") ||
      text("h1") ||
      meta('meta[property="og:title"]') ||
      meta('meta[property="twitter:title"]') ||
      document.title;
    const title = stripSiteTitle(rawTitle);
    const originalTitle =
      labelValue(/orijinal ba\u015fl\u0131k|original title|original name/i) || title;
    const year = findYear(snapshot);
    const mediaType = detectType(signals, ids, seasonEpisode);
    const releaseTitles = extractReleaseTitles(year);

    return {
      title,
      originalTitle,
      searchTitle: releaseTitles[0] || title,
      year,
      mediaType,
      seasonNumber: seasonEpisode.seasonNumber,
      episodeNumber: seasonEpisode.episodeNumber,
      imdbId: ids.imdbId,
      tmdbId: ids.tmdbId,
      tmdbType: ids.tmdbType,
      tvdbId: ids.tvdbId,
      releaseTitles,
      alternativeTitles: extractAlternativeTitles(title, originalTitle, releaseTitles),
      sourceUrl: window.location.href
    };
  }

  function serviceForMedia(media, settings) {
    const appendOptional = (services) => {
      const extras = [];

      if (settings?.showProwlarrButton !== false) {
        extras.push("prowlarr");
      }

      if (settings?.showJackettButton !== false) {
        extras.push("jackett");
      }

      return [...services, ...extras];
    };

    if (media.mediaType === "movie") {
      return appendOptional(["radarr"]);
    }

    if (["series", "anime", "season", "episode"].includes(media.mediaType)) {
      return appendOptional(["sonarr"]);
    }

    return appendOptional(["radarr", "sonarr"]);
  }

  function isLikelyDetailPage(_media) {
    const path = window.location.pathname || "/";

    // Hard block known non-subtitle sections (forum, user profiles, search, etc.)
    if (NON_SUBTITLE_PATH_RE.test(path)) {
      return false;
    }

    // Only render on AltyaziDB subtitle detail pages.
    return SUBTITLE_PATH_RE.test(path);
  }

  function mountPoint() {
    for (const selector of MOUNT_SELECTORS) {
      const element = document.querySelector(selector);

      if (isUsableMount(element)) {
        return element;
      }
    }

    const headingHolder = document.querySelector("h1")?.parentElement;

    if (isUsableMount(headingHolder)) {
      return headingHolder;
    }

    return document.body || document.documentElement;
  }

  function buttonLabel(service) {
    if (service === "radarr") {
      return "Radarr";
    }

    if (service === "prowlarr") {
      return "Prowlarr";
    }

    if (service === "jackett") {
      return "Jackett";
    }

    return "Sonarr";
  }

  function iconAssetPath(service) {
    if (service === "radarr") {
      return "assets/radarr-reference.png";
    }

    if (service === "prowlarr") {
      return "assets/prowlarr-reference.png";
    }

    if (service === "jackett") {
      return "assets/jackett-reference.png";
    }

    return "assets/sonarr-reference.png";
  }

  function createButton(service, media) {
    const button = document.createElement("button");
    const icon = document.createElement("img");
    const label = document.createElement("span");
    const plan = CFG.buildSearchPlan(service, media);

    button.type = "button";
    button.className = `adb-arr-button adb-arr-button-${service}`;
    button.title = `Search ${buttonLabel(service)} for ${plan.term || plan.fallbackTerm}`;
    button.dataset.service = service;

    icon.className = "adb-arr-icon";
    icon.src = assetUrl(iconAssetPath(service));
    icon.alt = "";

    label.textContent = buttonLabel(service);

    button.append(icon, label);
    return button;
  }

  function setStatus(shell, message, tone = "neutral", fallbackUrl = "") {
    const status = shell.querySelector(".adb-arr-status");
    status.textContent = message || "";
    status.className = `adb-arr-status adb-arr-status-${tone}`;
    status.innerHTML = "";

    if (message) {
      const textNode = document.createElement("span");
      textNode.textContent = message;
      status.append(textNode);
    }

    if (fallbackUrl) {
      const fallback = document.createElement("button");
      fallback.type = "button";
      fallback.className = "adb-arr-link-button";
      fallback.textContent = "Open search";
      fallback.addEventListener("click", () => {
        sendMessage({ type: "ADB_OPEN_URL", url: fallbackUrl }).catch(() => {});
      });
      status.append(fallback);
    }
  }

  function clearPopup(shell) {
    shell.querySelector(".adb-arr-popup")?.remove();
  }

  function formatSize(bytes) {
    const value = Number(bytes || 0);

    if (!value) {
      return "";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unit = 0;

    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }

    return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
  }

  function resultMeta(service, result) {
    if (service === "prowlarr" || service === "jackett") {
      return [
        result.indexer || "",
        formatSize(result.size),
        result.seeders !== "" ? `${result.seeders} seeders` : "",
        result.protocol || ""
      ]
        .filter(Boolean)
        .join(" | ");
    }

    return [
      result.year ? String(result.year) : "",
      result.imdbId ? `IMDb ${result.imdbId}` : "",
      result.tmdbId ? `TMDb ${result.tmdbId}` : "",
      result.tvdbId ? `TVDb ${result.tvdbId}` : ""
    ]
      .filter(Boolean)
      .join(" | ");
  }

  function renderResults(shell, service, media, response) {
    clearPopup(shell);

    const popup = document.createElement("div");
    const title = document.createElement("div");
    const close = document.createElement("button");
    const list = document.createElement("div");

    popup.className = "adb-arr-popup";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", `${buttonLabel(service)} results`);

    title.className = "adb-arr-popup-title";
    title.textContent = `${buttonLabel(service)} results`;

    close.type = "button";
    close.className = "adb-arr-popup-close";
    close.textContent = "x";
    close.setAttribute("aria-label", "Close results");
    close.addEventListener("click", () => clearPopup(shell));

    list.className = "adb-arr-result-list";

    for (const result of response.results || []) {
      const row = document.createElement("div");
      const main = document.createElement("div");
      const name = document.createElement("div");
      const metaLine = document.createElement("div");
      const action = document.createElement("button");

      row.className = "adb-arr-result";
      main.className = "adb-arr-result-main";
      name.className = "adb-arr-result-title";
      metaLine.className = "adb-arr-result-meta";
      action.type = "button";
      action.className = "adb-arr-result-action";

      name.textContent = result.title || result.originalTitle || "Untitled result";
      metaLine.textContent = resultMeta(service, result);
      action.textContent = `Open in ${buttonLabel(service)}`;
      action.addEventListener("click", async () => {
        action.disabled = true;
        setStatus(shell, `Opening ${buttonLabel(service)}...`);

        try {
          const openResponse = await sendMessage({
            type: "ADB_OPEN_RESULT",
            service,
            media,
            result
          });

          setStatus(
            shell,
            openResponse?.ok
              ? `Opened ${buttonLabel(service)}.`
              : openResponse?.error || "Could not open result",
            openResponse?.ok ? "success" : "error"
          );
        } catch (error) {
          setStatus(shell, error.message || "Could not open result", "error");
        } finally {
          action.disabled = false;
        }
      });

      main.append(name, metaLine);

      if (result.overview) {
        const overview = document.createElement("div");
        overview.className = "adb-arr-result-overview";
        overview.textContent = result.overview;
        main.append(overview);
      }

      row.append(main, action);
      list.append(row);
    }

    if (!list.children.length) {
      const empty = document.createElement("div");
      empty.className = "adb-arr-result-empty";
      empty.textContent = "No result found";
      list.append(empty);
    }

    popup.append(title, close, list);
    shell.append(popup);
  }

  async function handleButtonClick(event, shell, media) {
    const button = event.currentTarget;
    const service = button.dataset.service;

    clearPopup(shell);
    button.disabled = true;
    setStatus(shell, `Searching ${buttonLabel(service)}...`);

    try {
      const response = await sendMessage({
        type: "ADB_LOOKUP",
        service,
        media
      });

      if (response?.mode === "showPopupResults") {
        renderResults(shell, service, media, response);
        setStatus(shell, `${response.results?.length || 0} result(s) found.`, "success");
        return;
      }

      if (response?.ok) {
        setStatus(shell, response.message || `Opened ${buttonLabel(service)}.`, "success");
        return;
      }

      setStatus(
        shell,
        response?.error || "No result found",
        response?.opened ? "warn" : "error",
        response?.opened ? "" : response?.fallbackUrl || ""
      );
    } catch (error) {
      setStatus(shell, error.message || "Unexpected extension error", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function render() {
    if (!extensionApi?.runtime || document.getElementById(ROOT_ID)) {
      return true;
    }

    const media = extractMedia();
    const settings = CFG.mergeSettings(await storageGet(CFG.DEFAULT_SETTINGS));

    if (!isLikelyDetailPage(media)) {
      return false;
    }

    const services = serviceForMedia(media, settings);
    const shell = document.createElement("div");
    const buttonRow = document.createElement("div");
    const status = document.createElement("div");

    shell.id = ROOT_ID;
    shell.className = "adb-arr-shell";
    shell.dataset.mediaType = media.mediaType;
    buttonRow.className = "adb-arr-button-row";
    status.className = "adb-arr-status adb-arr-status-neutral";

    for (const service of services) {
      const button = createButton(service, media);
      button.addEventListener("click", (event) => handleButtonClick(event, shell, media));
      buttonRow.append(button);
    }

    shell.append(buttonRow, status);

    if (media.mediaType === "unknown") {
      setStatus(shell, "Could not detect media type", "warn");
    }

    const mount = mountPoint();

    if (mount.classList.contains("v2-movie-title-row")) {
      mount.append(shell);
    } else if (mount.tagName === "H1") {
      mount.insertAdjacentElement("afterend", shell);
    } else {
      mount.append(shell);
    }

    return true;
  }

  function boot() {
    let attempts = 0;
    let timer = 0;
    let observer = null;

    const stop = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    };

    const tryRender = () => {
      attempts += 1;

      render()
        .then((done) => {
          if (done) {
            stop();
            return;
          }

          if (attempts >= 20) {
            stop();
            return;
          }

          timer = setTimeout(tryRender, attempts < 6 ? 500 : 1500);
        })
        .catch(() => {
          if (attempts < 20) {
            timer = setTimeout(tryRender, 1500);
          }
        });
    };

    if (typeof MutationObserver === "function" && document.documentElement) {
      observer = new MutationObserver(() => {
        if (!document.getElementById(ROOT_ID)) {
          attempts = 0;
          clearTimeout(timer);
          timer = setTimeout(tryRender, 150);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    tryRender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
