if (typeof importScripts === "function" && !globalThis.AdbArrConfig) {
  importScripts("config.js");
}

const CFG = globalThis.AdbArrConfig;
const runtimeApi = globalThis.browser?.runtime || globalThis.chrome?.runtime;
const storageApi = globalThis.browser?.storage || globalThis.chrome?.storage;
const tabsApi = globalThis.browser?.tabs || globalThis.chrome?.tabs;
const permissionsApi = globalThis.browser?.permissions || globalThis.chrome?.permissions;
const VALID_SERVICES = new Set(["radarr", "sonarr", "prowlarr", "jackett"]);

class ArrBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArrBridgeError";
    this.code = code;
  }
}

function usingPromiseBrowserApi() {
  return typeof globalThis.browser !== "undefined" && !!globalThis.browser.runtime;
}

function storageGet(defaults = CFG.DEFAULT_SETTINGS) {
  if (usingPromiseBrowserApi()) {
    return storageApi.local.get(defaults);
  }

  return new Promise((resolve) => {
    storageApi.local.get(defaults, resolve);
  });
}

function storageSet(values) {
  if (usingPromiseBrowserApi()) {
    return storageApi.local.set(values);
  }

  return new Promise((resolve) => {
    storageApi.local.set(values, resolve);
  });
}

async function getSettings() {
  return CFG.mergeSettings(await storageGet(CFG.DEFAULT_SETTINGS));
}

function createTab(url) {
  const safeUrl = CFG.safeHttpUrl(url);

  if (!safeUrl) {
    return Promise.reject(new ArrBridgeError("invalidUrl", "Refused to open an unsafe URL"));
  }

  if (usingPromiseBrowserApi()) {
    return tabsApi.create({ url: safeUrl });
  }

  return new Promise((resolve) => {
    tabsApi.create({ url: safeUrl }, resolve);
  });
}

async function ensureDefaultSettings() {
  const settings = await getSettings();
  await storageSet(settings);
}

function serviceLabel(service) {
  return CFG.SERVICE_LABELS[service] || "Arr";
}

function connectionErrorMessage(service, baseUrl) {
  const label = serviceLabel(service);
  return CFG.isLocalhostUrl(baseUrl)
    ? `Could not connect to localhost ${label}. Check that the service is running and the URL and port are correct.`
    : `Could not connect to ${label}. Check the URL, network, TLS certificate, and extension host permission.`;
}

function permissionContains(origins) {
  if (!permissionsApi || !origins.length) {
    return Promise.resolve(true);
  }

  if (usingPromiseBrowserApi()) {
    return permissionsApi.contains({ origins });
  }

  return new Promise((resolve) => {
    permissionsApi.contains({ origins }, (allowed) => resolve(Boolean(allowed)));
  });
}

function fetchFailureMessage(service, baseUrl, err) {
  const label = serviceLabel(service);
  const name = String(err?.name || "");
  const message = String(err?.message || "");

  if (name === "AbortError" || /timed?\s*out|timeout/i.test(message)) {
    return `${label} request timed out. Check the service load and network path.`;
  }

  if (/certificate|cert_authority|ssl|tls|secure connection/i.test(message)) {
    return `${label} TLS/certificate validation failed. Fix or trust the certificate, then retry.`;
  }

  if (/invalid url|failed to construct|url is malformed/i.test(message)) {
    return `${label} URL is invalid. Check the configured protocol, host, and port.`;
  }

  if (/redirect/i.test(message)) {
    return `${label} redirect was refused. Redirects are not followed; configure the final service URL directly.`;
  }

  return `${connectionErrorMessage(service, baseUrl)} Redirects are not followed; configure the final service URL directly if this address redirects.`;
}

function statusPath(service) {
  if (service === "prowlarr") {
    return { path: "/api/v1/system/status", params: {} };
  }

  if (service === "jackett") {
    return {
      path: "/api/v2.0/indexers/all/results/torznab/api",
      params: { t: "caps" }
    };
  }

  return { path: "/api/v3/system/status", params: {} };
}

