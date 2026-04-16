# Xun (寻)

Spotlight-style search for Firefox — search open tabs, bookmarks, and history from a single floating bar.

寻 means "to seek" in Chinese. Also a nod to 巽 (the Wind trigram) — penetrates everywhere, finds everything.

## Install

**From AMO** (recommended): [addons.mozilla.org](https://addons.mozilla.org/) — search "Xun" or install by extension ID `xun@AshShade`.

**From source** (development):
1. Clone the repo and run `npm install && npm run build`
2. Open Firefox → `about:debugging` → This Firefox → Load Temporary Add-on
3. Select `dist/manifest.json` from the project

## Usage

- `Ctrl+K` (`Cmd+K` on Mac) to open — configurable via toolbar icon
- Type to search across open tabs, bookmarks, and history
- `↑`/`↓` to navigate, `Enter` to go, `Esc` to close
- Click a result or click outside to dismiss
- `Enter` with no result selected searches the web (configurable engine)
- Each result shows title on top, full URL below — no truncated hostnames
- Full URL shown at bottom-left when a result is selected (like browser link hover)
- Type a URL directly (e.g. `github.com`) and press `Enter` to navigate — `https://` is added automatically

## Prefix Filters

Type a prefix as the first word followed by a space to narrow results. No `/` needed — a colored label appears in the search bar when a prefix is active.

| Prefix | Source |
|--------|--------|
| `t` | Open tabs |
| `b` | Bookmarks |
| `h` | History |

Prefixes are configurable in settings. With a prefix, the first result is auto-selected. Without a prefix, nothing is selected — `Enter` triggers a web search.

## Plugins

Extend Xun with custom plugins. Two types available:

### Pattern Plugin

Filters results by URL glob pattern. Example: a "Wiki" plugin with prefix `w` that only shows wiki pages.

```json
{
  "name": "Wiki",
  "prefix": "w",
  "pluginType": "pattern",
  "patterns": ["docs.example.com/wiki/view/**"],
  "color": "#f38ba8"
}
```

### Search Plugin

Redirects to a URL with `%s` replaced by your query. Example: `cs test` opens CodeSearch for "test".

```json
{
  "name": "CodeSearch",
  "prefix": "cs",
  "pluginType": "search",
  "url": "https://grep.app/search?q=%s",
  "color": "#fab387"
}
```

### Functional Plugins

Built-in commands that start with `/`. These provide interactive results with labels, descriptions, and fill-on-enter behavior.

| Command | Description |
|---------|-------------|
| `/plugins` | Browse all registered plugins — shows name, prefix, and URL patterns |
| `/plugins <query>` | Fuzzy search plugins by name or prefix |
| `/compute <expr>` | Evaluate math expressions (e.g. `/compute 2+3*4`) |

Type `/plugins ` (with trailing space) to list all plugins. Select one and press Enter to fill its prefix into the search bar.

Custom functional plugins can be added by extending `background.ts`.

### Pattern Syntax

Patterns use glob matching against `hostname + path` (protocol is stripped).

| Symbol | Matches |
|--------|---------|
| `*` | Any characters except `.` and `/` (single segment) |
| `**` | Any characters including `.` and `/` (any depth) |

If a pattern contains no `/`, `/**` is appended automatically so domain-only patterns match all paths.

#### Examples

| Pattern | Matches | Doesn't match |
|---------|---------|---------------|
| `github.com` | `github.com/user/repo/issues` | `gist.github.com` |
| `*.github.com` | `gist.github.com`, `gist.github.com/foo` | `a.b.github.com` |
| `ci.example.com` | `ci.example.com/pipelines/Foo` | `github.com` |
| `docs.example.com/wiki/view/*` | `docs.example.com/wiki/view/MyTeam` | `docs.example.com/wiki/view/My/Sub` |
| `docs.example.com/wiki/view/**` | `docs.example.com/wiki/view/My/Sub/Page` | `docs.example.com/wiki/edit/X` |

## Ranking

Results are scored by **frecency + fuzzy match quality**, then sorted highest first.

**Final score** = frecency + source bonuses + fuzzy match score

### Frecency (history)

```
log₂(visitCount + 1) × e^(-0.3 × √hours) × 150
```

Visit count uses a log scale — diminishing returns so 755 visits scores ~3× higher than 8 visits, not the same. The exponential decay on `√hours` drops fast in the first few hours, then flattens — a page from 3 hours ago still scores well, but a page from a week ago is nearly gone.

### Source bonuses (applied once per URL, no double-counting)

| Source | Bonus |
|--------|-------|
| Open tab | +300 |
| Bookmark | +50 |

### Fuzzy matching

Queries are split into space-separated terms. Each term must appear as a substring in the title or URL. For example, `work pkg` matches `workspace/examples/a-example-pkg` because `work` and `pkg` both appear. Scoring rewards:

- Longer matched terms (+2 per character)
- Word boundary matches — term starts after `/`, `.`, `-`, `_`, space, or at start (+3)
- Near-exact matches — term covers most of the string (+5)

Matched terms are highlighted in both the title and URL of each result. Highlights use Catppuccin Mocha red (`#f38ba8`) with bold weight.

### Input modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Normal** | Default | Word-level fuzzy search across tabs, bookmarks, history |
| **Plugin** | First word matches a plugin prefix | Filters results by plugin patterns |
| **Functional** | Query starts with `/` | Runs a built-in command (`/plugins`, `/compute`) |
| **Address** | No spaces + contains `.`, `/`, or `://` | Ghost text auto-completion from top matching URL. Press Tab or → to accept |

Wrap query in `"quotes"` to force normal mode (e.g. `"github.com"` searches instead of navigating).

### Design principles
- Frequency uses log scale — 755 visits matters more than 8, but not 94× more
- Recency dominates — a page visited minutes ago always ranks near the top
- Open tabs get a strong bonus — you have them open for a reason
- Bookmarks get a small nudge — not enough to save a stale page
- Better text matches rank higher among results with similar frecency

## Settings

Click the toolbar icon to configure:

- **Shortcut** — click the field and press your desired key combination
- **Source prefixes** — change `/h`, `/t`, `/b` to whatever you prefer
- **Plugins** — add pattern or search plugins with prefix, name, and color
- **Search engine** — URL with `%s` placeholder (default: Google)
- **Edit config as JSON** — opens a full-tab JSON editor with docs panel

## Architecture

| File | Role |
|------|------|
| `content.ts` | UI controller — Shadow DOM, single-renderer architecture, event handlers |
| `render-model.ts` | Pure compute layer — `computeUI(state)` produces the full UI model from state |
| `background.ts` | Search engine — in-memory caches (history, bookmarks, tabs), query processing, functional plugins |
| `lib.ts` | Pure functions — scoring (frecency + fuzzy match), cache builders, config validation with migration |
| `dom.ts` | DOM helpers — `highlightIndex`, `hexToRgba`, `truncateUrl` |
| `types.ts` | Shared TypeScript type definitions |
| `options.ts` | Settings page — shortcut config, prefix/plugin management, search engine |
| `editor.ts` | Full-tab JSON config editor with docs panel |
| `build.js` | Build preprocessor — version injection, `#IF_DEV` block stripping, export removal |
| `xun.css` | All styles (Catppuccin Mocha theme) |

### State management

`content.ts` uses a single-renderer architecture inspired by React's unidirectional data flow:

```
setState(patch) → queueMicrotask → computeUI(state) → render(UIModel)
```

1. **State** — a single `State` object holds all UI state. `setState(patch)` merges changes and schedules a render via `queueMicrotask` (batches multiple calls in the same tick).
2. **Compute** — `computeUI(state)` is a pure function that produces a `UIModel` describing the entire UI: results, plugin label, ghost text, and preview.
3. **Render** — a single `render()` function owns all DOM elements (captured in a closure — inaccessible from outside). It diffs the new model against the previous one at the component level:
   - **Results**: full DOM rebuild only when content changes; selection-only changes just toggle a CSS class + `scrollIntoView`
   - **Plugin label, ghost, preview**: reference equality check, skip if unchanged

This makes it structurally impossible for two render paths to touch the same DOM element.

## Development

```bash
npm install
npm run build                # dev build → 0.2.0-b7382 (random suffix, includes debug logging)
npm run build:release        # release build → 0.2.0 (strips #IF_DEV blocks)
npm run check                # type-check + run tests
npm run coverage             # tests with coverage report
```

### Build preprocessor

`build.js` post-processes compiled JS:
- Injects version from `package.json` (replaces `__VERSION__` placeholder)
- Dev builds append `-bNNNN` random suffix, release builds use plain semver
- Release builds strip code between `// #IF_DEV` and `// #END_IF_DEV` markers
- Syncs `manifest.json` version from `package.json`

Load in Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → select `manifest.json`. Reload after changes.
