# Changelog

## 0.1.7 - 2026-11-22

Security:

- Updated `web-ext` to 10.8.0 and `puppeteer-core` to 25.18.1, kept the scoped `adm-zip` (0.6.1) and `brace-expansion` (1.1.21) overrides, and dropped the `shell-quote` override: `web-ext` 10.8.0 brings `fx-runner` 1.7.0, which pins the patched `shell-quote` 1.11.0 (GHSA-pqg4-j6r4-53mv). The refreshed lockfile also moves `node-forge` to 1.4.3, `undici` to 7.30.2, `zod` to 4.6.7 (through `chromium-bidi`), and `fast-uri`, `js-yaml` and `source-map-js` to patched versions. `npm audit` reports no advisories. All are development dependencies; the extension and the userscript are unchanged.
- The CI audit step is now `scripts/audit-check.js`: it still fails on every high or critical advisory, but accepts the ones listed in it with a reason. None is listed: `node-forge` 1.4.3 fixed GHSA-86w9-cpqp-85rv, the only advisory that once had no fixed release. The script says when a listed advisory is no longer reported, so an exception does not outlive the problem.

Fixes:

- Movie pages no longer get a fake season/episode: a title such as `5x2` or `X2` on a movie path, or the site's numeric slug id (`/dizi/45-x2.html`), was read as `S45E02`, and Prowlarr/Jackett terms for movies carried that `SxxEyy` token. Movie search terms now always use title and year.
- The page title no longer supplies a wrong year: the first four-digit number was taken (`Blade Runner 2049`). Only a parenthesized year that is not in the future is used now (`2001: A Space Odyssey (1968)`); detail-row and JSON-LD years keep priority.
- `/xfsearch/...` listings and bare or paginated category roots (`/film/`, `/dizi/page/2/`) are no longer treated as detail pages, so buttons are not mounted on list pages.
- Behavior change: auto-add now posts only an exact match (a strong TMDb/TVDb/IMDb ID match, the single result of an ID-keyed lookup, or an equal normalized title whose year agrees). Previously it fell back to the first lookup result and could add an unrelated title. Without an exact match nothing is added and the Radarr/Sonarr add search page opens with the message "No exact match; opened ... add search instead of auto-adding."
- Opening a result no longer fails as a whole when a step breaks: an unreachable existing-item check falls back to the add page, an invalid service URL is reported without opening a tab, a tab that cannot be opened after a successful add keeps the add reported as done, and open-URL/open-result errors are returned as redacted responses instead of rejections.
- Callback-style `chrome.*` storage, tabs, and permissions calls in the background, content script, and options page now check `runtime.lastError`, so a failed call rejects with its message instead of resolving as if it had succeeded.
- Button toggles changed in the options page now update AltyaziDB tabs that are already open (`storage.onChanged`), without a reload; a plain save that changes nothing does not rebuild the row.

Improvements:

- The Tampermonkey userscript carries the same season/episode, year, page-gate, movie-term, and auto-add exact-match fixes as the extension.
- Added options-page tests (`test/options.test.js`) and a userscript parity test (`test/userscript-parity.test.js`) that runs the userscript's pure functions against the extension's on shared vectors, including the end-to-end auto-add response; both run in `npm test`. The userscript hands its functions to the test through a hook that is only called when `GM_info` is absent, which never happens in a userscript manager.

## 0.1.6 - 2026-08-02

Security:

- Moved the Tampermonkey settings panel into a closed shadow root so page scripts can no longer read the API-key inputs, query the panel, or reach it through `shadowRoot` or `composedPath()`.
- Stopped emitting `http://[::1]/*`-style host permission patterns, which are not valid browser match patterns and made `permissions.contains()` throw instead of answering; IPv6 service URLs now skip the pre-flight check and let the browser enforce host access.
- Extended API-key redaction to `api_key`, `api-key`, and quoted JSON forms in failure details.
- Resolved the remaining `adm-zip` and `brace-expansion` development advisories with scoped `npm` overrides; `npm audit` now reports zero vulnerabilities.
- Restricted the CI workflow to read-only `contents` permission, disabled credential persistence on checkout, and made `npm audit --audit-level=high` a required step.

Fixes:

- Fixed duplicate button rows: a DOM mutation burst arriving while a render was still waiting on stored settings started a second render and mounted a second shell.
- Fixed an unbounded render loop: the retry budget was reset on every mutation, so pages without detail markup polled the detail selectors indefinitely. Attempts now reset only on navigation or after a mounted shell is removed.
- Fixed loopback detection for bracketed IPv6 hosts, so `http://[::1]:9117` failures again report the localhost-specific "check that the service is running" guidance instead of generic network advice.
- Removed dead API-key control code in the options page and moved the save confirmation after the write actually completes.