function fallbackUrlForService(service, settings, searchPlan) {
  try {
    const baseUrl = CFG.serviceBaseUrl(settings, service);
    const term = searchPlan.fallbackTerm || searchPlan.term;

    if (service === "prowlarr") {
      return CFG.buildProwlarrSearchPageUrl(baseUrl, term, settings.prowlarrLimit);
    }

    if (service === "jackett") {
      return CFG.buildJackettSearchPageUrl(baseUrl, term);
    }

    return CFG.buildAddPageUrl(baseUrl, term);
  } catch (_error) {
    return "";
  }
}

function redactSensitive(value, apiKey = "") {
  let redacted = String(value || "");

  if (apiKey) {
    for (const secret of [apiKey, encodeURIComponent(apiKey)]) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }

  return redacted.replace(/(apikey\s*[=:]\s*)[^&\s<>'"]+/gi, "$1[REDACTED]");
}

async function fetchWithTimeout(url, options, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      redirect: "error",
      signal: controller.signal
    });
    const text = response.status === 204 ? "" : await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function callArrApi(service, settings, path, params = {}, options = {}) {
  const label = serviceLabel(service);
  const baseUrl = CFG.serviceBaseUrl(settings, service);
  const apiKey = CFG.serviceApiKey(settings, service);
  const requireKey = options.requireKey !== false;

  if (requireKey && !apiKey) {
    throw new ArrBridgeError("missingKey", `${label} API key missing`);
  }

  const hostPattern = CFG.hostPermissionPattern(baseUrl);

  if (!hostPattern) {
    throw new ArrBridgeError(
      "invalidUrl",
      `${label} URL is invalid. Check the configured protocol, host, and port.`
    );
  }

  if (!(await permissionContains([hostPattern]))) {
    throw new ArrBridgeError(
      "permission",
      `${label} host permission is missing for ${hostPattern}. Open the extension settings and grant access before retrying.`
    );
  }

  // Jackett authenticates via ?apikey= query parameter rather than X-Api-Key header.
  const requestParams = service === "jackett" && apiKey
    ? { ...params, apikey: apiKey }
    : params;

  const url = CFG.buildUrl(baseUrl, path, requestParams);
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {})
  };

  if (apiKey && service !== "jackett") {
    headers["X-Api-Key"] = apiKey;
  }

  let response;
  let text;

  try {
    ({ response, text } = await fetchWithTimeout(url, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }));
  } catch (error) {
    throw new ArrBridgeError("connect", fetchFailureMessage(service, baseUrl, error));
  }

  if (response.url) {
    try {
      if (new URL(response.url).origin !== new URL(url).origin) {
        throw new ArrBridgeError("redirect", `${label} redirected to a different origin`);
      }
    } catch (error) {
      if (error instanceof ArrBridgeError) {
        throw error;
      }
    }
  }

  if (response.status === 401 || response.status === 403) {
    throw new ArrBridgeError("auth", `${label} API key rejected`);
  }

  if (!response.ok) {
    const detail = redactSensitive(text, apiKey).slice(0, 180);

    throw new ArrBridgeError(
      "api",
      `${label} API request failed (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`
    );
  }

  if (response.status === 204) {
    return null;
  }

  if (!text) {
    if (options.responseType === "text") {
      return "";
    }

    throw new ArrBridgeError("invalidResponse", `${label} returned invalid JSON`);
  }

  if (options.responseType === "text") {
    return text;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new ArrBridgeError("invalidResponse", `${label} returned invalid JSON`);
  }
}

function normalizeResults(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  return [data];
}

