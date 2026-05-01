// ==UserScript==
// @name         AltyaziDB Arr Bridge
// @namespace    https://altyazidb.com/
// @version      0.1.2-tm
// @description  Adds Radarr, Sonarr, optional Prowlarr, and optional Jackett buttons to AltyaziDB subtitle pages.
// @match        http://altyazidb.com/*
// @match        http://*.altyazidb.com/*
// @match        https://altyazidb.com/*
// @match        https://*.altyazidb.com/*
// @exclude      *://altyazidb.com/forum/*
// @exclude      *://*.altyazidb.com/forum/*
// @exclude      *://altyazidb.com/user/*
// @exclude      *://*.altyazidb.com/user/*
// @exclude      *://altyazidb.com/search/*
// @exclude      *://*.altyazidb.com/search/*
// @exclude      *://altyazidb.com/admin/*
// @exclude      *://*.altyazidb.com/admin/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(() => {
  "use strict";

  const ROOT_ID = "altyazidb-arr-bridge-tm";
  const SETTINGS_KEY = "adbArrBridgeSettings";
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

  const DEFAULT_SETTINGS = {
    radarrBaseUrl: "http://localhost:7878",
    radarrApiKey: "",
    sonarrBaseUrl: "http://localhost:8989",
    sonarrApiKey: "",
    prowlarrBaseUrl: "http://localhost:9696",
    prowlarrApiKey: "",
    showProwlarrButton: true,
    prowlarrLimit: 25,
    jackettBaseUrl: "http://localhost:9117",
    jackettApiKey: "",
    showJackettButton: true,
    jackettLimit: 25,
    jackettIndexer: "all",
    behavior: "openSearchPage",
    radarrRootFolderPath: "",
    radarrQualityProfileId: "",
    radarrMinimumAvailability: "released",
    sonarrRootFolderPath: "",
    sonarrQualityProfileId: "",
    sonarrSeriesType: "standard",
    sonarrSeasonFolder: true
  };

  const SERVICE_LABELS = {
    radarr: "Radarr",
    sonarr: "Sonarr",
    prowlarr: "Prowlarr",
    jackett: "Jackett"
  };

  const ICONS = {
    radarr: pngData(`
      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
      z/+IfwCcHGpvUe+ipQAAAABJRU5ErkJggg==
    `),
    sonarr: pngData(`
      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
    `),
    prowlarr: pngData(`
      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
    `),
    jackett: pngData(
      "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"
    )
  };

  class ArrBridgeError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "ArrBridgeError";
      this.code = code;
    }
  }

  function pngData(base64) {
    return `data:image/png;base64,${base64.replace(/\s+/g, "")}`;
  }

  function gmValue(value) {
    return value && typeof value.then === "function" ? value : Promise.resolve(value);
  }

  async function gmGet(key, fallback) {
    return gmValue(GM_getValue(key, fallback));
  }

  async function gmSet(key, value) {
    return gmValue(GM_setValue(key, value));
  }

  function normalizeSpace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripArrSuffix(title) {
    return String(title || "")
      .replace(/\s+(?:\u00bb|\||-)\s+AltyaziDb.*$/i, "")
      .replace(/\s+\|\s+AltyaziDb.*$/i, "")
      .trim();
  }

  function normalizeBaseUrl(value, fallback) {
    const raw = normalizeSpace(value || fallback || "").replace(/\/+$/, "");

    if (!raw) {
      return "";
    }

    try {
      const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      const parsed = new URL(withProtocol);
      parsed.hash = "";
      parsed.search = "";
      return parsed.toString().replace(/\/+$/, "");
    } catch (_error) {
      return normalizeSpace(fallback || "");
    }
  }

  function clampInt(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
  }

  function mergeSettings(settings) {
    const merged = {
      ...DEFAULT_SETTINGS,
      ...(settings || {})
    };

    merged.radarrBaseUrl = normalizeBaseUrl(merged.radarrBaseUrl, DEFAULT_SETTINGS.radarrBaseUrl);
    merged.sonarrBaseUrl = normalizeBaseUrl(merged.sonarrBaseUrl, DEFAULT_SETTINGS.sonarrBaseUrl);
    merged.prowlarrBaseUrl = normalizeBaseUrl(merged.prowlarrBaseUrl, DEFAULT_SETTINGS.prowlarrBaseUrl);
    merged.jackettBaseUrl = normalizeBaseUrl(merged.jackettBaseUrl, DEFAULT_SETTINGS.jackettBaseUrl);
    merged.behavior = ["openSearchPage", "showPopupResults", "autoAdd"].includes(merged.behavior)
      ? merged.behavior
      : DEFAULT_SETTINGS.behavior;
    merged.showProwlarrButton = merged.showProwlarrButton !== false;
    merged.showJackettButton = merged.showJackettButton !== false;
    merged.sonarrSeasonFolder = merged.sonarrSeasonFolder !== false;
    merged.prowlarrLimit = clampInt(
      merged.prowlarrLimit,
      1,
      100,
      DEFAULT_SETTINGS.prowlarrLimit
    );
    merged.jackettLimit = clampInt(
      merged.jackettLimit,
      1,
      100,
      DEFAULT_SETTINGS.jackettLimit
    );
    merged.jackettIndexer = normalizeSpace(merged.jackettIndexer || "") || DEFAULT_SETTINGS.jackettIndexer;

    return merged;
  }

  async function getSettings() {
    return mergeSettings(await gmGet(SETTINGS_KEY, DEFAULT_SETTINGS));
  }

  async function saveSettings(settings) {
    await gmSet(SETTINGS_KEY, mergeSettings(settings));
  }

  function serviceLabel(service) {
    return SERVICE_LABELS[service] || "Arr";
  }

  function serviceBaseUrl(settings, service) {
    if (service === "radarr") {
      return settings.radarrBaseUrl;
    }

    if (service === "prowlarr") {
      return settings.prowlarrBaseUrl;
    }

    if (service === "jackett") {
      return settings.jackettBaseUrl;
    }

    return settings.sonarrBaseUrl;
  }

  function serviceApiKey(settings, service) {
    if (service === "radarr") {
      return settings.radarrApiKey;
    }

    if (service === "prowlarr") {
      return settings.prowlarrApiKey;
    }

    if (service === "jackett") {
      return settings.jackettApiKey;
    }

    return settings.sonarrApiKey;
  }

  function isLocalhostUrl(baseUrl) {
    try {
      const host = new URL(normalizeBaseUrl(baseUrl, baseUrl)).hostname;
      return ["localhost", "127.0.0.1", "::1"].includes(host);
    } catch (_error) {
      return false;
    }
  }

  function connectionErrorMessage(service, baseUrl) {
    const label = serviceLabel(service);
    return isLocalhostUrl(baseUrl)
      ? `Could not connect to localhost ${label}`
      : `Could not connect to ${label}`;
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function comparableTitle(value) {
    return normalizeSpace(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ");
  }

  function cleanReleaseSearchTitle(value, year) {
    const raw = normalizeSpace(value);

    if (!raw) {
      return "";
    }

    const yearPattern = year ? escapeRegExp(year) : "(?:19|20)\\d{2}";
    const patterns = [
      new RegExp(`^(.{2,120}?)[._\\s-]+${yearPattern}\\b`, "i"),
      /^(.{2,120}?)[._\s-]+S\d{1,2}E\d{1,3}\b/i,
      /^(.{2,120}?)[._\s-]+S\d{1,2}\b/i
    ];
    const match = patterns.map((pattern) => raw.match(pattern)).find(Boolean);

    if (!match) {
      return "";
    }

    const title = normalizeSpace(
      match[1]
        .replace(/\[[^\]]*]/g, " ")
        .replace(/\([^)]*\)/g, " ")
        .replace(/[._-]+/g, " ")
        .replace(/\b(?:www|com|net|org)\b/gi, " ")
    );

    if (!/[A-Za-z]/.test(title)) {
      return "";
    }

    if (/^(?:web|webrip|webdl|web-dl|bluray|bdrip|brrip|hdtv|hdrip|dvd|x264|x265|h264|h265)$/i.test(title)) {
      return "";
    }

    return title.slice(0, 80).trim();
  }

  function uniqueSearchTitles(values) {
    const seen = new Set();
    const titles = [];

    for (const value of values || []) {
      const title = normalizeSpace(value);

      if (!title) {
        continue;
      }

      const key = comparableTitle(title) || title.toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      titles.push(title);
    }

    return titles;
  }

  function getDisplayTitle(media) {
    return normalizeSpace(media?.title) || normalizeSpace(media?.originalTitle) || stripArrSuffix(document.title);
  }

  function searchTitleCandidates(media) {
    const releaseTitles = Array.isArray(media?.releaseTitles) ? media.releaseTitles : [];
    const alternativeTitles = Array.isArray(media?.alternativeTitles) ? media.alternativeTitles : [];

    return uniqueSearchTitles([
      normalizeSpace(media?.searchTitle),
      ...releaseTitles,
      normalizeSpace(media?.title),
      ...alternativeTitles,
      normalizeSpace(media?.originalTitle),
      stripArrSuffix(document.title)
    ]);
  }

  function getSearchTitle(media) {
    return searchTitleCandidates(media)[0] || "";
  }

  function titleYearTerm(media) {
    return normalizeSpace(`${getDisplayTitle(media)} ${media?.year ? String(media.year) : ""}`);
  }

  function padNumber(value, width = 2) {
    return String(value || "").padStart(width, "0");
  }

  function prowlarrTermForTitle(media, title) {
    const normalizedTitle = normalizeSpace(title);

    if (!normalizedTitle) {
      return "";
    }

    if (media?.seasonNumber && media?.episodeNumber) {
      return normalizeSpace(`${normalizedTitle} S${padNumber(media.seasonNumber)}E${padNumber(media.episodeNumber)}`);
    }

    if (media?.seasonNumber) {
      return normalizeSpace(`${normalizedTitle} S${padNumber(media.seasonNumber)}`);
    }

    return normalizeSpace(`${normalizedTitle} ${media?.year ? String(media.year) : ""}`);
  }

  function prowlarrTerms(media) {
    return uniqueSearchTitles([
      ...searchTitleCandidates(media).map((title) => prowlarrTermForTitle(media, title)),
      titleYearTerm(media)
    ]);
  }

  function prowlarrTerm(media) {
    return prowlarrTerms(media)[0] || titleYearTerm(media);
  }

  function jackettImdbQuery(media) {
    const raw = String(media?.imdbId || "").trim().toLowerCase();
    return /^tt\d{7,10}$/.test(raw) ? raw : "";
  }

  function jackettTerms(media) {
    const imdbQuery = jackettImdbQuery(media);
    const textTerms = prowlarrTerms(media);
    return uniqueSearchTitles(imdbQuery ? [imdbQuery, ...textTerms] : textTerms);
  }

  function jackettTerm(media) {
    return jackettTerms(media)[0] || titleYearTerm(media);
  }

  function buildSearchPlan(service, media) {
    const normalizedService = ["sonarr", "prowlarr", "jackett"].includes(service) ? service : "radarr";
    const term = titleYearTerm(media);

    if (normalizedService === "prowlarr") {
      const query = prowlarrTerm(media);
      return {
        kind: "query",
        term: query,
        apiPath: "/api/v1/search",
        apiParams: {
          query,
          type: "search",
          limit: DEFAULT_SETTINGS.prowlarrLimit,
          offset: 0
        },
        fallbackTerm: query
      };
    }

    if (normalizedService === "jackett") {
      const imdbQuery = jackettImdbQuery(media);
      const query = imdbQuery || jackettTerm(media);
      return {
        kind: imdbQuery ? "imdb" : "query",
        term: query,
        apiPath: "/api/v2.0/indexers/all/results",
        apiParams: { Query: query },
        fallbackTerm: query
      };
    }

    if (normalizedService === "radarr") {
      if (media?.tmdbId && media?.tmdbType !== "tv") {
        return {
          kind: "tmdb",
          term: `tmdb:${media.tmdbId}`,
          apiPath: "/api/v3/movie/lookup/tmdb",
          apiParams: { tmdbId: media.tmdbId },
          fallbackTerm: `tmdb:${media.tmdbId}`
        };
      }

      if (media?.imdbId) {
        return {
          kind: "imdb",
          term: `imdb:${media.imdbId}`,
          apiPath: "/api/v3/movie/lookup/imdb",
          apiParams: { imdbId: media.imdbId },
          fallbackTerm: `imdb:${media.imdbId}`
        };
      }

      return {
        kind: "term",
        term,
        apiPath: "/api/v3/movie/lookup",
        apiParams: { term },
        fallbackTerm: term
      };
    }

    if (media?.tvdbId) {
      return {
        kind: "tvdb",
        term: `tvdb:${media.tvdbId}`,
        apiPath: "/api/v3/series/lookup",
        apiParams: { term: `tvdb:${media.tvdbId}` },
        fallbackTerm: `tvdb:${media.tvdbId}`
      };
    }

    if (media?.tmdbId && media?.tmdbType !== "movie") {
      return {
        kind: "tmdb",
        term: `tmdb:${media.tmdbId}`,
        apiPath: "/api/v3/series/lookup",
        apiParams: { term: `tmdb:${media.tmdbId}` },
        fallbackTerm: `tmdb:${media.tmdbId}`
      };
    }

    return {
      kind: "term",
      term,
      apiPath: "/api/v3/series/lookup",
      apiParams: { term },
      fallbackTerm: term
    };
  }

  function buildUrl(baseUrl, path, params = {}) {
    const parsed = new URL(normalizeBaseUrl(baseUrl, baseUrl));
    const basePath = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = `${basePath}${path.startsWith("/") ? path : `/${path}`}`;

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        parsed.searchParams.set(key, String(value));
      }
    }

    return parsed.toString();
  }

  function buildAddPageUrl(baseUrl, term) {
    return buildUrl(baseUrl, "/add/new", { term });
  }

  function buildProwlarrSearchPageUrl(baseUrl, query, limit = DEFAULT_SETTINGS.prowlarrLimit) {
    return buildUrl(baseUrl, "/search", {
      query,
      type: "search",
      limit,
      offset: 0
    });
  }

  function buildJackettSearchPageUrl(baseUrl, query) {
    const normalized = normalizeBaseUrl(baseUrl, baseUrl);
    if (!normalized) {
      return "";
    }
    return `${normalized}/UI/Dashboard#search=${encodeURIComponent(normalizeSpace(query))}`;
  }

  function buildDetailPageUrl(baseUrl, service, result) {
    if (!result?.titleSlug) {
      return null;
    }

    return buildUrl(baseUrl, service === "radarr" ? "/movie/" : "/series/") +
      encodeURIComponent(result.titleSlug);
  }

  function statusPath(service) {
    if (service === "prowlarr") {
      return { path: "/api/v1/system/status", params: {} };
    }
    if (service === "jackett") {
      // `/api/v2.0/server/config` requires cookie-based admin auth and 302-redirects
      // when authenticated with ?apikey=, so the status ping would hit the login page.
      // `/api/v2.0/indexers/all/results` honours ?apikey= (200 on valid, 401 on invalid).
      // A nonsense Query keeps the response small and avoids triggering real indexer searches.
      return {
        path: "/api/v2.0/indexers/all/results",
        params: { Query: "__adb_ping__" }
      };
    }
    return { path: "/api/v3/system/status", params: {} };
  }

  function fallbackUrlForService(service, settings, searchPlan) {
    const baseUrl = serviceBaseUrl(settings, service);
    const term = searchPlan.fallbackTerm || searchPlan.term;

    if (service === "prowlarr") {
      return buildProwlarrSearchPageUrl(baseUrl, term, settings.prowlarrLimit);
    }

    if (service === "jackett") {
      return buildJackettSearchPageUrl(baseUrl, term);
    }

    return buildAddPageUrl(baseUrl, term);
  }

  function openUrl(url) {
    if (typeof GM_openInTab === "function") {
      GM_openInTab(url, { active: true, insert: true });
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function gmRequest({ method = "GET", url, headers = {}, body = null, timeout = 10000 }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data: body ? JSON.stringify(body) : undefined,
        timeout,
        onload: resolve,
        onerror: () => reject(new Error("request failed")),
        ontimeout: () => reject(new Error("request timeout")),
        onabort: () => reject(new Error("request aborted"))
      });
    });
  }

  async function callArrApi(service, settings, path, params = {}, options = {}) {
    const label = serviceLabel(service);
    const baseUrl = serviceBaseUrl(settings, service);
    const apiKey = serviceApiKey(settings, service);
    const requireKey = options.requireKey !== false;

    if (requireKey && !apiKey) {
      throw new ArrBridgeError("missingKey", `${label} API key missing`);
    }

    // Jackett authenticates via ?apikey= query parameter rather than X-Api-Key header.
    const requestParams = service === "jackett" && apiKey
      ? { ...params, apikey: apiKey }
      : params;
    const url = buildUrl(baseUrl, path, requestParams);
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {})
    };

    if (apiKey && service !== "jackett") {
      headers["X-Api-Key"] = apiKey;
    }

    let response;

    try {
      response = await gmRequest({
        method: options.method || "GET",
        url,
        headers,
        body: options.body || null
      });
    } catch (_error) {
      throw new ArrBridgeError("connect", connectionErrorMessage(service, baseUrl));
    }

    if (response.status === 401 || response.status === 403) {
      throw new ArrBridgeError("auth", `${label} API key rejected`);
    }

    if (response.status < 200 || response.status >= 300) {
      const detail = normalizeSpace(response.responseText || "").slice(0, 180);
      throw new ArrBridgeError(
        "api",
        `${label} API request failed (${response.status})${detail ? `: ${detail}` : ""}`
      );
    }

    if (response.status === 204 || !response.responseText) {
      return null;
    }

    try {
      return JSON.parse(response.responseText);
    } catch (_error) {
      return response.responseText;
    }
  }

  function normalizeResults(data) {
    if (!data) {
      return [];
    }

    return Array.isArray(data) ? data : [data];
  }

  function chooseBestResult(service, media, results) {
    if (!results.length) {
      return null;
    }

    const imdbId = String(media?.imdbId || "").toLowerCase();
    const tmdbId = Number(media?.tmdbId || 0);
    const tvdbId = Number(media?.tvdbId || 0);
    const title = normalizeSpace(media?.originalTitle || media?.title).toLowerCase();

    const byId = results.find((result) => {
      if (service === "radarr" && tmdbId && Number(result.tmdbId) === tmdbId) {
        return true;
      }

      if (service === "sonarr" && tvdbId && Number(result.tvdbId) === tvdbId) {
        return true;
      }

      return imdbId && String(result.imdbId || "").toLowerCase() === imdbId;
    });

    if (byId) {
      return byId;
    }

    return results.find((result) => {
      const resultTitle = normalizeSpace(result.title || result.originalTitle).toLowerCase();
      return title && resultTitle === title;
    }) || results[0];
  }

  function resultSearchTerm(service, result, fallbackTerm) {
    if (service === "radarr") {
      if (result?.tmdbId) {
        return `tmdb:${result.tmdbId}`;
      }

      if (result?.imdbId) {
        return `imdb:${result.imdbId}`;
      }
    }

    if (service === "sonarr" && result?.tvdbId) {
      return `tvdb:${result.tvdbId}`;
    }

    if (service === "sonarr" && result?.tmdbId) {
      return `tmdb:${result.tmdbId}`;
    }

    const title = normalizeSpace(result?.title || result?.originalTitle);
    const year = result?.year ? String(result.year) : "";
    return normalizeSpace(`${title} ${year}`) || fallbackTerm;
  }

  async function findExisting(service, settings, result) {
    try {
      if (service === "radarr" && result?.tmdbId) {
        const data = await callArrApi(service, settings, "/api/v3/movie", { tmdbId: result.tmdbId });
        return normalizeResults(data)[0] || null;
      }

      if (service === "sonarr" && result?.tvdbId) {
        const data = await callArrApi(service, settings, "/api/v3/series", { tvdbId: result.tvdbId });
        return normalizeResults(data)[0] || null;
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  function summarizeResult(result) {
    return {
      title: result?.title || result?.originalTitle || "",
      originalTitle: result?.originalTitle || "",
      year: result?.year || "",
      titleSlug: result?.titleSlug || "",
      tmdbId: result?.tmdbId || "",
      tvdbId: result?.tvdbId || "",
      imdbId: result?.imdbId || "",
      status: result?.status || "",
      overview: normalizeSpace(result?.overview || "").slice(0, 220)
    };
  }

  function summarizeRelease(result) {
    return {
      title: result?.title || "",
      indexer: result?.indexer || "",
      size: result?.size || 0,
      seeders: result?.seeders ?? "",
      leechers: result?.leechers ?? "",
      publishDate: result?.publishDate || "",
      protocol: result?.protocol || "",
      infoUrl: result?.infoUrl || "",
      guid: result?.guid || "",
      indexerId: result?.indexerId || ""
    };
  }

  function summarizeJackettRelease(result) {
    const seeders = typeof result?.Seeders === "number" ? result.Seeders : "";
    const peers = typeof result?.Peers === "number" ? result.Peers : "";
    const leechers = typeof peers === "number" && typeof seeders === "number"
      ? Math.max(peers - seeders, 0)
      : "";
    return {
      title: result?.Title || "",
      indexer: result?.Tracker || result?.TrackerId || "",
      size: Number(result?.Size || 0),
      seeders,
      leechers,
      publishDate: result?.PublishDate || "",
      protocol: result?.MagnetUri || result?.InfoHash ? "torrent" : (result?.TrackerType || ""),
      infoUrl: result?.Details || result?.Guid || "",
      guid: result?.Guid || "",
      indexerId: result?.TrackerId || ""
    };
  }

async function lookupArr(service, media, settings) {
  const searchPlan = buildSearchPlan(service, media);
  const baseUrl = serviceBaseUrl(settings, service);
  const fallbackUrl = fallbackUrlForService(service, settings, searchPlan);

    if (!serviceApiKey(settings, service)) {
      openUrl(fallbackUrl);
      return {
        ok: false,
        service,
        error: `${serviceLabel(service)} API key missing`,
        fallbackUrl,
        opened: true,
        message: `${serviceLabel(service)} API key missing. Opened browser search fallback.`
    };
  }

  const canCheckExisting =
    (service === "radarr" && media?.tmdbId && media?.tmdbType !== "tv") ||
    (service === "sonarr" && media?.tvdbId);

  if (settings.behavior !== "showPopupResults" && canCheckExisting) {
    const existing = await findExisting(service, settings, media);
    const existingUrl = buildDetailPageUrl(baseUrl, service, existing);

    if (existingUrl) {
      openUrl(existingUrl);
      return {
        ok: true,
        service,
        opened: true,
        openedUrl: existingUrl,
        message: `Opened existing ${serviceLabel(service)} item.`
      };
    }
  }

  const data = await callArrApi(service, settings, searchPlan.apiPath, searchPlan.apiParams);
    const results = normalizeResults(data);
    const best = chooseBestResult(service, media, results);

    if (!best) {
      return {
        ok: false,
        service,
        error: "No result found",
        fallbackUrl,
        searchTerm: searchPlan.term
      };
    }

    if (settings.behavior === "showPopupResults") {
      return {
        ok: true,
        service,
        mode: "showPopupResults",
        searchTerm: searchPlan.term,
        fallbackUrl,
        results: results.slice(0, 5).map(summarizeResult)
      };
    }

    if (settings.behavior === "autoAdd") {
      return addResult(service, media, best, settings, fallbackUrl);
    }

    const existing = await findExisting(service, settings, best);
    const existingUrl = buildDetailPageUrl(baseUrl, service, existing);

    if (existingUrl) {
      openUrl(existingUrl);
      return {
        ok: true,
        service,
        opened: true,
        openedUrl: existingUrl,
        message: `Opened existing ${serviceLabel(service)} item.`
      };
    }

    const addUrl = buildAddPageUrl(
      baseUrl,
      resultSearchTerm(service, best, searchPlan.fallbackTerm || searchPlan.term)
    );
    openUrl(addUrl);

    return {
      ok: true,
      service,
      opened: true,
      openedUrl: addUrl,
      message: `Opened ${serviceLabel(service)} add search.`
    };
  }

  async function lookupProwlarr(media, settings) {
    const searchPlan = buildSearchPlan("prowlarr", media);
    searchPlan.apiParams.limit = settings.prowlarrLimit;
    const searchPlans = prowlarrTerms(media).map((query) => ({
      ...searchPlan,
      term: query,
      fallbackTerm: query,
      apiParams: {
        ...searchPlan.apiParams,
        query,
        limit: settings.prowlarrLimit
      }
    }));
    const plans = searchPlans.length ? searchPlans : [searchPlan];
    const fallbackUrl = fallbackUrlForService("prowlarr", settings, plans[0]);

    if (!serviceApiKey(settings, "prowlarr")) {
      openUrl(fallbackUrl);
      return {
        ok: false,
        service: "prowlarr",
        error: "Prowlarr API key missing",
        fallbackUrl,
        opened: true,
        message: "Prowlarr API key missing. Opened browser search fallback."
    };
  }

    let activePlan = plans[0];
    let releases = [];

    for (const plan of plans) {
      const data = await callArrApi("prowlarr", settings, plan.apiPath, plan.apiParams);
      releases = normalizeResults(data);
      activePlan = plan;

      if (releases.length) {
        break;
      }
    }

    if (!releases.length) {
      return {
        ok: false,
        service: "prowlarr",
        error: "No result found",
        fallbackUrl,
        searchTerm: plans.map((plan) => plan.term).join(" / ")
      };
    }

    if (settings.behavior === "showPopupResults") {
      return {
        ok: true,
        service: "prowlarr",
        mode: "showPopupResults",
        searchTerm: activePlan.term,
        fallbackUrl,
        results: releases.slice(0, 8).map(summarizeRelease)
      };
    }

    openUrl(fallbackUrl);
    return {
      ok: true,
      service: "prowlarr",
      opened: true,
      openedUrl: fallbackUrl,
      message: "Opened Prowlarr search."
    };
  }

  async function lookupJackett(media, settings) {
    const searchPlan = buildSearchPlan("jackett", media);
    const searchPlans = jackettTerms(media).map((query) => ({
      ...searchPlan,
      term: query,
      fallbackTerm: query,
      apiParams: { ...searchPlan.apiParams, Query: query }
    }));
    const plans = searchPlans.length ? searchPlans : [searchPlan];
    const fallbackUrl = fallbackUrlForService("jackett", settings, plans[0]);

    if (!serviceApiKey(settings, "jackett")) {
      openUrl(fallbackUrl);
      return {
        ok: false,
        service: "jackett",
        error: "Jackett API key missing",
        fallbackUrl,
        opened: true,
        message: "Jackett API key missing. Opened Jackett search fallback."
      };
    }

    const rawIndexer = normalizeSpace(settings.jackettIndexer || "");
    const indexer = rawIndexer && rawIndexer !== "all" ? rawIndexer : "all";
    const apiPath = `/api/v2.0/indexers/${encodeURIComponent(indexer)}/results`;

    let activePlan = plans[0];
    let rawResults = [];

    for (const plan of plans) {
      const data = await callArrApi("jackett", settings, apiPath, plan.apiParams);
      rawResults = Array.isArray(data?.Results) ? data.Results : [];
      activePlan = plan;

      if (rawResults.length) {
        break;
      }
    }

    if (!rawResults.length) {
      return {
        ok: false,
        service: "jackett",
        error: "No result found",
        fallbackUrl,
        searchTerm: plans.map((plan) => plan.term).join(" / ")
      };
    }

    // Jackett returns raw indexer results; sort by seeders desc so healthy torrents surface first.
    rawResults.sort((a, b) => Number(b?.Seeders || 0) - Number(a?.Seeders || 0));
    const limit = clampInt(settings.jackettLimit, 1, 100, DEFAULT_SETTINGS.jackettLimit);

    if (settings.behavior === "showPopupResults") {
      return {
        ok: true,
        service: "jackett",
        mode: "showPopupResults",
        searchTerm: activePlan.term,
        fallbackUrl,
        results: rawResults.slice(0, Math.min(8, limit)).map(summarizeJackettRelease)
      };
    }

    openUrl(fallbackUrl);
    return {
      ok: true,
      service: "jackett",
      opened: true,
      openedUrl: fallbackUrl,
      message: "Opened Jackett search."
    };
  }

  async function addResult(service, media, result, settings, fallbackUrl) {
    const label = serviceLabel(service);
    const existing = await findExisting(service, settings, result);
    const existingUrl = buildDetailPageUrl(serviceBaseUrl(settings, service), service, existing);

    if (existingUrl) {
      openUrl(existingUrl);
      return {
        ok: true,
        service,
        opened: true,
        openedUrl: existingUrl,
        message: `${label} already has this item. Opened the existing page.`
      };
    }

    if (service === "radarr") {
      if (!settings.radarrRootFolderPath || !settings.radarrQualityProfileId) {
        return {
          ok: false,
          service,
          error: "Radarr auto-add requires a root folder and quality profile",
          fallbackUrl
        };
      }

      const payload = {
        ...result,
        qualityProfileId: Number(settings.radarrQualityProfileId),
        rootFolderPath: settings.radarrRootFolderPath,
        monitored: true,
        minimumAvailability: settings.radarrMinimumAvailability || "released",
        addOptions: {
          monitor: "movieOnly",
          searchForMovie: false
        }
      };

      const added = await callArrApi(service, settings, "/api/v3/movie", {}, {
        method: "POST",
        body: payload
      });
      const detailUrl = buildDetailPageUrl(serviceBaseUrl(settings, service), service, added);

      if (detailUrl) {
        openUrl(detailUrl);
      }

      return {
        ok: true,
        service,
        opened: !!detailUrl,
        openedUrl: detailUrl,
        message: "Added movie to Radarr without starting a search."
      };
    }

    if (!settings.sonarrRootFolderPath || !settings.sonarrQualityProfileId) {
      return {
        ok: false,
        service,
        error: "Sonarr auto-add requires a root folder and quality profile",
        fallbackUrl
      };
    }

    const payload = {
      ...result,
      qualityProfileId: Number(settings.sonarrQualityProfileId),
      rootFolderPath: settings.sonarrRootFolderPath,
      monitored: true,
      seasonFolder: settings.sonarrSeasonFolder !== false,
      seriesType:
        media?.mediaType === "anime"
          ? "anime"
          : settings.sonarrSeriesType || result.seriesType || "standard",
      addOptions: {
        monitor: "all",
        searchForMissingEpisodes: false,
        searchForCutoffUnmetEpisodes: false
      }
    };

    const added = await callArrApi(service, settings, "/api/v3/series", {}, {
      method: "POST",
      body: payload
    });
    const detailUrl = buildDetailPageUrl(serviceBaseUrl(settings, service), service, added);

    if (detailUrl) {
      openUrl(detailUrl);
    }

    return {
      ok: true,
      service,
      opened: !!detailUrl,
      openedUrl: detailUrl,
      message: "Added series to Sonarr without starting a search."
    };
  }

  async function openResult(service, media, result, settings) {
    const searchPlan = buildSearchPlan(service, media);

    if (service === "prowlarr") {
      const url = buildProwlarrSearchPageUrl(
        serviceBaseUrl(settings, service),
        searchPlan.fallbackTerm || searchPlan.term,
        settings.prowlarrLimit
      );
      openUrl(url);
      return { ok: true, openedUrl: url };
    }

    if (service === "jackett") {
      const directUrl = result?.infoUrl || "";
      if (directUrl) {
        openUrl(directUrl);
        return { ok: true, openedUrl: directUrl };
      }
      const url = buildJackettSearchPageUrl(
        serviceBaseUrl(settings, service),
        searchPlan.fallbackTerm || searchPlan.term
      );
      openUrl(url);
      return { ok: true, openedUrl: url };
    }

    const existing = serviceApiKey(settings, service)
      ? await findExisting(service, settings, result)
      : null;
    const detailUrl = buildDetailPageUrl(serviceBaseUrl(settings, service), service, existing);

    if (detailUrl) {
      openUrl(detailUrl);
      return { ok: true, openedUrl: detailUrl };
    }

    const addUrl = buildAddPageUrl(
      serviceBaseUrl(settings, service),
      resultSearchTerm(service, result, searchPlan.fallbackTerm || searchPlan.term)
    );
    openUrl(addUrl);
    return { ok: true, openedUrl: addUrl };
  }

  async function testConnection(service, settings) {
    try {
      const { path, params } = statusPath(service);
      await callArrApi(service, settings, path, params);
      return {
        ok: true,
        service,
        message: `${serviceLabel(service)} connection OK`
      };
    } catch (error) {
      return {
        ok: false,
        service,
        error: error.message || connectionErrorMessage(service, serviceBaseUrl(settings, service))
      };
    }
  }

  async function loadChoices(service, settings) {
    try {
      const [rootFolders, qualityProfiles] = await Promise.all([
        callArrApi(service, settings, "/api/v3/rootfolder"),
        callArrApi(service, settings, "/api/v3/qualityprofile")
      ]);

      return {
        ok: true,
        service,
        rootFolders: normalizeResults(rootFolders).map((folder) => ({
          id: folder.id,
          path: folder.path,
          freeSpace: folder.freeSpace
        })),
        qualityProfiles: normalizeResults(qualityProfiles).map((profile) => ({
          id: profile.id,
          name: profile.name
        }))
      };
    } catch (error) {
      return {
        ok: false,
        service,
        error: error.message || `${serviceLabel(service)} choices could not be loaded`
      };
    }
  }

  function text(selector) {
    return normalizeSpace(document.querySelector(selector)?.textContent || "");
  }

  function meta(selector) {
    return normalizeSpace(document.querySelector(selector)?.getAttribute("content") || "");
  }

  function createPageSnapshot() {
    return {
      bodyText: normalizeSpace(document.body?.innerText || document.documentElement.innerText || ""),
      html: document.documentElement.innerHTML || "",
      hrefs: Array.from(document.querySelectorAll("a[href]"), (link) => link.href),
      jsonLd: readJsonLd()
    };
  }

  function stripSiteTitle(value) {
    return stripArrSuffix(value)
      .replace(/\s+Altyaz(?:i|\u0131)?\s*DB.*$/i, "")
      .replace(/\s+AltyaziDB.*$/i, "")
      .trim();
  }

  function readJsonLd() {
    const nodes = [];

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        nodes.push(JSON.parse(script.textContent || "{}"));
      } catch (_error) {
        // Ignore malformed JSON-LD. DOM and URL parsing are still available.
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
              signals.breadcrumbNames.push(normalizeSpace(name));
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
      const label = normalizeSpace(strong.textContent || "");

      if (!labelRegex.test(label)) {
        continue;
      }

      const holder = strong.closest("div") || strong.parentElement;
      const span = holder?.querySelector("span");
      const value = normalizeSpace(span?.textContent || "");

      if (value && value !== label) {
        return value;
      }

      return normalizeSpace(normalizeSpace(holder?.textContent || "").replace(label, ""));
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
      normalizeSpace(document.body?.innerText || document.documentElement.innerText || "");
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
    const breadcrumbs = [...signals.breadcrumbNames, ...signals.breadcrumbUrls].join(" ").toLowerCase();
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
        const candidate = cleanReleaseSearchTitle(node.textContent || "", year);

        if (candidate) {
          values.push(candidate);
        }
      }
    }

    return uniqueSearchTitles(values).slice(0, 5);
  }

  function extractAlternativeTitles(title, originalTitle, releaseTitles) {
    const explicit = labelValue(/alternatif|alternative|di\u011fer ad/i);
    const values = [title, originalTitle, ...(releaseTitles || [])];

    if (explicit) {
      values.push(...explicit.split(/[,/|;]/).map(normalizeSpace));
    }

    return uniqueSearchTitles(values);
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
    const originalTitle = labelValue(/orijinal ba\u015fl\u0131k|original title|original name/i) || title;
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
      const out = [...services];
      if (settings?.showProwlarrButton !== false) {
        out.push("prowlarr");
      }
      if (settings?.showJackettButton !== false) {
        out.push("jackett");
      }
      return out;
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

  function injectStyles() {
    if (document.getElementById(`${ROOT_ID}-style`)) {
      return;
    }

    const style = document.createElement("style");
    style.id = `${ROOT_ID}-style`;
    style.textContent = `
      #${ROOT_ID} {
        color-scheme: dark;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        position: relative;
        z-index: 20;
      }

      .v2-movie-title-row #${ROOT_ID} {
        margin-left: auto;
        align-self: center;
      }

      .adb-tm-shell {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        max-width: min(100%, 560px);
      }

      .adb-tm-button-row {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }

      .adb-tm-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 38px;
        padding: 7px 12px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 8px;
        background: linear-gradient(180deg, #2b2f36 0%, #1f2329 100%);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
        color: #f8fafc;
        cursor: pointer;
        font: 800 15px/1 Inter, system-ui, sans-serif;
        letter-spacing: 0;
        transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background 160ms ease;
        white-space: nowrap;
      }

      .adb-tm-button:hover {
        border-color: rgba(52, 183, 227, 0.55);
        background: linear-gradient(180deg, #333942 0%, #232832 100%);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
        transform: translateY(-1px);
      }

      .adb-tm-button:disabled {
        cursor: wait;
        opacity: 0.68;
        transform: none;
      }

      .adb-tm-button-radarr {
        border-color: rgba(247, 185, 44, 0.58);
      }

      .adb-tm-button-sonarr {
        border-color: rgba(0, 174, 239, 0.58);
        box-shadow: 0 0 0 1px rgba(0, 174, 239, 0.12), 0 10px 24px rgba(0, 0, 0, 0.22);
      }

      .adb-tm-button-prowlarr {
        border-color: rgba(241, 107, 42, 0.58);
        box-shadow: 0 0 0 1px rgba(241, 107, 42, 0.12), 0 10px 24px rgba(0, 0, 0, 0.22);
      }

      .adb-tm-icon {
        display: block;
        width: 32px;
        height: 32px;
        object-fit: contain;
      }

      .adb-tm-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 18px;
        color: #94a3b8;
        font: 700 12px/1.45 Inter, system-ui, sans-serif;
      }

      .adb-tm-status:empty {
        display: none;
      }

      .adb-tm-status-success {
        color: #2ecc71;
      }

      .adb-tm-status-warn {
        color: #f7b92c;
      }

      .adb-tm-status-error {
        color: #fb7185;
      }

      .adb-tm-link-button,
      .adb-tm-result-action,
      .adb-tm-popup-close,
      .adb-tm-options button {
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.74);
        color: #e2e8f0;
        cursor: pointer;
        font: 800 12px/1 Inter, system-ui, sans-serif;
      }

      .adb-tm-link-button {
        padding: 5px 8px;
      }

      .adb-tm-popup {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        width: min(560px, calc(100vw - 32px));
        max-height: min(460px, calc(100vh - 160px));
        overflow: auto;
        padding: 12px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 8px;
        background: #151922;
        box-shadow: 0 20px 44px rgba(0, 0, 0, 0.45);
        color: #e2e8f0;
      }

      .adb-tm-popup-title {
        padding-right: 32px;
        color: #f8fafc;
        font: 900 14px/1.25 Inter, system-ui, sans-serif;
      }

      .adb-tm-popup-close {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 26px;
        height: 26px;
        padding: 0;
      }

      .adb-tm-result-list {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }

      .adb-tm-result {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        padding: 10px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 8px;
        background: rgba(30, 35, 44, 0.78);
      }

      .adb-tm-result-main {
        min-width: 0;
      }

      .adb-tm-result-title {
        overflow: hidden;
        color: #fff;
        font: 900 13px/1.3 Inter, system-ui, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .adb-tm-result-meta,
      .adb-tm-result-overview,
      .adb-tm-result-empty {
        color: #94a3b8;
        font: 700 11px/1.45 Inter, system-ui, sans-serif;
      }

      .adb-tm-result-overview {
        display: -webkit-box;
        margin-top: 5px;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .adb-tm-result-action {
        min-height: 32px;
        padding: 7px 10px;
        white-space: nowrap;
      }

      .adb-tm-options-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(2, 6, 23, 0.72);
        color-scheme: dark;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .adb-tm-options {
        width: min(980px, 100%);
        max-height: min(760px, calc(100vh - 40px));
        overflow: auto;
        padding: 18px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 8px;
        background: #11151c;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
        color: #f8fafc;
      }

      .adb-tm-options * {
        box-sizing: border-box;
      }

      .adb-tm-options-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }

      .adb-tm-options h2,
      .adb-tm-options h3,
      .adb-tm-options p {
        margin: 0;
      }

      .adb-tm-options h2 {
        font-size: 20px;
      }

      .adb-tm-options p,
      .adb-tm-options small {
        color: #94a3b8;
      }

      .adb-tm-options-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }

      .adb-tm-panel {
        display: grid;
        gap: 10px;
        align-content: start;
        padding: 14px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 8px;
        background: #1b2029;
      }

      .adb-tm-panel-wide {
        grid-column: 1 / -1;
      }

      .adb-tm-panel-title {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .adb-tm-options label {
        display: grid;
        gap: 6px;
        color: #94a3b8;
        font-size: 12px;
        font-weight: 800;
      }

      .adb-tm-options input,
      .adb-tm-options select {
        width: 100%;
        min-height: 36px;
        padding: 8px 10px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 8px;
        background: #111827;
        color: #f8fafc;
        font: 700 13px/1.3 Inter, system-ui, sans-serif;
      }

      .adb-tm-options-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }

      .adb-tm-options button {
        min-height: 34px;
        padding: 8px 10px;
      }

      .adb-tm-options-primary {
        margin-left: auto;
        border-color: rgba(52, 183, 227, 0.55) !important;
        background: #1c5368 !important;
      }

      .adb-tm-checkbox {
        display: flex !important;
        grid-template-columns: none;
        align-items: center;
        gap: 8px;
      }

      .adb-tm-checkbox input {
        width: 16px;
        min-height: 16px;
      }

      .adb-tm-options-status {
        min-height: 18px;
        color: #94a3b8;
        font: 800 12px/1.4 Inter, system-ui, sans-serif;
      }

      .adb-tm-options-status.success {
        color: #2ecc71;
      }

      .adb-tm-options-status.error {
        color: #fb7185;
      }

      .adb-tm-options-status.warn {
        color: #f7b92c;
      }

      @media (max-width: 840px) {
        .adb-tm-options-grid,
        .adb-tm-result {
          grid-template-columns: 1fr;
        }

        .v2-movie-title-row #${ROOT_ID},
        .adb-tm-shell,
        .adb-tm-button-row,
        .adb-tm-button,
        .adb-tm-result-action {
          width: 100%;
        }
      }
    `;
    document.documentElement.append(style);
  }

  function buttonLabel(service) {
    return serviceLabel(service);
  }

  function createButton(service, media) {
    const button = document.createElement("button");
    const icon = document.createElement("img");
    const label = document.createElement("span");
    const plan = buildSearchPlan(service, media);

    button.type = "button";
    button.className = `adb-tm-button adb-tm-button-${service}`;
    button.title = `Search ${buttonLabel(service)} for ${plan.term || plan.fallbackTerm}`;
    button.dataset.service = service;

    icon.className = "adb-tm-icon";
    icon.src = ICONS[service];
    icon.alt = "";

    label.textContent = buttonLabel(service);

    button.append(icon, label);
    return button;
  }

  function setStatus(shell, message, tone = "neutral", fallbackUrl = "") {
    const status = shell.querySelector(".adb-tm-status");
    status.textContent = "";
    status.className = `adb-tm-status adb-tm-status-${tone}`;

    if (message) {
      const textNode = document.createElement("span");
      textNode.textContent = message;
      status.append(textNode);
    }

    if (fallbackUrl) {
      const fallback = document.createElement("button");
      fallback.type = "button";
      fallback.className = "adb-tm-link-button";
      fallback.textContent = "Open search";
      fallback.addEventListener("click", () => openUrl(fallbackUrl));
      status.append(fallback);
    }
  }

  function clearPopup(shell) {
    shell.querySelector(".adb-tm-popup")?.remove();
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

    popup.className = "adb-tm-popup";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", `${buttonLabel(service)} results`);

    title.className = "adb-tm-popup-title";
    title.textContent = `${buttonLabel(service)} results`;

    close.type = "button";
    close.className = "adb-tm-popup-close";
    close.textContent = "x";
    close.setAttribute("aria-label", "Close results");
    close.addEventListener("click", () => clearPopup(shell));

    list.className = "adb-tm-result-list";

    for (const result of response.results || []) {
      const row = document.createElement("div");
      const main = document.createElement("div");
      const name = document.createElement("div");
      const metaLine = document.createElement("div");
      const action = document.createElement("button");

      row.className = "adb-tm-result";
      main.className = "adb-tm-result-main";
      name.className = "adb-tm-result-title";
      metaLine.className = "adb-tm-result-meta";
      action.type = "button";
      action.className = "adb-tm-result-action";

      name.textContent = result.title || result.originalTitle || "Untitled result";
      metaLine.textContent = resultMeta(service, result);
      action.textContent = `Open in ${buttonLabel(service)}`;
      action.addEventListener("click", async () => {
        action.disabled = true;
        setStatus(shell, `Opening ${buttonLabel(service)}...`);

        try {
          const settings = await getSettings();
          const openResponse = await openResult(service, media, result, settings);

          setStatus(
            shell,
            openResponse?.ok ? `Opened ${buttonLabel(service)}.` : openResponse?.error || "Could not open result",
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
        overview.className = "adb-tm-result-overview";
        overview.textContent = result.overview;
        main.append(overview);
      }

      row.append(main, action);
      list.append(row);
    }

    if (!list.children.length) {
      const empty = document.createElement("div");
      empty.className = "adb-tm-result-empty";
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
      const settings = await getSettings();
      const response = service === "prowlarr"
        ? await lookupProwlarr(media, settings)
        : service === "jackett"
          ? await lookupJackett(media, settings)
          : await lookupArr(service, media, settings);

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
      const settings = await getSettings();
      const searchPlan = buildSearchPlan(service, media);
      setStatus(
        shell,
        error.message || "Unexpected userscript error",
        "error",
        fallbackUrlForService(service, settings, searchPlan)
      );
    } finally {
      button.disabled = false;
    }
  }

  async function render() {
    if (document.getElementById(ROOT_ID)) {
      return true;
    }

    injectStyles();

    const media = extractMedia();
    const settings = await getSettings();

    if (!isLikelyDetailPage(media)) {
      return false;
    }

    const services = serviceForMedia(media, settings);
    const shell = document.createElement("div");
    const buttonRow = document.createElement("div");
    const status = document.createElement("div");

    shell.id = ROOT_ID;
    shell.className = "adb-tm-shell";
    shell.dataset.mediaType = media.mediaType;
    buttonRow.className = "adb-tm-button-row";
    status.className = "adb-tm-status adb-tm-status-neutral";

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

  function escapeAttr(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function selectOption(value, label, current) {
    return `<option value="${escapeAttr(value)}"${String(value) === String(current) ? " selected" : ""}>${escapeAttr(label)}</option>`;
  }

  function currentProfileOption(current) {
    return current ? selectOption(current, `Current profile ID ${current}`, current) : selectOption("", "Choose a profile", "");
  }

  function setOptionsStatus(root, message, tone = "") {
    const status = root.querySelector(".adb-tm-options-status");
    status.textContent = message || "";
    status.className = `adb-tm-options-status ${tone}`.trim();
  }

  function readSettingsForm(root) {
    const value = (id) => root.querySelector(`#${id}`)?.value?.trim() || "";
    const checked = (id) => root.querySelector(`#${id}`)?.checked !== false;

    return mergeSettings({
      radarrBaseUrl: value("adbRadarrBaseUrl"),
      radarrApiKey: value("adbRadarrApiKey"),
      sonarrBaseUrl: value("adbSonarrBaseUrl"),
      sonarrApiKey: value("adbSonarrApiKey"),
      prowlarrBaseUrl: value("adbProwlarrBaseUrl"),
      prowlarrApiKey: value("adbProwlarrApiKey"),
      showProwlarrButton: checked("adbShowProwlarrButton"),
      prowlarrLimit: value("adbProwlarrLimit"),
      jackettBaseUrl: value("adbJackettBaseUrl"),
      jackettApiKey: value("adbJackettApiKey"),
      jackettIndexer: value("adbJackettIndexer") || DEFAULT_SETTINGS.jackettIndexer,
      jackettLimit: value("adbJackettLimit"),
      showJackettButton: checked("adbShowJackettButton"),
      behavior: value("adbBehavior") || DEFAULT_SETTINGS.behavior,
      radarrRootFolderPath: value("adbRadarrRootFolderPath"),
      radarrQualityProfileId: value("adbRadarrQualityProfileId"),
      radarrMinimumAvailability: value("adbRadarrMinimumAvailability"),
      sonarrRootFolderPath: value("adbSonarrRootFolderPath"),
      sonarrQualityProfileId: value("adbSonarrQualityProfileId"),
      sonarrSeriesType: value("adbSonarrSeriesType"),
      sonarrSeasonFolder: checked("adbSonarrSeasonFolder")
    });
  }

  function populateChoices(root, service, response) {
    const rootList = root.querySelector(`#adb${capitalize(service)}RootFolders`);
    const profileSelect = root.querySelector(`#adb${capitalize(service)}QualityProfileId`);
    const currentProfile = profileSelect.value;

    rootList.innerHTML = "";
    profileSelect.innerHTML = currentProfile
      ? currentProfileOption(currentProfile)
      : selectOption("", "Choose a profile", "");

    for (const folder of response.rootFolders || []) {
      const option = document.createElement("option");
      option.value = folder.path;
      rootList.append(option);
    }

    for (const profile of response.qualityProfiles || []) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      profileSelect.append(option);
    }

    if (currentProfile) {
      profileSelect.value = currentProfile;
    }
  }

  function capitalize(value) {
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  }

  async function openSettingsPanel() {
    injectStyles();
    document.querySelector(".adb-tm-options-backdrop")?.remove();

    const settings = await getSettings();
    const backdrop = document.createElement("div");
    backdrop.className = "adb-tm-options-backdrop";
    backdrop.innerHTML = `
      <section class="adb-tm-options" role="dialog" aria-label="AltyaziDB Arr Bridge settings">
        <div class="adb-tm-options-header">
          <div>
            <h2>AltyaziDB Arr Bridge</h2>
            <p>Tampermonkey settings are stored locally with GM_setValue.</p>
          </div>
          <button type="button" data-close>Close</button>
        </div>

        <div class="adb-tm-options-grid">
          <section class="adb-tm-panel">
            <div class="adb-tm-panel-title">
              <img class="adb-tm-icon" src="${ICONS.radarr}" alt="">
              <h3>Radarr</h3>
            </div>
            <label>Base URL <input id="adbRadarrBaseUrl" type="url" value="${escapeAttr(settings.radarrBaseUrl)}"></label>
            <label>API key <input id="adbRadarrApiKey" type="password" autocomplete="off" value="${escapeAttr(settings.radarrApiKey)}"></label>
            <div class="adb-tm-options-row">
              <button type="button" data-test="radarr">Test Radarr</button>
              <button type="button" data-load="radarr">Load folders/profiles</button>
            </div>
            <label>Root folder path
              <input id="adbRadarrRootFolderPath" list="adbRadarrRootFolders" value="${escapeAttr(settings.radarrRootFolderPath)}">
              <datalist id="adbRadarrRootFolders"></datalist>
            </label>
            <label>Quality profile
              <select id="adbRadarrQualityProfileId">${currentProfileOption(settings.radarrQualityProfileId)}</select>
            </label>
            <label>Minimum availability
              <select id="adbRadarrMinimumAvailability">
                ${selectOption("released", "Released", settings.radarrMinimumAvailability)}
                ${selectOption("inCinemas", "In cinemas", settings.radarrMinimumAvailability)}
                ${selectOption("announced", "Announced", settings.radarrMinimumAvailability)}
              </select>
            </label>
          </section>

          <section class="adb-tm-panel">
            <div class="adb-tm-panel-title">
              <img class="adb-tm-icon" src="${ICONS.sonarr}" alt="">
              <h3>Sonarr</h3>
            </div>
            <label>Base URL <input id="adbSonarrBaseUrl" type="url" value="${escapeAttr(settings.sonarrBaseUrl)}"></label>
            <label>API key <input id="adbSonarrApiKey" type="password" autocomplete="off" value="${escapeAttr(settings.sonarrApiKey)}"></label>
            <div class="adb-tm-options-row">
              <button type="button" data-test="sonarr">Test Sonarr</button>
              <button type="button" data-load="sonarr">Load folders/profiles</button>
            </div>
            <label>Root folder path
              <input id="adbSonarrRootFolderPath" list="adbSonarrRootFolders" value="${escapeAttr(settings.sonarrRootFolderPath)}">
              <datalist id="adbSonarrRootFolders"></datalist>
            </label>
            <label>Quality profile
              <select id="adbSonarrQualityProfileId">${currentProfileOption(settings.sonarrQualityProfileId)}</select>
            </label>
            <label>Series type
              <select id="adbSonarrSeriesType">
                ${selectOption("standard", "Standard", settings.sonarrSeriesType)}
                ${selectOption("anime", "Anime", settings.sonarrSeriesType)}
                ${selectOption("daily", "Daily", settings.sonarrSeriesType)}
              </select>
            </label>
            <label class="adb-tm-checkbox">
              <input id="adbSonarrSeasonFolder" type="checkbox"${settings.sonarrSeasonFolder !== false ? " checked" : ""}>
              <span>Use season folders</span>
            </label>
          </section>

          <section class="adb-tm-panel">
            <div class="adb-tm-panel-title">
              <img class="adb-tm-icon" src="${ICONS.prowlarr}" alt="">
              <h3>Prowlarr</h3>
            </div>
            <label>Base URL <input id="adbProwlarrBaseUrl" type="url" value="${escapeAttr(settings.prowlarrBaseUrl)}"></label>
            <label>API key <input id="adbProwlarrApiKey" type="password" autocomplete="off" value="${escapeAttr(settings.prowlarrApiKey)}"></label>
            <label>Search result limit <input id="adbProwlarrLimit" type="number" min="1" max="100" step="1" value="${escapeAttr(settings.prowlarrLimit)}"></label>
            <label class="adb-tm-checkbox">
              <input id="adbShowProwlarrButton" type="checkbox"${settings.showProwlarrButton !== false ? " checked" : ""}>
              <span>Show Prowlarr button</span>
            </label>
            <div class="adb-tm-options-row">
              <button type="button" data-test="prowlarr">Test Prowlarr</button>
            </div>
          </section>

          <section class="adb-tm-panel">
            <div class="adb-tm-panel-title">
              <img class="adb-tm-icon" src="${ICONS.jackett}" alt="">
              <h3>Jackett</h3>
            </div>
            <label>Base URL <input id="adbJackettBaseUrl" type="url" value="${escapeAttr(settings.jackettBaseUrl)}"></label>
            <label>API key <input id="adbJackettApiKey" type="password" autocomplete="off" value="${escapeAttr(settings.jackettApiKey)}"></label>
            <label>Indexer id <input id="adbJackettIndexer" type="text" placeholder="all" value="${escapeAttr(settings.jackettIndexer)}"></label>
            <label>Search result limit <input id="adbJackettLimit" type="number" min="1" max="100" step="1" value="${escapeAttr(settings.jackettLimit)}"></label>
            <label class="adb-tm-checkbox">
              <input id="adbShowJackettButton" type="checkbox"${settings.showJackettButton !== false ? " checked" : ""}>
              <span>Show Jackett button</span>
            </label>
            <div class="adb-tm-options-row">
              <button type="button" data-test="jackett">Test Jackett</button>
            </div>
          </section>

          <section class="adb-tm-panel adb-tm-panel-wide">
            <h3>Behavior</h3>
            <label>Preferred behavior
              <select id="adbBehavior">
                ${selectOption("openSearchPage", "Open search page", settings.behavior)}
                ${selectOption("showPopupResults", "Show popup results", settings.behavior)}
                ${selectOption("autoAdd", "Auto-add", settings.behavior)}
              </select>
            </label>
            <small>Auto-add never starts an immediate download search. Radarr uses searchForMovie=false; Sonarr uses searchForMissingEpisodes=false and searchForCutoffUnmetEpisodes=false.</small>
          </section>
        </div>

        <div class="adb-tm-options-row" style="margin-top: 12px;">
          <div class="adb-tm-options-status" role="status" aria-live="polite"></div>
          <button type="button" data-reset>Reset defaults</button>
          <button type="button" class="adb-tm-options-primary" data-save>Save settings</button>
        </div>
      </section>
    `;

    document.documentElement.append(backdrop);

    backdrop.querySelector("[data-close]").addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        backdrop.remove();
      }
    });

    backdrop.querySelector("[data-save]").addEventListener("click", async () => {
      await saveSettings(readSettingsForm(backdrop));
      setOptionsStatus(backdrop, "Settings saved. Reload the page to refresh buttons.", "success");
    });

    backdrop.querySelector("[data-reset]").addEventListener("click", async () => {
      await saveSettings(DEFAULT_SETTINGS);
      setOptionsStatus(backdrop, "Defaults restored. Reopen settings to see defaults.", "warn");
    });

    for (const button of backdrop.querySelectorAll("[data-test]")) {
      button.addEventListener("click", async () => {
        const service = button.dataset.test;
        button.disabled = true;
        setOptionsStatus(backdrop, `Testing ${serviceLabel(service)}...`);

        try {
          const response = await testConnection(service, readSettingsForm(backdrop));
          setOptionsStatus(backdrop, response.ok ? response.message : response.error, response.ok ? "success" : "error");
        } finally {
          button.disabled = false;
        }
      });
    }

    for (const button of backdrop.querySelectorAll("[data-load]")) {
      button.addEventListener("click", async () => {
        const service = button.dataset.load;
        button.disabled = true;
        setOptionsStatus(backdrop, `Loading ${serviceLabel(service)} folders/profiles...`);

        try {
          const response = await loadChoices(service, readSettingsForm(backdrop));

          if (!response.ok) {
            setOptionsStatus(backdrop, response.error || "Choices could not be loaded", "error");
            return;
          }

          populateChoices(backdrop, service, response);
          setOptionsStatus(backdrop, "Folders and profiles loaded.", "success");
        } finally {
          button.disabled = false;
        }
      });
    }
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }

    GM_registerMenuCommand("AltyaziDB Arr Bridge settings", () => {
      openSettingsPanel().catch((error) => {
        console.error("[AltyaziDB Arr Bridge]", error);
      });
    });

    GM_registerMenuCommand("Reset AltyaziDB Arr Bridge settings", () => {
      saveSettings(DEFAULT_SETTINGS).catch((error) => {
        console.error("[AltyaziDB Arr Bridge]", error);
      });
    });
  }

  registerMenu();

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
        .catch((error) => {
          console.error("[AltyaziDB Arr Bridge]", error);

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