Performance:

- Capped Prowlarr and Jackett alternative-title retries at three queries. Release-name parsing could previously produce up to ten variants, each fanning out to every enabled tracker.
- Raised the timeout for aggregate tracker searches to 30s while keeping status, lookup, and add calls at 10s.
- Resolved the detail containers once per extraction instead of re-running the same document queries in each parser helper.

Improvements:

- Prowlarr popup results now honour the configured result limit instead of a hard-coded cap of 8.
- Result popups and the Tampermonkey settings panel close with `Escape`.
- Added a DOM-level content-script test suite (render concurrency, retry budget, navigation recovery), IPv6/loopback config tests, search-cap and timeout tests, and a shadow-isolation assertion in the browser E2E run.

## 0.1.5 - 2026-07-26

- Restricted service configuration and tab opening to credential-free HTTP/HTTPS URLs and configured service origins and reverse-proxy path prefixes; active schemes and redirects are rejected with explicit guidance.
- Kept request timeouts active through response-body reads, made JSON response validation strict, and allowed text/XML only for Jackett Torznab `t=caps`.
- Redacted API keys and `apikey=` values from API failures and manual diagnostics; manual Jackett helpers now accept secrets only through a temporary environment variable.
- Stopped the parser from scanning full page text/HTML, publication dates, subtitle rows, and comments for media identity; unknown detail routes now require strong detail DOM markers.
- Added debounced late-DOM and SPA-like rerender handling without duplicate shells or handlers.
- Normalized corrupted stored booleans, limits, enums, root paths, and positive quality profile IDs while preserving existing setting names and disabled-by-default auto-add.
- Prevented duplicate strong-ID existing checks and kept Radarr/Sonarr automatic search flags disabled.
- Prevented Chrome, Firefox, and Tampermonkey settings from rendering saved API keys into the page DOM; blank key fields preserve saved values and independent explicit controls delete them.
- Expanded Chrome/Firefox mirroring and verification to every non-manifest source, style, HTML, asset, and fixture file; package versions now come from `package.json`.
- Restricted release archives to runtime extension files so development fixtures are not distributed.
- Pinned GitHub Actions revisions to verified full commit SHAs and made Chrome E2E discovery, temporary profiles, artifacts, and negative waits portable.
- Expanded parser, URL, API, permission, malformed-response, redirect, existing-item, auto-add, release-result, privacy, and mirror tests.
- Updated the transitive development dependencies `fast-uri` to 3.1.4 and `shell-quote` to 1.9.0 to address their security advisories.
- Documented that the remaining `web-ext`-only `adm-zip` and `brace-expansion` advisories affect build/development tooling and are not included in distributed extensions or the userscript.

## 0.1.4

- Fixed Firefox host permissions by removing ports from match patterns and declaring custom HTTP/HTTPS hosts as optional permissions.
- Added a runtime permission guard: rejected custom host permissions stop before `fetch`.
- Replaced the generic Jackett CORS diagnosis with separate timeout, permission, local-service, URL, and TLS guidance.
- Changed the Jackett connection test to Torznab `t=caps`, avoiding a real aggregate tracker search.
- Stopped series-page parsing from scanning subtitle table/body text for season and episode numbers.
- Kept the successful Prowlarr/Jackett alternative query through popup rendering and result opening.
- Added safe HTTP/HTTPS result detail URL handling and rejected unsafe URL schemes.
- Applied `jackettLimit` as the actual popup result limit and renamed the setting label.
- Removed the unused `tabs` permission.
- Added parser fixtures, Firefox permission accept/reject tests, mock Radarr/Sonarr/Prowlarr/Jackett API tests, mirrored-source verification, JavaScript syntax checks, and `web-ext lint`.
- Updated CI to `actions/checkout@v5`, `actions/setup-node@v6`, Node.js 24, `puppeteer-core` 25.3.0, and `web-ext` 10.5.0.

Compatibility notes:

- Existing setting keys and versioned source directory names remain unchanged.
- AltyaziDB API v1.3 is not required; DOM, URL, IMDb, TMDb, and TVDb signals remain the primary integration path.
- Auto-add still does not trigger an automatic Radarr or Sonarr search.

## 0.1.3

- Switched default local service URLs from `localhost` to `127.0.0.1`.
- Added Jackett integration and connection diagnostics.