function chooseBestResult(service, media, results) {
  if (!results.length) {
    return null;
  }

  const imdbId = String(media?.imdbId || "").toLowerCase();
  const tmdbId = Number(media?.tmdbId || 0);
  const tvdbId = Number(media?.tvdbId || 0);
  const title = CFG.normalizeSpace(media?.originalTitle || media?.title).toLowerCase();

  const byId = results.find((result) => {
    if (service === "radarr" && tmdbId && Number(result.tmdbId) === tmdbId) {
      return true;
    }

    if (service === "sonarr" && tvdbId && Number(result.tvdbId) === tvdbId) {
      return true;
    }

    if (imdbId && String(result.imdbId || "").toLowerCase() === imdbId) {
      return true;
    }

    return false;
  });

  if (byId) {
    return byId;
  }

  const byTitle = results.find((result) => {
    const resultTitle = CFG.normalizeSpace(result.title || result.originalTitle).toLowerCase();
    return title && resultTitle === title;
  });

  return byTitle || results[0];
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

  const title = CFG.normalizeSpace(result?.title || result?.originalTitle);
  const year = result?.year ? String(result.year) : "";
  const resultTerm = CFG.normalizeSpace(`${title} ${year}`);
  return resultTerm || fallbackTerm;
}

async function findExisting(service, settings, result) {
  if (service === "radarr" && result?.tmdbId) {
    const data = await callArrApi(
      service,
      settings,
      "/api/v3/movie",
      { tmdbId: result.tmdbId },
      { requireKey: true }
    );
    return normalizeResults(data)[0] || null;
  }

  if (service === "sonarr" && result?.tvdbId) {
    const data = await callArrApi(
      service,
      settings,
      "/api/v3/series",
      { tvdbId: result.tvdbId },
      { requireKey: true }
    );
    return normalizeResults(data)[0] || null;
  }

  return null;
}

function existingIdentity(service, result) {
  if (service === "radarr" && result?.tmdbId) {
    return `tmdb:${Number(result.tmdbId)}`;
  }

  if (service === "sonarr" && result?.tvdbId) {
    return `tvdb:${Number(result.tvdbId)}`;
  }

  return "";
}

async function lookupArr(service, media, settings) {
  const searchPlan = CFG.buildSearchPlan(service, media);
  const baseUrl = CFG.serviceBaseUrl(settings, service);
  const fallbackUrl = fallbackUrlForService(service, settings, searchPlan);

  if (!CFG.serviceApiKey(settings, service)) {
    if (fallbackUrl) {
      await createTab(fallbackUrl);
    }

    return {
      ok: false,
      service,
      error: `${serviceLabel(service)} API key missing`,
      fallbackUrl,
      opened: Boolean(fallbackUrl),
      message: fallbackUrl
        ? `${serviceLabel(service)} API key missing. Opened browser search fallback.`
        : `${serviceLabel(service)} API key missing and the configured URL is invalid.`
    };
  }

  const canCheckExisting =
    (service === "radarr" && media?.tmdbId && media?.tmdbType !== "tv") ||
    (service === "sonarr" && media?.tvdbId);

  let checkedExistingIdentity = "";

  if (settings.behavior !== "showPopupResults" && canCheckExisting) {
    const existing = await findExisting(service, settings, media);
    checkedExistingIdentity = existingIdentity(service, media);
    const existingUrl = CFG.buildDetailPageUrl(baseUrl, service, existing);

    if (existingUrl) {
      await createTab(existingUrl);
      return {
        ok: true,
        service,
        opened: true,
        openedUrl: existingUrl,
        message: `Opened existing ${serviceLabel(service)} item.`
      };
    }
  }

  const data = await callArrApi(
    service,
    settings,
    searchPlan.apiPath,
    searchPlan.apiParams
  );
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
      results: results.slice(0, 5).map(CFG.summarizeResult)
    };
  }

  if (settings.behavior === "autoAdd") {
    return addResult(
      service,
      media,
      best,
      settings,
      fallbackUrl,
      checkedExistingIdentity
    );
  }

  const existing = checkedExistingIdentity === existingIdentity(service, best)
    ? null
    : await findExisting(service, settings, best);
  const existingUrl = CFG.buildDetailPageUrl(baseUrl, service, existing);

  if (existingUrl) {
    await createTab(existingUrl);
    return {
      ok: true,
      service,
      opened: true,
      openedUrl: existingUrl,
      message: `Opened existing ${serviceLabel(service)} item.`
    };
  }

  const addUrl = CFG.buildAddPageUrl(
    baseUrl,
    resultSearchTerm(service, best, searchPlan.fallbackTerm || searchPlan.term)
  );

  await createTab(addUrl);

  return {
    ok: true,
    service,
    opened: true,
    openedUrl: addUrl,
    message: `Opened ${serviceLabel(service)} add search.`
  };
}

