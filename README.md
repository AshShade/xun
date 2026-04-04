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
- Full URL shown at bottom-left when a result is selected (like browser link hover)

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

Results are scored by frecency — a combination of visit frequency, recency, and source type — then sorted highest first.

**Core formula (history):**

```
score = min(visitCount, 10) × e^(-0.3 × √hours) × 100
```

The exponential decay on `√hours` drops fast in the first few hours, then flattens — a page from 3 hours ago still scores well, but a page from a week ago is nearly gone.

**Source bonuses** (applied once per URL, no double-counting):

| Source | Bonus |
|--------|-------|
| Open tab | +150 |
| Bookmark | +30 |

URLs appearing in multiple sources get combined: a bookmarked page open in a tab with history visits gets `historyScore + 150 + 30`.

**Design principles:**
- Recency dominates — a page visited minutes ago always ranks near the top
- Frequency is capped at 10 visits — beyond that, recency decides
- Open tabs get a strong bonus — you have them open for a reason
- Bookmarks get a small nudge — not enough to save a stale page

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
npm run build        # dev build (includes debug logging)
npm run build:prod   # prod build (strips debug logging)
npm run check        # type-check + run tests
npm run coverage     # tests with coverage report
```

Load in Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → select `manifest.json`. Reload after changes.

Dev builds include `DEV` mode: selecting a result logs its score breakdown (visit count, recency, source type) to the browser console.
