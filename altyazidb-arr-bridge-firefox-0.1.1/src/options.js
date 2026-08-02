(() => {
  const CFG = globalThis.AdbArrConfig;
  const extensionApi = globalThis.browser || globalThis.chrome;
  const storageApi = extensionApi.storage;
  const permissionsApi = extensionApi.permissions;
  const form = document.getElementById("optionsForm");
  const statusNode = document.getElementById("status");
  const API_KEY_SERVICES = ["radarr", "sonarr", "prowlarr", "jackett"];
  let currentSettings = CFG.mergeSettings(CFG.DEFAULT_SETTINGS);

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

  function sendMessage(message) {
    if (usingPromiseBrowserApi()) {
      return extensionApi.runtime.sendMessage(message);
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

  function setStatus(message, tone = "") {
    statusNode.textContent = message || "";
    statusNode.className = tone;
  }

  function field(id) {
    return document.getElementById(id);
  }

  function setValue(id, value) {
    const node = field(id);

    if (!node) {
      return;
    }

    if (node.type === "checkbox") {
      node.checked = value !== false;
      return;
    }

    node.value = value ?? "";
  }

  function getValue(id) {
    const node = field(id);

    if (!node) {
      return "";
    }

    if (node.type === "checkbox") {
      return node.checked;
    }

    return node.value.trim();
  }

  function capitalize(value) {
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  }

  function apiKeyValue(service) {
    const prefix = capitalize(service);
    const clearControl = field(`clear${prefix}ApiKey`);

    if (clearControl?.checked) {
      return "";
    }

    return getValue(`${service}ApiKey`) || currentSettings[`${service}ApiKey`] || "";
  }

  function clearApiKeyControls() {
    for (const service of API_KEY_SERVICES) {
      const prefix = capitalize(service);
      const keyInput = field(`${service}ApiKey`);
      const clearControl = field(`clear${prefix}ApiKey`);

      if (keyInput) {
        keyInput.value = "";
        keyInput.disabled = false;
      }

      if (clearControl) {
        clearControl.checked = false;
      }
    }
  }

  function syncApiKeyClearControl(clearControl) {
    const service = clearControl?.dataset?.service;
    const keyInput = service ? field(`${service}ApiKey`) : null;

    if (!keyInput) {
      return;
    }

    if (clearControl.checked) {
      keyInput.value = "";
    }

    keyInput.disabled = clearControl.checked;
  }

  function readForm() {
    return CFG.mergeSettings({
      radarrBaseUrl: getValue("radarrBaseUrl"),
      radarrApiKey: apiKeyValue("radarr"),
      sonarrBaseUrl: getValue("sonarrBaseUrl"),
      sonarrApiKey: apiKeyValue("sonarr"),
      prowlarrBaseUrl: getValue("prowlarrBaseUrl"),
      prowlarrApiKey: apiKeyValue("prowlarr"),
      showProwlarrButton: getValue("showProwlarrButton"),
      prowlarrLimit: getValue("prowlarrLimit"),
      jackettBaseUrl: getValue("jackettBaseUrl"),
      jackettApiKey: apiKeyValue("jackett"),
      jackettIndexer: getValue("jackettIndexer"),
      jackettLimit: getValue("jackettLimit"),
      showJackettButton: getValue("showJackettButton"),
      behavior: new FormData(form).get("behavior") || CFG.DEFAULT_SETTINGS.behavior,
      radarrRootFolderPath: getValue("radarrRootFolderPath"),
      radarrQualityProfileId: getValue("radarrQualityProfileId"),
      radarrMinimumAvailability: getValue("radarrMinimumAvailability"),
      sonarrRootFolderPath: getValue("sonarrRootFolderPath"),
      sonarrQualityProfileId: getValue("sonarrQualityProfileId"),
      sonarrSeriesType: getValue("sonarrSeriesType"),
      sonarrSeasonFolder: getValue("sonarrSeasonFolder")
    });
  }

  function writeForm(settings) {
    const merged = CFG.mergeSettings(settings);

    for (const [key, value] of Object.entries(merged)) {
      if (key.endsWith("ApiKey")) {
        continue;
      }

      if (key === "behavior") {
        const radio = document.querySelector(`input[name="behavior"][value="${value}"]`);

        if (radio) {
          radio.checked = true;
        }

        continue;
      }

      setValue(key, value);
    }

    clearApiKeyControls();
    syncAutoFields();
  }

  async function storeSettings(settings) {
    await storageSet(settings);
    currentSettings = CFG.mergeSettings(settings);
    clearApiKeyControls();
  }

  function syncAutoFields() {
    const behavior = new FormData(form).get("behavior") || CFG.DEFAULT_SETTINGS.behavior;
    const enabled = behavior === "autoAdd";

    for (const section of document.querySelectorAll("[data-auto-section]")) {
      section.setAttribute("aria-disabled", enabled ? "false" : "true");

      for (const control of section.querySelectorAll("input, select")) {
        control.disabled = !enabled;
      }
    }
  }

  function originPattern(baseUrl) {
    return CFG.hostPermissionPattern(baseUrl);
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

  function permissionRequest(origins) {
    if (!permissionsApi || !origins.length) {
      return Promise.resolve(true);
    }

    if (usingPromiseBrowserApi()) {
      return permissionsApi.request({ origins });
    }

    return new Promise((resolve) => {
      permissionsApi.request({ origins }, (granted) => resolve(Boolean(granted)));
    });
  }

  async function requestHostPermissions(settings) {
    const defaultOrigins = new Set([
      "http://localhost/*",
      "http://127.0.0.1/*"
    ]);
    const origins = [
      originPattern(settings.radarrBaseUrl),
      originPattern(settings.sonarrBaseUrl),
      originPattern(settings.prowlarrBaseUrl),
      originPattern(settings.jackettBaseUrl)
    ].filter((origin) => origin && !defaultOrigins.has(origin));

    if (!origins.length) {
      return true;
    }

    const hasPermission = await permissionContains(origins);

    if (hasPermission) {
      return true;
    }

    return permissionRequest(origins);
  }

  function fillChoices(service, response) {
    const rootList = field(`${service}RootFolders`);
    const profileSelect = field(`${service}QualityProfileId`);
    const currentProfile = profileSelect.value;

    rootList.innerHTML = "";
    profileSelect.innerHTML = "";

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Choose a profile";
    profileSelect.append(empty);

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

  async function loadChoices(service, button) {
    button.disabled = true;
    setStatus(`Loading ${service === "radarr" ? "Radarr" : "Sonarr"} choices...`);

    try {
      const settings = readForm();
      const granted = await requestHostPermissions(settings);

      if (!granted) {
        setStatus("Host permission was not granted. No connection request was sent.", "error");
        return;
      }

      await storeSettings(settings);
      const response = await sendMessage({
        type: "ADB_LOAD_CHOICES",
        service
      });

      if (!response.ok) {
        setStatus(response.error || "Choices could not be loaded", "error");
        return;
      }

      fillChoices(service, response);
      setStatus("Folders and profiles loaded.", "success");
    } catch (error) {
      setStatus(error.message || "Choices could not be loaded", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function testConnection(service, button) {
    button.disabled = true;
    const label =
      CFG.SERVICE_LABELS[service] ||
      (service === "radarr" ? "Radarr" : service === "sonarr" ? "Sonarr" : service);
    setStatus(`Testing ${label}...`);

    try {
      const settings = readForm();
      const granted = await requestHostPermissions(settings);

      if (!granted) {
        setStatus(`${label} host permission was not granted. No connection request was sent.`, "error");
        return;
      }

      await storeSettings(settings);
      const response = await sendMessage({
        type: "ADB_TEST_CONNECTION",
        service
      });

      setStatus(
        response.ok ? response.message : response.error,
        response.ok ? "success" : "error"
      );
    } catch (error) {
      setStatus(error.message || "Connection test failed", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function load() {
    currentSettings = CFG.mergeSettings(await storageGet(CFG.DEFAULT_SETTINGS));
    writeForm(currentSettings);
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "behavior") {
      syncAutoFields();
    }

    if (event.target.matches("[data-clear-api-key]")) {
      syncApiKeyClearControl(event.target);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = form.querySelector('button[type="submit"]');
    const settings = readForm();

    submitter.disabled = true;
    setStatus("Saving settings...");

    try {
      const granted = await requestHostPermissions(settings);

      await storeSettings(settings);
      writeForm(settings);

      setStatus(
        granted
          ? "Settings saved."
          : "Settings saved, but custom host permission was not granted.",
        granted ? "success" : "warn"
      );
    } catch (error) {
      setStatus(error.message || "Settings could not be saved", "error");
    } finally {
      submitter.disabled = false;
    }
  });

  field("testRadarr").addEventListener("click", (event) => testConnection("radarr", event.currentTarget));
  field("testSonarr").addEventListener("click", (event) => testConnection("sonarr", event.currentTarget));
  field("testProwlarr").addEventListener("click", (event) => testConnection("prowlarr", event.currentTarget));
  field("testJackett")?.addEventListener("click", (event) => testConnection("jackett", event.currentTarget));
  field("loadRadarrChoices").addEventListener("click", (event) => loadChoices("radarr", event.currentTarget));
  field("loadSonarrChoices").addEventListener("click", (event) => loadChoices("sonarr", event.currentTarget));

  load().catch((error) => {
    setStatus(error.message || "Options could not be loaded", "error");
  });
})();
