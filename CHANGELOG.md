# Changelog

## [0.2.0] — 2026-04-08

### Added
- Word-level fuzzy search — query split into space-separated terms, each matched as substring
- Match highlighting in result titles and URLs (Catppuccin red, bold)
- Input modes: normal (search), plugin (prefix), address (URL-like with ghost text)
- Ghost text auto-complete in address mode — Tab or → to accept
- Shadow DOM isolation — host page CSS can no longer break the overlay
- Version label in overlay corner
- `// #IF_DEV` / `// #END_IF_DEV` preprocessor directives for dev-only code
- `build.js` build script with `--release` flag

### Changed
- Frecency scoring: log₂ scale replaces visit count cap of 10
- Tab bonus: 150 → 300, bookmark bonus: 30 → 50
- Results container: CSS-only dynamic height (10 rows via `--xun-row-h` custom property)
- Rendering: granular pub/sub state dispatch replaces full re-render
- Version sourced from `package.json` (single source of truth)
- `npm run build` (dev) / `npm run build:release` (production)
- Quoted queries (`"github.com"`) force normal search mode

### Fixed
- Mouse scroll in results (root cause: re-render resetting `pointerEvents`)
- High-visit pages (755 visits) now correctly outrank low-visit pages (8 visits)
- Modal no longer clips results at fixed `max-height`

## [0.1.0] — 2026-04-03

### Added
- Initial release
- Spotlight-style overlay (Cmd+K / Ctrl+K)
- Search across tabs, bookmarks, and browser history
- Frecency scoring with exponential decay
- Two-layer cache: cache layer (raw data) + query layer (scoring, dedup)
- Refresh-on-open + hybrid deep-search (300ms idle)
- Plugin system with prefix matching
- URL deduplication by origin+pathname
- Configurable keyboard shortcut via toolbar popup
- CSP-compliant DOM rendering
- Config validation with migration
- Catppuccin Mocha theme
