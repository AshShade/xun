# Xun (寻) — User Stories

> A keyboard-driven launcher for your browser. Press one shortcut to find any open tab, bookmark, or page from your history — then jump to it instantly. Think Spotlight/Alfred, but for everything in your browser.

## Why?

You have 40 tabs open, hundreds of bookmarks, and thousands of history entries. Chrome's address bar mixes web search results with your data. Xun shows ONLY your stuff — ranked by how recently and frequently you visit each page — and gets you there in under a second.

---

## Core Launch

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 1 | User presses Cmd+K (Mac) or Ctrl+K on any page | Overlay appears with input focused, ready to type |
| 2 | User presses Escape while overlay is open | Overlay closes, page returns to normal |
| 3 | User clicks the dark backdrop area | Overlay closes |
| 4 | User presses Cmd+K again while overlay is open | Overlay closes (toggle behavior) |

## New Tab Integration

When you open a new tab, Xun is already there — no need to press Cmd+K.

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 5 | User opens a new tab (Cmd+T) | Xun appears auto-focused — start typing immediately |
| 6 | User presses Escape on new tab | Input clears, Xun stays open (nowhere to "close" to) |
| 7 | User clicks backdrop on new tab | Input clears, Xun stays open |
| 8 | User selects result with Enter on new tab | Navigates in the same tab (replaces new tab) |
| 9 | User selects result with Cmd+Enter on new tab | Opens in a new tab, input clears, Xun stays for next action |
| 10 | User selects an open tab result on new tab | Switches to that tab, new tab closes automatically |

## Finding Things

Type anything — words from page titles, parts of URLs, domain names. Results appear instantly.

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 11 | User types a query (e.g. "git") | Results from tabs/bookmarks/history appear within 50ms |
| 12 | User types multi-word query (e.g. "react docs") | Matches pages where words span across title AND URL |
| 13 | User sees results for recently visited pages | Recent pages ranked higher (frecency scoring) |
| 14 | User sees an open tab in results | Tab results have +300 score bonus, appear near top |
| 15 | User has visited same URL with different query params | Only one entry shown (deduplicated by origin+pathname) |
| 16 | User types a query and waits 100ms | Deep search fetches additional results from full browser history |

## Navigating Results

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 17 | User presses ↓ or ↑ | Selection highlight moves through result list |
| 18 | User presses Enter with a result selected | Navigates to that page in current tab |
| 19 | User presses Cmd+Enter with a result selected | Opens that page in a new tab |
| 20 | User types a URL (e.g. "github.com") and presses Enter | Navigates directly to that URL |
| 21 | User types non-URL text, presses Enter with no results | Browser's default search engine is used (via Chrome Search API) |

## Ghost Text (Auto-complete)

As you type, Xun suggests the common prefix of all matching URLs as faded "ghost text" — like terminal auto-complete.

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 22 | User types "git" and has github.com + gitlab.com in history | Ghost text shows "hub.com/" or nothing if they diverge at next char |
| 23 | User presses Tab or → with ghost text visible | Ghost text is accepted, appended to input |
| 24 | User accepts ghost text, then keeps typing | New ghost text appears for the narrowed set of URLs |
| 25 | All matching URLs diverge immediately after query | No ghost text shown (nothing in common to suggest) |

## Prefix Filters

Type a single letter + space to narrow results to one source.

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 26 | User types "t react" | Only open TAB results shown, colored "tabs" label appears |
| 27 | User types "b github" | Only BOOKMARK results shown, "bookmarks" label appears |
| 28 | User types "h docs" | Only HISTORY results shown, "history" label appears |
| 29 | User activates a prefix filter | First result is auto-selected (ready to press Enter) |

## Plugins — Filter Type

Custom plugins that narrow results to URLs matching a glob pattern.

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 30 | User types "gh repo" (GitHub plugin with prefix "gh") | Only pages matching github.com/** shown |
| 31 | Plugin is active | Plugin's colored label appears in search bar |

## Plugins — Template Type

Custom plugins that open a parameterized URL.

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 32 | User types "cs react hooks" (CodeSearch plugin) | Pressing Enter opens https://grep.app/search?q=react%20hooks |
| 33 | Template plugin is active | Plugin's colored label appears in search bar |

## Functional Plugins

Built-in commands starting with /.

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 34 | User types "/compute 2+2" | Shows "4" as result with copy-to-clipboard action |
| 35 | User types "/translate hello" | Shows translation result/link |
| 36 | User types "/plugins" | Lists all registered plugins with their prefixes |

## Tab Switching

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 37 | User selects an open tab result (Enter, not Cmd+Enter) | Switches to that tab AND focuses its window — no duplicate opened |

## Config

| # | User Story | Expected Outcome |
|---|-----------|-----------------|
| 38 | User changes keyboard shortcut in settings popup | New shortcut works immediately on all pages |
| 39 | User edits plugin config in JSON editor | Plugins/prefixes/colors update without restart |
