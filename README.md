# Xun (寻)

Spotlight-style search for Firefox — search open tabs, bookmarks, and history from a single floating bar.

寻 means "to seek" in Chinese. Also a nod to 巽 (the Wind trigram) — penetrates everywhere, finds everything.

## Install

1. Open Firefox → `about:debugging` → This Firefox → Load Temporary Add-on
2. Select `manifest.json` from this directory

## Usage

- `Ctrl+K` (`Cmd+K` on Mac) to open — configurable via toolbar icon
- Type to search across open tabs, bookmarks, and history
- `↑`/`↓` to navigate, `Enter` to go, `Esc` to close
- Click a result or click outside to dismiss
- `Enter` with no result selected searches the web (configurable engine)

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

Results are scored by frecency (frequency + recency) and sorted highest first:

- **Open tabs** — base score 100
- **Bookmarks** — base score 50
- **History** — `min(visitCount, 50) × 2` + recency bonus:

| Last visited | Bonus |
|-------------|-------|
| < 1 hour | +50 |
| < 4 hours | +40 |
| < 24 hours | +30 |
| < 3 days | +20 |
| < 7 days | +10 |

URLs appearing in multiple sources (e.g. a bookmarked page in history) get combined scores.

## Settings

Click the toolbar icon to configure:

- **Shortcut** — click the field and press your desired key combination
- **Source prefixes** — change `/h`, `/t`, `/b` to whatever you prefer
- **Plugins** — add pattern or search plugins with prefix, name, and color
- **Search engine** — URL with `%s` placeholder (default: Google)
- **Edit config as JSON** — opens a full-tab JSON editor with docs panel

## Development

```bash
npm install
npm run build    # compile TypeScript to dist/
npm run check    # type-check + run tests
npm run coverage # tests with coverage report
```

Load in Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → select `manifest.json`. Reload after changes.
