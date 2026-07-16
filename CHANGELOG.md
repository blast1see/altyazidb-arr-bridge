# Changelog

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
