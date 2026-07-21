# AltyaziDB Arr Bridge Optimization Audit

### 1) Optimization Summary

- Current optimization health: runtime/network quick wins and mirror-drift guards are implemented; the main remaining cost is duplicated extension/Tampermonkey logic.
- Implementation status (Unreleased): full-page `innerText`/`innerHTML` parsing, normal-search status preflights, duplicate strong-ID existing checks, unclamped limits, and incomplete Chrome/Firefox mirror verification are resolved. Chrome remains canonical and every non-manifest file is mirrored and byte-checked.
- Top 3 highest-impact improvements:
  1. Consolidate shared parser/search/API logic so the extension and Tampermonkey script do not drift.
  2. Generate the Tampermonkey userscript from reviewed shared modules.
  3. Replace expanded browser source copies with generated build output in a future major packaging change.
- Biggest risk if no changes are made: optimization and bug fixes will need to be applied in multiple places, while every keyed lookup keeps paying unnecessary localhost API latency.

### 2) Findings (Prioritized)

#### Finding 1: Shared logic is duplicated across extension and Tampermonkey builds

- **Title**: Shared logic is duplicated across extension and Tampermonkey builds
- **Category**: Build / Maintainability / Cost
- **Severity**: High
- **Impact**: Reduces bundle size, review surface, bug drift, and future optimization cost.
- **Evidence**: `altyazidb-arr-bridge-chrome-0.1.0/src/config.js:131` defines `buildSearchPlan`, while `tampermonkey/altyazidb-arr-bridge.user.js:233` duplicates it. `src/content.js:337` defines `extractMedia`, duplicated at `tampermonkey/altyazidb-arr-bridge.user.js:1153`. `src/background.js:260` defines `lookupArr`, duplicated at `tampermonkey/altyazidb-arr-bridge.user.js:551`. The Tampermonkey script is 1,810 lines / 61,633 characters, largely combining extension config, parser, API, UI, and settings code.
- **Why it’s inefficient**: Any parser, API, security, or performance fix must be implemented and tested multiple times. This increases maintenance cost and makes optimization regressions likely.
- **Recommended fix**: Extract a shared core for config normalization, media extraction, search planning, API result normalization, and common UI helpers. Generate the Tampermonkey script and Chrome/Firefox packages from that core. Keep Chrome as the canonical extension target and generate Firefox manifest differences.
- **Tradeoffs / Risks**: Adds a small packaging/generation step. Tampermonkey still needs a final bundled userscript artifact.
- **Expected impact estimate**: High. Likely 40-60% less maintained JS surface for equivalent behavior and much lower drift risk.
- **Removal Safety**: Needs Verification
- **Reuse Scope**: service-wide

#### Finding 2: Media detection repeatedly scans full page text and HTML

- **Status**: Resolved in Unreleased. Extraction now uses scoped detail DOM, media JSON-LD, metadata, URL, and trusted external links; subtitle/comment/body/HTML fallbacks were removed.

- **Title**: Media detection repeatedly scans full page text and HTML
- **Category**: Frontend / CPU / Memory
- **Severity**: Medium
- **Impact**: Improves page-injection latency and reduces layout/serialization work on large AltyaziDB pages.
- **Evidence**: `src/content.js:145-150` exposes `allPageText()` via `document.body?.innerText` and `pageHtml()` via `document.documentElement.innerHTML`. These are called from `findYear` at `src/content.js:176`, `extractIdsFromLinks` at `src/content.js:188-189`, and `detectSeasonEpisode` at `src/content.js:241-242`. The same pattern appears in Tampermonkey at `tampermonkey/altyazidb-arr-bridge.user.js:963-968`, `994`, `1006-1007`, and `1059-1060`.
- **Why it’s inefficient**: `innerText` can force style/layout calculation, while `innerHTML` serializes the entire document. The parser does this multiple times during a single render even though the page content is effectively static for the extraction pass.
- **Recommended fix**: Build a single page snapshot inside `extractMedia`: normalized visible text, raw HTML, anchors, JSON-LD nodes, metadata, and path. Pass that snapshot to `findYear`, `extractIdsFromLinks`, `detectSeasonEpisode`, and `detectType`.
- **Tradeoffs / Risks**: If AltyaziDB mutates the page after load, the snapshot may become stale. Current script runs once at `document_idle`, so this is likely acceptable.
- **Expected impact estimate**: Medium. Likely 30-70% less parser CPU and memory allocation on media pages with many comments/subtitle rows.
- **Removal Safety**: Likely Safe
- **Reuse Scope**: module

