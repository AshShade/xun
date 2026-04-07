# TODO

Ideas and future features — not committed to, just captured so they don't get lost.

## Plugins
- [ ] Functional plugins — plugins that compute and display results inline instead of filtering URLs (e.g. calculator: type `calc 2+3` → shows `5`, clipboard copy on Enter)

## Search
- [ ] Highlight matched characters in results (bold or underline the fuzzy-matched chars)
- [ ] Multi-word search — split query by space, match each word independently
- [ ] Auto-suggest / auto-complete — show completions as you type based on top result

## UI
- [ ] Dark/light theme toggle (currently Catppuccin Mocha only)
- [ ] Style isolation — overlay looks broken on some pages, likely global CSS leaking in (reset/scope all styles)

## Keyboard
- [ ] Shortcut conflicts — Cmd+K doesn't work on some pages, possibly other extensions intercepting the event before Xun

## Performance
- [ ] Benchmark with 10k+ history entries to find scaling limits
