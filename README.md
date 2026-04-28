# Xun (寻)

Spotlight-style search for your browser — search open tabs, bookmarks, and history from a single floating bar. Works on Firefox and Chrome.

寻 means "to seek" in Chinese. Also a nod to 巽 (the Wind trigram) — penetrates everywhere, finds everything.

## Install

**Chrome**: [Chrome Web Store](https://chromewebstore.google.com/detail/xun-%E5%AF%BB/igphlagbmekmebpgohipibfbhjcgliej)

**Firefox**: [Firefox Add-ons](https://addons.mozilla.org/en-CA/firefox/addon/xun-%E5%AF%BB)

**From source**:
1. Clone the repo and run `npm install && npm run build`
2. **Firefox**: `about:debugging` → This Firefox → Load Temporary Add-on → select `dist/manifest.json`
3. **Chrome**: `chrome://extensions/` → Developer mode → Load unpacked → select `dist/`

## Usage

- `Ctrl+K` (`Cmd+K` on Mac) to open — configurable via toolbar icon
- Opens automatically on new tabs (Chrome) — replaces the default new tab page
- Type to search across open tabs, bookmarks, and history
- `↑`/`↓` to navigate, `Enter` to go, `Esc` to close
- `Cmd+Enter` / `Ctrl+Enter` to open in a new tab
- Type a URL directly (e.g. `github.com`) and press `Enter` to navigate
- Ghost text auto-completes the common prefix of all matching URLs — press `Tab` or `→` to accept, then keep typing to narrow down

## Prefix Filters

Type a prefix followed by a space to narrow results. A colored label appears when active.

| Prefix | Source |
|--------|--------|
| `t` | Open tabs |
| `b` | Bookmarks |
| `h` | History |

## Plugins

### Pattern Plugin
Filters results by URL glob pattern.
```json
{ "name": "Wiki", "prefix": "w", "pluginType": "pattern", "patterns": ["docs.example.com/**"], "color": "#f38ba8" }
```

### Search Plugin
Redirects to a URL with `%s` replaced by your query.
```json
{ "name": "CodeSearch", "prefix": "cs", "pluginType": "search", "url": "https://grep.app/search?q=%s", "color": "#fab387" }
```

### Functional Plugins
Built-in commands starting with `/`:

| Command | Description |
|---------|-------------|
| `/compute <expr>` | Evaluate math expressions |
| `/translate <text>` | Translate between English and Chinese |
| `/plugins` | Browse all registered plugins |

### Pattern Syntax

| Symbol | Matches |
|--------|---------|
| `*` | Any characters except `.` and `/` |
| `**` | Any characters including `.` and `/` |

Domain-only patterns auto-match all paths.

## Config Sync

Sync your config across browsers using a [remote-fs](https://github.com/AshShade/remote-fs) server:

1. Start the server on your host: `bun run server.ts`
2. In Xun, open the config editor (toolbar icon → Edit config as JSON)
3. Set the Sync URL (e.g. `http://localhost:5656/.xun-config`)
4. Click "Sync now"

Config is pushed on every save and pulled periodically (every hour). If the remote file doesn't exist, local config is uploaded to seed it. Uses `If-Modified-Since` / `304` for efficient polling.

## Ranking

Results are scored by **frecency + fuzzy match quality**.

- **Frecency**: `log₂(visitCount + 1) × e^(-0.3 × √hours) × 150` — log-scale visits with exponential time decay
- **Open tabs**: +300 bonus
- **Bookmarks**: +50 bonus
- **Fuzzy match**: substring matching with word-boundary and near-exact bonuses

## Architecture

| File | Role |
|------|------|
| `background.ts` | Search engine — in-memory caches, query processing, config sync, functional plugins |
| `content.ts` | UI — Shadow DOM, single-renderer architecture (`State → computeUI → render`) |
| `render-model.ts` | Pure compute — `computeUI(state)` produces full UI model from state |
| `lib.ts` | Pure functions — scoring, cache builders, config validation |
| `dom.ts` | DOM helpers — highlight, color, truncate |
| `options.ts` | Settings popup — shortcut, prefixes, plugins, search engine |
| `editor.ts` | Full-tab JSON config editor with docs panel and sync UI |

## Development

```bash
npm install
npm run build              # dev build with debug logging
npm run build:release      # release → dist-firefox/ + dist-chrome/
npm run check              # type-check + tests
npm run coverage           # tests with coverage (100% threshold)
```

### Browser-specific builds

`build:release` produces two directories:
- **`dist-firefox/`** — MV3 with `background.scripts`, `browser_specific_settings`
- **`dist-chrome/`** — MV3 with `service_worker` only

### Manifest V3

Both browsers use Manifest V3 with the `chrome.*` API namespace. Firefox supports `chrome.*` as a compatibility alias. The service worker architecture is safe because caches rebuild on every open (~9ms).

## Theme

Catppuccin Mocha — all colors from the palette. Highlights use red (`#f38ba8`), labels use per-source colors (blue for tabs, yellow for bookmarks, green for history).