#### Finding 3: Normal keyed searches perform an avoidable `/system/status` preflight

- **Status**: Resolved. Status/caps calls are used only by explicit connection tests.

- **Title**: Normal keyed searches perform an avoidable `/system/status` preflight
- **Category**: Network / Reliability / Cost
- **Severity**: High
- **Impact**: Reduces click-to-open latency and localhost API traffic.
- **Evidence**: `lookupArr` calls `await callArrApi(service, settings, statusPath(service))` before lookup at `src/background.js:277`; `lookupProwlarr` does the same at `src/background.js:361`. Tampermonkey duplicates the same preflight at `tampermonkey/altyazidb-arr-bridge.user.js:568` and `645`.
- **Why it’s inefficient**: The actual lookup request already proves connectivity, auth, and service availability. The status preflight adds one full request to every successful click.
- **Recommended fix**: Remove status preflight from normal lookup paths. Keep `/system/status` only for explicit Test Connection actions. Preserve error messages by mapping lookup fetch failures to `Could not connect to localhost Radarr/Sonarr/Prowlarr`.
- **Tradeoffs / Risks**: Error classification may be slightly less specific if lookup endpoint fails while status would have succeeded. This is acceptable for user-triggered searches.
- **Expected impact estimate**: High for keyed usage. Removes one request per keyed Radarr/Sonarr/Prowlarr click, often cutting local API latency by 25-50%.
- **Removal Safety**: Likely Safe
- **Reuse Scope**: service-wide

#### Finding 4: Existing-item checks happen after remote lookup, wasting work for already-added media

- **Status**: Resolved. Strong IDs are checked first and the checked identity prevents a second request for the same endpoint/ID.

- **Title**: Existing-item checks happen after remote lookup, wasting work for already-added media
- **Category**: Network / Latency
- **Severity**: Medium
- **Impact**: Improves latency when the movie/series already exists locally.
- **Evidence**: `lookupArr` performs lookup first, then calls `findExisting` at `src/background.js:313`. Tampermonkey mirrors this at `tampermonkey/altyazidb-arr-bridge.user.js:599`. `findExisting` can use `tmdbId` / `tvdbId` directly at `src/background.js:230-251` and `tampermonkey/altyazidb-arr-bridge.user.js:504-513`.
- **Why it’s inefficient**: If the current AltyaziDB page already has a TMDb/TVDb ID and the item is already in Radarr/Sonarr, the script still performs an external Arr lookup before opening the existing item.
- **Recommended fix**: When strong IDs are available, check local existing items first or start `findExisting` in parallel with lookup. If existing is found, open it and skip lookup result handling.
- **Tradeoffs / Risks**: Parallelizing can increase request count when the item is not present. Prefer short-circuit-first for high-confidence IDs, or parallel only when measured latency justifies it.
- **Expected impact estimate**: Medium to high for libraries with many existing items. Saves one lookup request and one result-selection pass on existing media.
- **Removal Safety**: Needs Verification
- **Reuse Scope**: service-wide

#### Finding 5: Prowlarr result limit is not clamped outside the UI

- **Status**: Resolved. Stored Prowlarr and Jackett limits normalize to integer `1..100` values.

- **Title**: Prowlarr result limit is not clamped outside the UI
- **Category**: Network / Memory / Reliability
- **Severity**: Medium
- **Impact**: Prevents oversized API responses, popup rendering pressure, and accidental load on Prowlarr/indexers.
- **Evidence**: `mergeSettings` assigns `merged.prowlarrLimit = Number(merged.prowlarrLimit) || DEFAULT_SETTINGS.prowlarrLimit` at `src/config.js:86`. Tampermonkey does the same at `tampermonkey/altyazidb-arr-bridge.user.js:150`. The Tampermonkey UI input has `min="1" max="100"` at `tampermonkey/altyazidb-arr-bridge.user.js:2029`, but stored values can bypass that and are used in API params at `tampermonkey/altyazidb-arr-bridge.user.js:630`.
- **Why it’s inefficient**: A bad stored value can request excessive results. Popup output is sliced, but the network/API work has already happened.
- **Recommended fix**: Clamp at settings normalization: integer only, minimum 1, maximum 100. Use the same clamp in extension and Tampermonkey shared config.
- **Tradeoffs / Risks**: Users wanting more than 100 Prowlarr results would need a deliberate code/config change.
- **Expected impact estimate**: Medium as a reliability guard; low impact under default settings.
- **Removal Safety**: Safe
- **Reuse Scope**: module

#### Finding 6: Broad host permissions increase abuse blast radius

