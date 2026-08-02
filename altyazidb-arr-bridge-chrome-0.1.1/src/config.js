(() => {
  const DEFAULT_SETTINGS = {
    radarrBaseUrl: "http://127.0.0.1:7878",
    radarrApiKey: "",
    sonarrBaseUrl: "http://127.0.0.1:8989",
    sonarrApiKey: "",
    prowlarrBaseUrl: "http://127.0.0.1:9696",
    prowlarrApiKey: "",
    showProwlarrButton: true,
    prowlarrLimit: 25,
    jackettBaseUrl: "http://127.0.0.1:9117",
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

  // Release-name parsing can produce many title variants. Prowlarr and Jackett
  // queries fan out to every enabled tracker, so only the strongest few
  // alternatives are retried before falling back to the search page.
  const MAX_SEARCH_ATTEMPTS = 3;

  // Status and lookup endpoints answer quickly; aggregate tracker searches
  // routinely need longer than a plain API call.
  const REQUEST_TIMEOUT_MS = 10000;
  const SEARCH_TIMEOUT_MS = 30000;

  const SUBTITLE_PATH_RE = /^\/(?:film|dizi|anime-filmleri|anime-dizileri|animasyon-filmleri|animasyon-dizileri|asya-filmleri|asya-dizileri|belgesel-filmleri|belgesel-dizileri|tv-programlari)\//i;
  const NON_SUBTITLE_PATH_RE = /^\/(?:forum|user|uploads|engine|index(?:\.php|\.html)?|search|page|lastnews|allnews|tags|stats|statistics|(?:register|login|lostpassword|autobackup)(?:\.php|\.html)?|admin(?:\.php)?)(?:\/|$|\?)/i;

  function stripArrSuffix(title) {
    return String(title || "")
      .replace(/\s+(?:\u00bb|\||-)\s+AltyaziDb.*$/i, "")
      .replace(/\s+\|\s+AltyaziDb.*$/i, "")
      .trim();
  }

  function normalizeSpace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeBaseUrl(value, fallback) {
    const raw = String(value ?? fallback ?? "").trim().replace(/\/+$/, "");

    if (!raw) {
      return "";
    }

    try {
      const hostPort = /^(?:\[[^\]]+]|[^:/?#]+):\d+(?:[/?#]|$)/.test(raw);
      const explicitScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);

      if (explicitScheme && !/^https?:\/\//i.test(raw) && !hostPort) {
        return "";
      }

      const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      const parsed = new URL(withProtocol);

      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
      ) {
        return "";
      }

      parsed.hash = "";
      parsed.search = "";
      return parsed.toString().replace(/\/+$/, "");
    } catch (_error) {
      return "";
    }
  }

  // Returns "" when no valid pattern exists, which covers both invalid URLs and
  // IPv6 literal hosts: browser match patterns cannot express `[::1]`, and
  // passing such a pattern to permissions.contains() throws. Callers must treat
  // an empty pattern as "cannot pre-check" and validate the URL separately.
  function hostPermissionPattern(baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl, baseUrl);

    if (!normalized) {
      return "";
    }

    try {
      const parsed = new URL(normalized);

      if (!["http:", "https:"].includes(parsed.protocol) || parsed.hostname.startsWith("[")) {
        return "";
      }

      return `${parsed.protocol}//${parsed.hostname}/*`;
    } catch (_error) {
      return "";
    }
  }

  function safeHttpUrl(value) {
    try {
      const parsed = new URL(normalizeSpace(value));

      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "";
      }

      if (parsed.username || parsed.password) {
        return "";
      }

      return parsed.toString();
    } catch (_error) {
      return "";
    }
  }

  function configuredServiceUrl(settings, service, value) {
    const safeUrl = safeHttpUrl(value);

    if (!safeUrl || !["radarr", "sonarr", "prowlarr", "jackett"].includes(service)) {
      return "";
    }

    const baseUrl = normalizeBaseUrl(serviceBaseUrl(settings, service), "");

    if (!baseUrl) {
      return "";
    }

    const target = new URL(safeUrl);
    const base = new URL(baseUrl);

    if (base.origin !== target.origin) {
      return "";
    }

    const basePath = base.pathname.replace(/\/+$/, "") || "/";
    const targetPath = target.pathname.replace(/\/+$/, "") || "/";
    const staysWithinBasePath = basePath === "/" ||
      targetPath === basePath ||
      targetPath.startsWith(`${basePath}/`);

    return staysWithinBasePath ? safeUrl : "";
  }

  function clampInt(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
  }

  function normalizeBoolean(value, fallback) {
    if (typeof value === "boolean") {
      return value;
    }

    if (value === 1 || value === "1") {
      return true;
    }

    if (value === 0 || value === "0") {
      return false;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();

      if (["true", "yes", "on"].includes(normalized)) {
        return true;
      }

      if (["false", "no", "off"].includes(normalized)) {
        return false;
      }
    }

    return fallback;
  }

  function normalizePositiveId(value) {
    if (value === "" || value === null || value === undefined) {
      return "";
    }

    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "";
  }

  function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
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

  function firstYear(values) {
    for (const value of values || []) {
      const match = String(value || "").match(/\b(?:18|19|20|21)\d{2}\b/);

      if (match) {
        return Number(match[0]);
      }
    }

    return null;
  }

  function yearFromSignals({ detailYears = [], jsonLdYears = [], titleValues = [] } = {}) {
    return firstYear(detailYears) || firstYear(jsonLdYears) || firstYear(titleValues);
  }

  function extractExternalIds(hrefs = []) {
    const ids = {
      imdbId: "",
      tmdbId: "",
      tmdbType: "",
      tvdbId: ""
    };

    for (const href of hrefs) {
      let url;

      try {
        url = new URL(String(href || ""));
      } catch (_error) {
        continue;
      }

      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      const path = url.pathname;

      if (!ids.imdbId && host === "imdb.com") {
        const match = path.match(/\/title\/(tt\d{7,10})\b/i);

        if (match) {
          ids.imdbId = match[1].toLowerCase();
        }
      }

      if (!ids.tmdbId && host === "themoviedb.org") {
        const match = path.match(/\/(movie|tv)\/(\d+)/i);

        if (match) {
          ids.tmdbType = match[1].toLowerCase();
          ids.tmdbId = Number(match[2]);
        }
      }

      if (!ids.tvdbId && host === "thetvdb.com") {
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

    return ids;
  }

  function isBlockedPagePath(pathname) {
    const path = String(pathname || "/");
    return path === "/" || NON_SUBTITLE_PATH_RE.test(path);
  }

  function isLikelyDetailPage(pathname, hasDetailMarker) {
    const path = String(pathname || "/");

    if (isBlockedPagePath(path)) {
      return false;
    }

    if (SUBTITLE_PATH_RE.test(path)) {
      return Boolean(hasDetailMarker);
    }

    return Boolean(hasDetailMarker);
  }

  function detectSeasonEpisode(pathname, pageTitle) {
    let decodedPath = String(pathname || "");

    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch (_error) {
      // Keep the original path when it contains malformed escape sequences.
    }

    const signal = normalizeSpace(
      `${decodedPath.replace(/[\/_.-]+/g, " ")} ${pageTitle || ""}`
    );
    const compact = signal.match(
      /\bS(?:eason)?\s*0?(\d{1,2})\s*(?:E|Ep|Episode|B[o\u00f6]l[u\u00fc]m|x)\s*0?(\d{1,3})\b/i
    );
    const xFormat = signal.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,3})\b/);
    const namedPair =
      signal.match(/\b(?:Season|Sezon)\s*0?(\d{1,2})\D{0,20}(?:Episode|B[o\u00f6]l[u\u00fc]m)\s*0?(\d{1,3})\b/i) ||
      signal.match(/\b0?(\d{1,2})\.\s*(?:Season|Sezon)\D{0,20}0?(\d{1,3})\.\s*(?:Episode|B[o\u00f6]l[u\u00fc]m)\b/i);
    const seasonText =
      signal.match(/\b(?:Season|Sezon)\s*0?(\d{1,2})\b/i) ||
      signal.match(/\b0?(\d{1,2})\.\s*(?:Season|Sezon)\b/i);
    const episodeText =
      signal.match(/\b(?:Episode|B[o\u00f6]l[u\u00fc]m)\s*0?(\d{1,3})\b/i) ||
      signal.match(/\b0?(\d{1,3})\.\s*(?:Episode|B[o\u00f6]l[u\u00fc]m)\b/i);

    if (compact || xFormat || namedPair) {
      const match = compact || xFormat || namedPair;
      return {
        seasonNumber: Number(match[1]),
        episodeNumber: Number(match[2])
      };
    }

    return {
      seasonNumber: seasonText ? Number(seasonText[1]) : null,
      episodeNumber: episodeText ? Number(episodeText[1]) : null
    };
  }

  function detectMediaType({
    pathname = "",
    breadcrumbs = "",
    schemaTypes = "",
    tmdbType = "",
    seasonNumber = null,
    episodeNumber = null
  } = {}) {
    const path = String(pathname || "").toLowerCase();
    const breadcrumbText = String(breadcrumbs || "").toLowerCase();
    const schemaText = String(schemaTypes || "").toLowerCase();

    if (/\/(?:film|anime-filmleri|animasyon-filmleri|asya-filmleri|belgesel-filmleri)\//.test(path)) {
      return "movie";
    }

    if (/\/anime-dizileri\//.test(path) || /\banime diz/i.test(breadcrumbText)) {
      return "anime";
    }

    if (/\/(?:dizi|animasyon-dizileri|asya-dizileri|belgesel-dizileri|tv-programlari)\//.test(path)) {
      if (episodeNumber) {
        return "episode";
      }

      if (seasonNumber) {
        return "season";
      }

      return "series";
    }

    if (/\bfilm\b|movie/.test(breadcrumbText) || /\bmovie\b/.test(schemaText) || tmdbType === "movie") {
      return "movie";
    }

    if (/\bdizi\b|\bseries\b|\btv\b/.test(breadcrumbText) || /tvseries/.test(schemaText) || tmdbType === "tv") {
      if (episodeNumber) {
        return "episode";
      }

      if (seasonNumber) {
        return "season";
      }

      return "series";
    }

    if (episodeNumber) {
      return "episode";
    }

    if (seasonNumber) {
      return "season";
    }

    return "unknown";
  }

  function mergeSettings(settings) {
    const merged = {
      ...DEFAULT_SETTINGS,
      ...(settings || {})
    };

    merged.radarrBaseUrl = normalizeBaseUrl(
      merged.radarrBaseUrl,
      DEFAULT_SETTINGS.radarrBaseUrl
    );
    merged.sonarrBaseUrl = normalizeBaseUrl(
      merged.sonarrBaseUrl,
      DEFAULT_SETTINGS.sonarrBaseUrl
    );
    merged.prowlarrBaseUrl = normalizeBaseUrl(
      merged.prowlarrBaseUrl,
      DEFAULT_SETTINGS.prowlarrBaseUrl
    );
    merged.jackettBaseUrl = normalizeBaseUrl(
      merged.jackettBaseUrl,
      DEFAULT_SETTINGS.jackettBaseUrl
    );
    merged.behavior = [
      "openSearchPage",
      "showPopupResults",
      "autoAdd"
    ].includes(merged.behavior)
      ? merged.behavior
      : DEFAULT_SETTINGS.behavior;
    merged.sonarrSeasonFolder = normalizeBoolean(
      merged.sonarrSeasonFolder,
      DEFAULT_SETTINGS.sonarrSeasonFolder
    );
    merged.showProwlarrButton = normalizeBoolean(
      merged.showProwlarrButton,
      DEFAULT_SETTINGS.showProwlarrButton
    );
    merged.showJackettButton = normalizeBoolean(
      merged.showJackettButton,
      DEFAULT_SETTINGS.showJackettButton
    );
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
    merged.jackettIndexer = normalizeSpace(merged.jackettIndexer) || "all";
    merged.radarrMinimumAvailability = ["released", "inCinemas", "announced"]
      .includes(merged.radarrMinimumAvailability)
      ? merged.radarrMinimumAvailability
      : DEFAULT_SETTINGS.radarrMinimumAvailability;
    merged.sonarrSeriesType = ["standard", "anime", "daily"]
      .includes(merged.sonarrSeriesType)
      ? merged.sonarrSeriesType
      : DEFAULT_SETTINGS.sonarrSeriesType;
    merged.radarrQualityProfileId = normalizePositiveId(merged.radarrQualityProfileId);
    merged.sonarrQualityProfileId = normalizePositiveId(merged.sonarrQualityProfileId);
    merged.radarrRootFolderPath = normalizeString(merged.radarrRootFolderPath);
    merged.sonarrRootFolderPath = normalizeString(merged.sonarrRootFolderPath);
    merged.radarrApiKey = normalizeString(merged.radarrApiKey);
    merged.sonarrApiKey = normalizeString(merged.sonarrApiKey);
    merged.prowlarrApiKey = normalizeString(merged.prowlarrApiKey);
    merged.jackettApiKey = normalizeString(merged.jackettApiKey);

    return merged;
  }

  function getDisplayTitle(media) {
    const pageTitle = typeof document === "undefined" ? "" : document.title;

    return (
      normalizeSpace(media?.title) ||
      normalizeSpace(media?.originalTitle) ||
      stripArrSuffix(pageTitle)
    );
  }

  function searchTitleCandidates(media) {
    const pageTitle = typeof document === "undefined" ? "" : document.title;
    const releaseTitles = Array.isArray(media?.releaseTitles) ? media.releaseTitles : [];
    const alternativeTitles = Array.isArray(media?.alternativeTitles) ? media.alternativeTitles : [];

    return uniqueSearchTitles([
      normalizeSpace(media?.searchTitle),
      ...releaseTitles,
      normalizeSpace(media?.title),
      ...alternativeTitles,
      normalizeSpace(media?.originalTitle),
      stripArrSuffix(pageTitle)
    ]);
  }

  function getSearchTitle(media) {
    return searchTitleCandidates(media)[0] || "";
  }

  function titleYearTerm(media) {
    const title = getDisplayTitle(media);
    const year = media?.year ? String(media.year) : "";
    return normalizeSpace(`${title} ${year}`);
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
      return normalizeSpace(
        `${normalizedTitle} S${padNumber(media.seasonNumber)}E${padNumber(media.episodeNumber)}`
      );
    }

    if (media?.seasonNumber) {
      return normalizeSpace(`${normalizedTitle} S${padNumber(media.seasonNumber)}`);
    }

    const year = media?.year ? String(media.year) : "";
    return normalizeSpace(`${normalizedTitle} ${year}`);
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

  // Jackett queries accept both free-text and `tt<digits>` IMDb IDs.
  // When an IMDb ID is known we search by it first because most indexers
  // honour IMDb search, then we fall back to title+year variants.
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
    const normalizedService = ["sonarr", "prowlarr", "jackett"].includes(service)
      ? service
      : "radarr";
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
        apiParams: {
          Query: query
        },
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

  // Jackett's dashboard uses a hash-based search fragment, not query params.
  function buildJackettSearchPageUrl(baseUrl, query) {
    const normalized = normalizeBaseUrl(baseUrl, baseUrl);

    if (!normalized) {
      return "";
    }

    const encoded = encodeURIComponent(normalizeSpace(query));
    return `${normalized}/UI/Dashboard#search=${encoded}`;
  }

  function buildDetailPageUrl(baseUrl, service, result) {
    if (!result?.titleSlug) {
      return null;
    }

    return buildUrl(baseUrl, service === "radarr" ? "/movie/" : "/series/") +
      encodeURIComponent(result.titleSlug);
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
    const normalized = normalizeBaseUrl(baseUrl, baseUrl);

    if (!normalized) {
      return false;
    }

    try {
      // URL.hostname keeps IPv6 literals bracketed, so `[::1]` must be unwrapped
      // before it can be compared with the loopback address.
      const host = new URL(normalized).hostname.toLowerCase().replace(/^\[|]$/g, "");

      return (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "::1" ||
        host === "0:0:0:0:0:0:0:1" ||
        /^127(?:\.\d{1,3}){3}$/.test(host)
      );
    } catch (_error) {
      return false;
    }
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

  // Jackett JSON results use capitalized field names; normalize to the common shape.
  function summarizeJackettRelease(result) {
    const leechers =
      typeof result?.Peers === "number" && typeof result?.Seeders === "number"
        ? Math.max(result.Peers - result.Seeders, 0)
        : "";

    return {
      title: result?.Title || "",
      indexer: result?.Tracker || result?.TrackerId || "",
      size: Number(result?.Size || 0),
      seeders: result?.Seeders ?? "",
      leechers,
      publishDate: result?.PublishDate || "",
      protocol: result?.MagnetUri || result?.InfoHash ? "torrent" : (result?.TrackerType || ""),
      infoUrl: result?.Details || result?.Guid || "",
      guid: result?.Guid || "",
      indexerId: result?.TrackerId || ""
    };
  }

  globalThis.AdbArrConfig = {
    DEFAULT_SETTINGS,
    SERVICE_LABELS,
    MAX_SEARCH_ATTEMPTS,
    REQUEST_TIMEOUT_MS,
    SEARCH_TIMEOUT_MS,
    stripArrSuffix,
    normalizeSpace,
    normalizeBaseUrl,
    hostPermissionPattern,
    safeHttpUrl,
    configuredServiceUrl,
    mergeSettings,
    cleanReleaseSearchTitle,
    uniqueSearchTitles,
    yearFromSignals,
    extractExternalIds,
    isBlockedPagePath,
    isLikelyDetailPage,
    detectSeasonEpisode,
    detectMediaType,
    getSearchTitle,
    titleYearTerm,
    prowlarrTerms,
    prowlarrTerm,
    jackettTerms,
    jackettTerm,
    buildSearchPlan,
    buildUrl,
    buildAddPageUrl,
    buildProwlarrSearchPageUrl,
    buildJackettSearchPageUrl,
    buildDetailPageUrl,
    serviceBaseUrl,
    serviceApiKey,
    isLocalhostUrl,
    summarizeResult,
    summarizeRelease,
    summarizeJackettRelease
  };
})();
