# Changelog

## Unreleased

- Restricted service configuration and tab opening to credential-free HTTP/HTTPS URLs and configured service origins and reverse-proxy path prefixes; active schemes and redirects are rejected with explicit guidance.
- Kept request timeouts active through response-body reads, made JSON response validation strict, and allowed text/XML only for Jackett Torznab `t=caps`.
- Redacted API keys and `apikey=` values from API failures and manual diagnostics; manual Jackett helpers now accept secrets only through a temporary environment variable.
- Stopped the parser from scanning full page text/HTML, publication dates, subtitle rows, and comments for media identity; unknown detail routes now require strong detail DOM markers.
- Added debounced late-DOM and SPA-like rerender handling without duplicate shells or handlers.
- Normalized corrupted stored booleans, limits, enums, root paths, and positive quality profile IDs while preserving existing setting names and disabled-by-default auto-add.
- Prevented duplicate strong-ID existing checks and kept Radarr/Sonarr automatic search flags disabled.
- Prevented Chrome, Firefox, and Tampermonkey settings from rendering saved API keys into the page DOM; blank key fields preserve saved values and independent explicit controls delete them.
- Expanded Chrome/Firefox mirroring and verification to every non-manifest source, style, HTML, asset, and fixture file; package versions now come from `package.json`.
- Pinned GitHub Actions revisions to verified full commit SHAs and made Chrome E2E discovery, temporary profiles, artifacts, and negative waits portable.
- Expanded parser, URL, API, permission, malformed-response, redirect, existing-item, auto-add, release-result, privacy, and mirror tests.

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