- **Title**: Broad host permissions increase abuse blast radius
- **Category**: Security / Reliability / Cost
- **Severity**: Medium
- **Impact**: Reduces security-impacting inefficiency and accidental network reach.
- **Evidence**: Chrome and Firefox manifests declare broad optional host permissions at `altyazidb-arr-bridge-chrome-0.1.0/manifest.json:34-36` and `altyazidb-arr-bridge-firefox-0.1.0/manifest.json:34-36`. Tampermonkey grants `@connect *` at `tampermonkey/altyazidb-arr-bridge.user.js:15`.
- **Why it’s inefficient**: Broad network capability means a future bug or injection flaw can amplify requests to arbitrary origins. It also makes permission prompts less precise.
- **Recommended fix**: Keep default permissions limited to localhost/127.0.0.1. For custom Arr hosts, document that users should add explicit host entries, or provide separate local-only and custom-host script variants. For extension builds, keep optional host requests origin-specific and avoid broad defaults unless browser packaging requires them.
- **Tradeoffs / Risks**: Users with non-localhost Arr instances may need one manual metadata/manifest edit or a custom build.
- **Expected impact estimate**: Medium security-risk reduction; no direct latency win.
- **Removal Safety**: Needs Verification
- **Reuse Scope**: service-wide

#### Finding 7: Expanded Chrome and Firefox package directories duplicate source files

- **Status**: Partially mitigated. Chrome is canonical; the mirror and package verifier cover every non-manifest file. A generated single-core build remains a future architectural change.

- **Title**: Expanded Chrome and Firefox package directories duplicate source files
- **Category**: Build / Maintainability
- **Severity**: Medium
- **Impact**: Reduces repository size, package drift, and review noise.
- **Evidence**: `altyazidb-arr-bridge-chrome-0.1.0` and `altyazidb-arr-bridge-firefox-0.1.0` contain duplicate copies of `src/background.js`, `src/config.js`, `src/content.js`, `src/options.js`, styles, assets, docs, and HTML. The main difference is manifest background shape: Chrome uses `background.service_worker`; Firefox uses `background.scripts`.
- **Why it’s inefficient**: Keeping expanded build artifacts as source-like directories makes it easy to edit the wrong copy and difficult to know which code is canonical.
- **Recommended fix**: Store one canonical source tree plus a packaging script that emits `dist/chrome`, `dist/firefox`, and zips. Commit release artifacts only when intentionally publishing a release.
- **Tradeoffs / Risks**: Requires a repeatable packaging script and a clear release workflow.
- **Expected impact estimate**: Medium. Cuts duplicated checked-in app files by roughly one browser-package copy and reduces future merge/review overhead.
- **Removal Safety**: Needs Verification
- **Reuse Scope**: service-wide

#### Finding 8: Tampermonkey settings panel is built from one large HTML string

- **Title**: Tampermonkey settings panel is built from one large HTML string
- **Category**: Frontend / Maintainability
- **Severity**: Low
- **Impact**: Improves maintainability and reduces future injection/escaping risk.
- **Evidence**: `openSettingsPanel` starts at `tampermonkey/altyazidb-arr-bridge.user.js:1946` and assigns a large template via `backdrop.innerHTML` at `tampermonkey/altyazidb-arr-bridge.user.js:1953`.
- **Why it’s inefficient**: This is not a hot path, but the large string repeats structure, styling hooks, inputs, and event binding assumptions. It increases bug surface and makes incremental optimization harder.
- **Recommended fix**: Use small DOM builder helpers or a field descriptor array for service panels. Keep escaping centralized and generate repeated Radarr/Sonarr/Prowlarr form rows from data.
- **Tradeoffs / Risks**: More helper code, but less fragile markup editing.
- **Expected impact estimate**: Low runtime impact; medium maintenance benefit for future UI changes.
- **Removal Safety**: Likely Safe
- **Reuse Scope**: local file

### 3) Quick Wins (Do First)

- Completed: removed normal-search status preflights, clamped result limits, scoped parser inputs, short-circuited strong-ID existing checks, and kept Tampermonkey `@connect` local-only by default.
- Completed: rejected redirects, unsafe URL schemes, credential URLs, malformed JSON, and untrusted open-URL messages.
- Completed: eliminated saved API-key values from Chrome, Firefox, and Tampermonkey settings DOM; blank fields preserve keys and explicit per-service controls delete them.

### 4) Deeper Optimizations (Do Next)