async function lookupProwlarr(media, settings) {
  const searchPlan = CFG.buildSearchPlan("prowlarr", media);
  searchPlan.apiParams.limit = settings.prowlarrLimit;
  const searchPlans = CFG.prowlarrTerms(media).map((query) => ({
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

  if (!CFG.serviceApiKey(settings, "prowlarr")) {
    if (fallbackUrl) {
      await createTab(fallbackUrl);
    }

    return {
      ok: false,
      service: "prowlarr",
      error: "Prowlarr API key missing",
      fallbackUrl,
      opened: Boolean(fallbackUrl),
      message: fallbackUrl
        ? "Prowlarr API key missing. Opened browser search fallback."
        : "Prowlarr API key missing and the configured URL is invalid."
    };
  }

  let activePlan = plans[0];
  let releases = [];

  for (const plan of plans) {
    const data = await callArrApi(
      "prowlarr",
      settings,
      plan.apiPath,
      plan.apiParams
    );
    if (!Array.isArray(data)) {
      throw new ArrBridgeError("invalidResponse", "Prowlarr returned an invalid response");
    }

    releases = data;
    activePlan = plan;

    if (releases.length) {
      break;
    }
  }

  const activeFallbackUrl = fallbackUrlForService("prowlarr", settings, activePlan);

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
      fallbackUrl: activeFallbackUrl,
      results: releases.slice(0, 8).map((result) => ({
        ...CFG.summarizeRelease(result),
        searchTerm: activePlan.term
      }))
    };
  }

  await createTab(activeFallbackUrl);

  return {
    ok: true,
    service: "prowlarr",
    opened: true,
    openedUrl: activeFallbackUrl,
    message: "Opened Prowlarr search."
  };
}

async function lookupJackett(media, settings) {
  const searchPlan = CFG.buildSearchPlan("jackett", media);
  const searchPlans = CFG.jackettTerms(media).map((query) => ({
    ...searchPlan,
    term: query,
    fallbackTerm: query,
    apiParams: {
      ...searchPlan.apiParams,
      Query: query
    }
  }));
  const plans = searchPlans.length ? searchPlans : [searchPlan];
  const fallbackUrl = fallbackUrlForService("jackett", settings, plans[0]);

  if (!CFG.serviceApiKey(settings, "jackett")) {
    if (fallbackUrl) {
      await createTab(fallbackUrl);
    }

    return {
      ok: false,
      service: "jackett",
      error: "Jackett API key missing",
      fallbackUrl,
      opened: Boolean(fallbackUrl),
      message: fallbackUrl
        ? "Jackett API key missing. Opened Jackett search fallback."
        : "Jackett API key missing and the configured URL is invalid."
    };
  }

  // Switch indexer segment if user pinned a single indexer in settings.
  const indexer = settings.jackettIndexer && settings.jackettIndexer !== "all"
    ? String(settings.jackettIndexer)
    : "all";
  const apiPath = `/api/v2.0/indexers/${encodeURIComponent(indexer)}/results`;

  let activePlan = plans[0];
  let releases = [];

  for (const plan of plans) {
    const data = await callArrApi(
      "jackett",
      settings,
      apiPath,
      plan.apiParams
    );

    if (!data || !Array.isArray(data.Results)) {
      throw new ArrBridgeError("invalidResponse", "Jackett returned an invalid response");
    }

    releases = data.Results;
    activePlan = plan;

    if (releases.length) {
      break;
    }
  }

  const activeFallbackUrl = fallbackUrlForService("jackett", settings, activePlan);

  if (!releases.length) {
    return {
      ok: false,
      service: "jackett",
      error: "No result found",
      fallbackUrl,
      searchTerm: plans.map((plan) => plan.term).join(" / ")
    };
  }

  // Sort by seeders descending to surface healthy torrents first.
  releases.sort((a, b) => Number(b?.Seeders || 0) - Number(a?.Seeders || 0));

  if (settings.behavior === "showPopupResults") {
    return {
      ok: true,
      service: "jackett",
      mode: "showPopupResults",
      searchTerm: activePlan.term,
      fallbackUrl: activeFallbackUrl,
      results: releases.slice(0, settings.jackettLimit).map((result) => ({
        ...CFG.summarizeJackettRelease(result),
        searchTerm: activePlan.term
      }))
    };
  }

  await createTab(activeFallbackUrl);

  return {
    ok: true,
    service: "jackett",
    opened: true,
    openedUrl: activeFallbackUrl,
    message: "Opened Jackett search."
  };
}

async function addResult(
  service,
  media,
  result,
  settings,
  fallbackUrl,
  checkedExistingIdentity = ""
) {
  const label = serviceLabel(service);

  if (service === "radarr") {
    if (!settings.radarrRootFolderPath || !settings.radarrQualityProfileId) {
      return {
        ok: false,
        service,
        error: "Radarr auto-add requires a root folder and quality profile",
        fallbackUrl
      };
    }

  } else if (!settings.sonarrRootFolderPath || !settings.sonarrQualityProfileId) {
    return {
      ok: false,
      service,
      error: "Sonarr auto-add requires a root folder and quality profile",
      fallbackUrl
    };
  }

  const existing = checkedExistingIdentity === existingIdentity(service, result)
    ? null
    : await findExisting(service, settings, result);
  const existingUrl = CFG.buildDetailPageUrl(CFG.serviceBaseUrl(settings, service), service, existing);

  if (existingUrl) {
    await createTab(existingUrl);
    return {
      ok: true,
      service,
      opened: true,
      openedUrl: existingUrl,
      message: `${label} already has this item. Opened the existing page.`
    };
  }

  if (service === "radarr") {
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
    const detailUrl = CFG.buildDetailPageUrl(CFG.serviceBaseUrl(settings, service), service, added);

    if (detailUrl) {
      await createTab(detailUrl);
    }

    return {
      ok: true,
      service,
      opened: !!detailUrl,
      openedUrl: detailUrl,
      message: "Added movie to Radarr without starting a search."
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
  const detailUrl = CFG.buildDetailPageUrl(CFG.serviceBaseUrl(settings, service), service, added);

  if (detailUrl) {
    await createTab(detailUrl);
  }

  return {
    ok: true,
    service,
    opened: !!detailUrl,
    openedUrl: detailUrl,
    message: "Added series to Sonarr without starting a search."
  };
}

async function openResult(message) {
  const settings = await getSettings();
  const service = message.service;
  const result = message.result || {};
  const media = message.media || {};
  const searchPlan = CFG.buildSearchPlan(service, media);

  if (service === "prowlarr" || service === "jackett") {
    const infoUrl = CFG.safeHttpUrl(result.infoUrl);

    if (infoUrl) {
      await createTab(infoUrl);
      return { ok: true, openedUrl: infoUrl };
    }

    const term = CFG.normalizeSpace(
      result.searchTerm ||
      message.searchTerm ||
      result.title ||
      searchPlan.fallbackTerm ||
      searchPlan.term
    );
    const url = service === "prowlarr"
      ? CFG.buildProwlarrSearchPageUrl(
        CFG.serviceBaseUrl(settings, service),
        term,
        settings.prowlarrLimit
      )
      : CFG.buildJackettSearchPageUrl(
        CFG.serviceBaseUrl(settings, service),
        term
      );
    await createTab(url);
    return { ok: true, openedUrl: url };
  }

  const existing = CFG.serviceApiKey(settings, service)
    ? await findExisting(service, settings, result)
    : null;
  const detailUrl = CFG.buildDetailPageUrl(CFG.serviceBaseUrl(settings, service), service, existing);

  if (detailUrl) {
    await createTab(detailUrl);
    return { ok: true, openedUrl: detailUrl };
  }

  const addUrl = CFG.buildAddPageUrl(
    CFG.serviceBaseUrl(settings, service),
    resultSearchTerm(service, result, searchPlan.fallbackTerm || searchPlan.term)
  );

  await createTab(addUrl);
  return { ok: true, openedUrl: addUrl };
}

async function testConnection(service) {
  const settings = await getSettings();

  try {
    const { path, params } = statusPath(service);
    await callArrApi(service, settings, path, params, {
      responseType: service === "jackett" ? "text" : "json"
    });
    return {
      ok: true,
      service,
      message: `${serviceLabel(service)} connection OK`
    };
  } catch (error) {
    return {
      ok: false,
      service,
      error: error.message || connectionErrorMessage(service, CFG.serviceBaseUrl(settings, service))
    };
  }
}

async function loadChoices(service) {
  const settings = await getSettings();

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

async function handleMessage(message, sender) {
  if (!sender || sender.id !== runtimeApi?.id) {
    return {
      ok: false,
      error: "Rejected extension message sender"
    };
  }

  const type = message?.type;

  if (type === "ADB_LOOKUP") {
    const service = message.service;

    if (!VALID_SERVICES.has(service)) {
      return {
        ok: false,
        error: "Invalid service"
      };
    }

    const settings = await getSettings();

    try {
      if (service === "prowlarr") {
        return await lookupProwlarr(message.media || {}, settings);
      }

      if (service === "jackett") {
        return await lookupJackett(message.media || {}, settings);
      }

      return await lookupArr(service, message.media || {}, settings);
    } catch (error) {
      const searchPlan = CFG.buildSearchPlan(service, message.media || {});

      return {
        ok: false,
        service,
        error: error.message || connectionErrorMessage(service, CFG.serviceBaseUrl(settings, service)),
        fallbackUrl: fallbackUrlForService(service, settings, searchPlan)
      };
    }
  }

  if (type === "ADB_OPEN_RESULT") {
    if (!VALID_SERVICES.has(message.service)) {
      return { ok: false, error: "Invalid service" };
    }

    return openResult(message);
  }

  if (type === "ADB_OPEN_URL" && message.url) {
    if (!VALID_SERVICES.has(message.service)) {
      return { ok: false, error: "Invalid service" };
    }

    const settings = await getSettings();
    const safeUrl = CFG.configuredServiceUrl(settings, message.service, message.url);

    if (!safeUrl) {
      return { ok: false, error: "Refused to open an untrusted URL" };
    }

    await createTab(safeUrl);
    return { ok: true, openedUrl: safeUrl };
  }

  if (type === "ADB_TEST_CONNECTION") {
    if (!VALID_SERVICES.has(message.service)) {
      return { ok: false, error: "Invalid service" };
    }

    return testConnection(message.service);
  }

  if (type === "ADB_LOAD_CHOICES") {
    if (!["radarr", "sonarr"].includes(message.service)) {
      return { ok: false, error: "Invalid service" };
    }

    return loadChoices(message.service);
  }

  return {
    ok: false,
    error: "Unknown extension message"
  };
}

if (runtimeApi?.onInstalled) {
  runtimeApi.onInstalled.addListener(() => {
    ensureDefaultSettings().catch(() => {});
  });
}

if (usingPromiseBrowserApi()) {
  runtimeApi.onMessage.addListener((message, sender) => handleMessage(message, sender));
} else {
  runtimeApi.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.message || "Unexpected extension error"
        });
      });

    return true;
  });
}
