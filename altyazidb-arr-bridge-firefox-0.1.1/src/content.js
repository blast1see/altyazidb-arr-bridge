(() => {
  const CFG = globalThis.AdbArrConfig;
  const extensionApi = globalThis.browser || globalThis.chrome;
  const ROOT_ID = "altyazidb-arr-bridge";
  const DETAIL_SELECTOR = [
    ".v2-detail-title",
    ".v2-movie-title-row",
    ".fs-action-row",
    "#film-tepesi",
    ".sub-page-only",
    "#altyazi-merkezi",
    "#altyazi-tablosu-alani"
  ].join(", ");
  const MEDIA_INFO_SELECTORS = [
    ".movie-info-card",
    "#film-tepesi",
    ".v2-movie-title-row",
    ".fs-meta-list"
  ];
  const MOUNT_SELECTORS = [
    ".fs-action-row",
    ".v2-movie-title-row",
    ".movie-info-card",
    ".fs-meta-list",
    "#film-tepesi",
    "#dle-content"
  ];
  const NOISE_SELECTOR = [
    "#altyazi-merkezi",
    "#altyazi-tablosu-alani",
    ".comments",
    ".comment",
    "[class*='comment']"
  ].join(", ");

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

  function mediaInfoRoots() {
    return MEDIA_INFO_SELECTORS
      .map((selector) => document.querySelector(selector))
      .filter((node, index, nodes) => node && nodes.indexOf(node) === index);
  }

  function createPageSnapshot() {
    const roots = mediaInfoRoots();
    const hrefs = [];
    const detailYears = [];

    for (const root of roots) {
      for (const link of root.querySelectorAll("a[href]")) {
        hrefs.push(link.href);
      }

      for (const link of root.querySelectorAll('a[href*="/xfsearch/year/"], a[href*="/year/"]')) {
        detailYears.push(link.textContent || "");
      }
    }

    for (const link of document.querySelectorAll([
      'a[href*="imdb.com/title/"]',
      'a[href*="themoviedb.org/movie/"]',
      'a[href*="themoviedb.org/tv/"]',
      'a[href*="thetvdb.com/"]'
    ].join(", "))) {
      if (!link.closest(NOISE_SELECTOR)) {
        hrefs.push(link.href);
      }
    }

    return {
      hrefs: [...new Set(hrefs)],
      detailYears,
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
      schemaTypes: [],
      mediaNames: [],
      mediaYears: [],
      externalUrls: []
    };

    for (const node of nodes) {
      walkJson(node, (item) => {
        const type = item["@type"];

        if (typeof type === "string") {
          signals.schemaTypes.push(type);
        } else if (Array.isArray(type)) {
          signals.schemaTypes.push(...type);
        }

        const types = (Array.isArray(type) ? type : [type])
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        const isMedia = types.some((value) =>
          ["movie", "tvseries", "tvepisode", "tvseason"].includes(value)
        );

        if (isMedia) {
          if (item.name) {
            signals.mediaNames.push(CFG.normalizeSpace(item.name));
          }

          if (item.datePublished) {
            signals.mediaYears.push(String(item.datePublished));
          }

          const external = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
          signals.externalUrls.push(...external.filter(Boolean).map(String));
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

  function labelValue(labelRegex, roots = mediaInfoRoots()) {
    for (const strong of roots.flatMap((root) => Array.from(root.querySelectorAll("strong")))) {
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

  function findYear(snapshot, signals) {
    return CFG.yearFromSignals({
      detailYears: [
        ...(snapshot?.detailYears || []),
        labelValue(/^(?:y\u0131l|yap\u0131m y\u0131l\u0131|year)$/i)
      ],
      jsonLdYears: signals?.mediaYears || [],
      titleValues: [
      meta('meta[property="og:title"]'),
        meta('meta[property="twitter:title"]'),
      document.title
      ]
    });
  }

  function extractIdsFromLinks(snapshot, signals) {
    return CFG.extractExternalIds([
      ...(snapshot?.hrefs || []),
      ...(signals?.externalUrls || [])
    ]);
  }

  function detectSeasonEpisode(rawTitle) {
    return CFG.detectSeasonEpisode(window.location.pathname, rawTitle);
  }

  function detectType(signals, ids, seasonEpisode) {
    const breadcrumbs = [...signals.breadcrumbNames, ...signals.breadcrumbUrls]
      .join(" ");

    return CFG.detectMediaType({
      pathname: window.location.pathname,
      breadcrumbs,
      schemaTypes: signals.schemaTypes.join(" "),
      tmdbType: ids.tmdbType,
      seasonNumber: seasonEpisode.seasonNumber,
      episodeNumber: seasonEpisode.episodeNumber
    });
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
    const ids = extractIdsFromLinks(snapshot, signals);
    const rawTitle =
      text(".v2-detail-title") ||
      text(".movie-info-card h1") ||
      signals.mediaNames[0] ||
      meta('meta[property="og:title"]') ||
      meta('meta[property="twitter:title"]') ||
      document.title;
    const seasonEpisode = detectSeasonEpisode(rawTitle);
    const title = stripSiteTitle(rawTitle);
    const originalTitle =
      labelValue(/orijinal ba\u015fl\u0131k|original title|original name/i) || title;
    const year = findYear(snapshot, signals);
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

  function isLikelyDetailPage() {
    return CFG.isLikelyDetailPage(
      window.location.pathname,
      Boolean(document.querySelector(DETAIL_SELECTOR))
    );
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

  function setStatus(shell, message, tone = "neutral", fallbackUrl = "", fallbackService = "") {
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
        sendMessage({
          type: "ADB_OPEN_URL",
          service: fallbackService,
          url: fallbackUrl
        }).catch(() => {});
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
            result,
            searchTerm: response.searchTerm || ""
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
        response?.opened ? "" : response?.fallbackUrl || "",
        service
      );
    } catch (error) {
      setStatus(shell, error.message || "Unexpected extension error", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function render() {
    if (!extensionApi?.runtime) {
      return true;
    }

    const currentUrl = window.location.href;
    const existingShell = document.getElementById(ROOT_ID);

    if (existingShell?.dataset.sourceUrl === currentUrl) {
      return true;
    }

    existingShell?.remove();

    if (!isLikelyDetailPage()) {
      return false;
    }

    const media = extractMedia();
    const settings = CFG.mergeSettings(await storageGet(CFG.DEFAULT_SETTINGS));

    const services = serviceForMedia(media, settings);
    const shell = document.createElement("div");
    const buttonRow = document.createElement("div");
    const status = document.createElement("div");

    shell.id = ROOT_ID;
    shell.className = "adb-arr-shell";
    shell.dataset.mediaType = media.mediaType;
    shell.dataset.sourceUrl = currentUrl;
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

    const scheduleRender = (delay = 150) => {
      clearTimeout(timer);
      timer = setTimeout(tryRender, delay);
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
        const shell = document.getElementById(ROOT_ID);

        if (shell?.dataset.sourceUrl !== window.location.href) {
          shell?.remove();
        }

        if (CFG.isBlockedPagePath(window.location.pathname)) {
          attempts = 0;
          stop();
          return;
        }

        if (!document.getElementById(ROOT_ID)) {
          attempts = 0;
          scheduleRender();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    for (const eventName of ["pageshow", "popstate", "hashchange"]) {
      window.addEventListener(eventName, () => {
        document.getElementById(ROOT_ID)?.remove();
        attempts = 0;
        if (!CFG.isBlockedPagePath(window.location.pathname)) {
          scheduleRender(0);
        }
      });
    }

    tryRender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