- Introduce a shared core module for search planning, parser logic, API normalization, and result summarization, then generate both extension and Tampermonkey outputs from it.
- Replace expanded Chrome/Firefox source copies with one canonical source tree plus a repeatable packaging script.
- Add a lightweight parser benchmark fixture suite for movie, series, episode, and large subtitle/comment pages.
- Add a mock Arr API harness to count requests per click and verify that no-key, keyed, popup, existing-item, and auto-add flows preserve behavior.

### 5) Validation Plan

- **Benchmarks**:
  - Add a synthetic large AltyaziDB fixture with many anchors, subtitles, comments, and JSON-LD blocks.
  - Run `performance.mark()` around `extractMedia()` before/after snapshot caching.
  - Compare parser duration, number of full-document reads, and allocated string size qualitatively through DevTools memory allocation sampling.
- **Profiling strategy**:
  - Use Chrome DevTools Performance on a movie page and a series page.
  - Confirm `innerText` layout work and `innerHTML` serialization disappear or occur once.
  - Profile Tampermonkey separately because it has inline CSS, SVG, settings panel, and API code in one script.
- **Metrics to compare before/after**:
  - API request count per keyed click.
  - Click-to-open latency for no-key fallback, keyed lookup, existing item, popup result, and Prowlarr search.
  - Parser runtime on normal and large fixtures.
  - Userscript size and duplicate line count after shared-core generation.
- **Test cases to ensure correctness is preserved**:
  - Movie page: only Radarr plus optional Prowlarr appears.
  - Series/anime/episode page: only Sonarr plus optional Prowlarr appears.
  - Unknown page: both Radarr and Sonarr appear with `Could not detect media type`.
  - No API key: fallback opens Arr search and shows missing-key message.
  - Invalid API key: rejected-key error remains clear.
  - Localhost offline: `Could not connect to localhost Radarr/Sonarr/Prowlarr`.
  - Existing Radarr/Sonarr item: opens existing item without performing unnecessary lookup after optimization.
  - Auto-add: still uses `searchForMovie: false`, `searchForMissingEpisodes: false`, and `searchForCutoffUnmetEpisodes: false`.

### 6) Optimized Code / Patch (when possible)

Runtime code was updated after the audit for the quick-win items: Prowlarr limit clamping, single-pass page snapshots, removal of normal-search status preflights, and existing-item short-circuiting. The following snippets show the implemented direction and remaining refactor shape for future shared-core work.

#### Snapshot page extraction once

```js
function createPageSnapshot() {
  const bodyText = CFG.normalizeSpace(
    document.body?.innerText || document.documentElement.innerText || ""
  );
  const html = document.documentElement.innerHTML || "";
  const hrefs = Array.from(document.querySelectorAll("a[href]"), (link) => link.href);
  const jsonLd = readJsonLd();

  return { bodyText, html, hrefs, jsonLd, path: window.location.pathname };
}

function extractMedia() {
  const snapshot = createPageSnapshot();
  const signals = jsonLdSignals(snapshot.jsonLd);
  const ids = extractIdsFromLinks(snapshot.hrefs, snapshot.html);
  const seasonEpisode = detectSeasonEpisode(snapshot.bodyText);
  const year = findYear(snapshot.bodyText);
  // Continue current extraction behavior with snapshot inputs.
}
```

#### Remove lookup status preflight

```js
async function lookupArr(service, media, settings) {
  const searchPlan = CFG.buildSearchPlan(service, media);
  const fallbackUrl = fallbackUrlForService(service, settings, searchPlan);

  if (!CFG.serviceApiKey(settings, service)) {
    await createTab(fallbackUrl);
    return missingKeyFallback(service, fallbackUrl);
  }

  // Do not call /system/status here. The lookup itself validates connection/auth.
  const data = await callArrApi(service, settings, searchPlan.apiPath, searchPlan.apiParams);
  // Continue existing result handling.
}
```

#### Clamp Prowlarr limit in settings normalization

```js
function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

merged.prowlarrLimit = clampInt(
  merged.prowlarrLimit,
  1,
  100,
  DEFAULT_SETTINGS.prowlarrLimit
);
```

#### Existing-item short-circuit when strong IDs are present

```js
async function lookupArr(service, media, settings) {
  const searchPlan = CFG.buildSearchPlan(service, media);

  if ((service === "radarr" && media.tmdbId) || (service === "sonarr" && media.tvdbId)) {
    const existing = await findExisting(service, settings, media);
    const existingUrl = CFG.buildDetailPageUrl(CFG.serviceBaseUrl(settings, service), service, existing);
    if (existingUrl) {
      await createTab(existingUrl);
      return { ok: true, service, opened: true, openedUrl: existingUrl };
    }
  }

  // Continue lookup for not-yet-added items.
}
```
