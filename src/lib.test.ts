import { describe, it, expect } from "vitest";
import { globMatch, matchesPlugin, parseQuery, decayScore, TAB_BONUS, BOOKMARK_BONUS, fuzzyMatch, textMatch, mergeResults, urlKey, validateConfig, CONFIG_SCHEMA_VERSION, mergeHistoryCache, filterBookmarks, filterTabs, loadCaches, serializeCaches, applySnapshot, queryHistory, queryBookmarks, queryTabs, computeExpression, suggestGhost, shouldSearch, MIN_QUERY_LENGTH } from "./lib";
import { truncateUrl, buildResultRow } from "./dom";
import type { Config, HistoryEntry, FilterPlugin, TemplatePlugin, SearchResult, BrowserDataPort } from "./types";

describe("globMatch", () => {
  it("matches domain-only patterns with auto /**", () => {
    expect(globMatch("github.com/user/repo", "github.com")).toBe(true);
    expect(globMatch("gitlab.com/user/repo", "github.com")).toBe(false);
  });
  it("matches * as single segment", () => {
    expect(globMatch("a.github.com/x", "*.github.com")).toBe(true);
    expect(globMatch("a.b.github.com/x", "*.github.com")).toBe(false);
  });
  it("matches ** as any depth", () => {
    expect(globMatch("docs.example.com/wiki/view/A/B/C", "docs.example.com/wiki/view/**")).toBe(true);
  });
});

describe("matchesPlugin", () => {
  const plugin: FilterPlugin = { name: "P", prefix: "p", pluginType: "filter", patterns: ["github.com"], color: "#f00" };
  it("matches URL against plugin patterns", () => {
    expect(matchesPlugin("https://github.com/user/repo", plugin)).toBe(true);
    expect(matchesPlugin("https://gitlab.com/user/repo", plugin)).toBe(false);
  });
  it("returns true when no plugin", () => {
    expect(matchesPlugin("https://anything.com", null)).toBe(true);
  });
  it("returns false for invalid URL", () => {
    expect(matchesPlugin("not a valid url", { name: "P", prefix: "p", pluginType: "filter", patterns: ["x.com"], color: "#f00" })).toBe(false);
  });
});

describe("parseQuery", () => {
  const config: Config = {
    prefixes: { history: "h", tabs: "t", bookmarks: "b" },
    sourceColors: {}, plugins: [
      { name: "P", prefix: "p", pluginType: "filter", patterns: [], color: "#f00" },
      { name: "S", prefix: "cs", pluginType: "template", url: "https://s.com?q={}", color: "#0f0" },
    ],
  };
  it("detects built-in prefix", () => {
    expect(parseQuery("h react", config)).toEqual({ query: "react", source: "history", plugin: null });
  });
  it("detects plugin prefix", () => {
    const r = parseQuery("p deploy", config);
    expect(r.query).toBe("deploy");
    expect(r.plugin?.name).toBe("P");
  });
  it("returns raw query when no prefix", () => {
    expect(parseQuery("react hooks", config)).toEqual({ query: "react hooks", source: null, plugin: null });
  });
  it("handles config with no plugins array", () => {
    const noPlugins = { prefixes: { history: "h", tabs: "t", bookmarks: "b" }, sourceColors: {} } as Config;
    expect(parseQuery("p deploy", noPlugins)).toEqual({ query: "p deploy", source: null, plugin: null });
  });
});

const hours = (h: number) => Date.now() - h * 60 * 60 * 1000;
const days = (d: number) => hours(d * 24);

describe("decayScore", () => {
  it("returns 0 for no visits", () => { expect(decayScore(0, Date.now())).toBe(0); });
  it("returns 0 for null lastVisitTime", () => { expect(decayScore(10, null)).toBe(0); });
  it("returns 0 for undefined visitCount", () => { expect(decayScore(undefined, Date.now())).toBe(0); });

  it("just visited page scores high", () => {
    expect(decayScore(5, Date.now())).toBeGreaterThan(300);
  });

  it("more visits scores higher at same recency", () => {
    expect(decayScore(100, Date.now())).toBeGreaterThan(decayScore(10, Date.now()));
  });

  it("high visits no longer capped — 755 beats 8 at similar recency", () => {
    expect(decayScore(755, hours(7))).toBeGreaterThan(decayScore(8, hours(2)));
  });

  it("score drops significantly after 4 hours", () => {
    const now = decayScore(10, Date.now());
    const fourHoursAgo = decayScore(10, hours(4));
    expect(fourHoursAgo).toBeLessThan(now * 0.6);
  });

  it("score difference between 7 and 14 days is small relative to 0-7 day drop", () => {
    const now = decayScore(50, Date.now());
    const sevenDays = decayScore(50, days(7));
    const fourteenDays = decayScore(50, days(14));
    const firstWeekDrop = now - sevenDays;
    const secondWeekDrop = sevenDays - fourteenDays;
    expect(secondWeekDrop).toBeLessThan(firstWeekDrop);
  });

  it("30 day old page scores near zero", () => {
    expect(decayScore(50, days(30))).toBeLessThan(20);
  });
});

describe("scoring scenarios", () => {
  // Scenario 1: recently opened page beats old frequent page
  it("3 visits just now beats 50 visits from a week ago", () => {
    const recent = decayScore(3, Date.now());
    const oldFrequent = decayScore(50, days(7));
    expect(recent).toBeGreaterThan(oldFrequent);
  });

  // Scenario 2: frequent page from today still beats rare recent page
  it("50 visits 4h ago beats 3 visits 10 min ago", () => {
    const frequent = decayScore(50, hours(4));
    const rare = decayScore(3, Date.now() - 10 * 60 * 1000);
    expect(frequent).toBeGreaterThan(rare);
  });

  // Scenario 3: single visit just now beats 10 visits from 3 days ago
  it("1 visit just now beats 10 visits from 3 days ago", () => {
    const justNow = decayScore(1, Date.now());
    const threeDaysAgo = decayScore(10, days(3));
    expect(justNow).toBeGreaterThan(threeDaysAgo);
  });

  // Scenario 4: open tab beats same page without tab open
  it("open tab bonus gives edge over same history page", () => {
    const withTab = decayScore(5, hours(2)) + TAB_BONUS;
    const withoutTab = decayScore(5, hours(2));
    expect(withTab).toBeGreaterThan(withoutTab);
  });

  // Scenario 5: bookmark doesn't save a stale page
  it("stale bookmark loses to single visit today", () => {
    const staleBookmark = decayScore(0, null) + BOOKMARK_BONUS;
    const visitToday = decayScore(1, hours(1));
    expect(visitToday).toBeGreaterThan(staleBookmark);
  });

  // Scenario 6: bookmarked + visited page gets a small edge
  it("bookmark bonus gives edge between similar pages", () => {
    const withBookmark = decayScore(5, hours(2)) + BOOKMARK_BONUS;
    const withoutBookmark = decayScore(5, hours(2));
    expect(withBookmark).toBeGreaterThan(withoutBookmark);
    expect(withBookmark - withoutBookmark).toBe(BOOKMARK_BONUS);
  });

  // Scenario 7: the original bug — 19 visits just opened vs 33 visits hours ago
  it("19 visits just opened beats 33 visits from 4 hours ago", () => {
    const justOpened = decayScore(19, Date.now());
    const hoursAgo = decayScore(33, hours(4));
    expect(justOpened).toBeGreaterThan(hoursAgo);
  });

  // Scenario 8: daily tool open in tab dominates everything
  it("daily tool in open tab ranks highest", () => {
    const dailyTool = decayScore(50, Date.now()) + TAB_BONUS + BOOKMARK_BONUS;
    const recentVisit = decayScore(5, Date.now());
    const oldFrequent = decayScore(50, days(3));
    expect(dailyTool).toBeGreaterThan(recentVisit);
    expect(dailyTool).toBeGreaterThan(oldFrequent);
  });
});

describe("mergeResults", () => {
  const makeResult = (type: SearchResult["type"], url: string, score: number, title = "Test"): SearchResult => ({
    type, title, url, score,
  });

  it("sets categoryLabel and categoryColor for pattern plugin results", () => {
    const plugin: FilterPlugin = { name: "Pipeline", prefix: "p", pluginType: "filter", patterns: ["ci.example.com"], color: "#f38ba8" };
    const results = mergeResults([], [], [makeResult("history", "https://ci.example.com/foo", 50)], plugin, "foo");
    expect(results[0]!.categoryLabel).toBe("Pipeline");
    expect(results[0]!.categoryColor).toBe("#f38ba8");
  });

  it("sets categoryLabel and categoryColor for search plugin results", () => {
    const plugin: TemplatePlugin = { name: "CodeSearch", prefix: "cs", pluginType: "template", url: "https://grep.app/search?q={}", color: "#fab387" };
    const results = mergeResults([], [], [makeResult("history", "https://grep.app/search?q=test", 50)], plugin, null);
    expect(results[0]!.categoryLabel).toBe("CodeSearch");
    expect(results[0]!.categoryColor).toBe("#fab387");
  });

  it("does not set category fields when no plugin", () => {
    const results = mergeResults([makeResult("tab", "https://example.com", 100)], [], [], null, "example");
    expect(results[0]!.categoryLabel).toBeUndefined();
  });

  it("filters by pattern plugin", () => {
    const plugin: FilterPlugin = { name: "P", prefix: "p", pluginType: "filter", patterns: ["github.com"], color: "#f00" };
    const results = mergeResults([], [], [
      makeResult("history", "https://github.com/repo", 50),
      makeResult("history", "https://gitlab.com/repo", 40),
    ], plugin, "repo");
    expect(results).toHaveLength(1);
  });

  it("deduplicates and combines scores", () => {
    const results = mergeResults(
      [makeResult("tab", "https://example.com", TAB_BONUS)],
      [makeResult("bookmark", "https://example.com", BOOKMARK_BONUS)],
      [makeResult("history", "https://example.com", 80)],
      null, "example",
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(TAB_BONUS + BOOKMARK_BONUS + 80);
  });

  it("does not double-count tab or bookmark bonus", () => {
    const results = mergeResults(
      [makeResult("tab", "https://a.com", TAB_BONUS), makeResult("tab", "https://a.com?v=2", TAB_BONUS)],
      [makeResult("bookmark", "https://a.com", BOOKMARK_BONUS), makeResult("bookmark", "https://a.com?v=3", BOOKMARK_BONUS)],
      [makeResult("history", "https://a.com", 80)],
      null, "a",
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(TAB_BONUS + BOOKMARK_BONUS + 80);
  });

  it("deduplicates URLs that differ only by query params", () => {
    const results = mergeResults([], [], [
      makeResult("history", "https://example.com/page?a=1", 50),
      makeResult("history", "https://example.com/page?b=2", 30),
    ], null, "page");
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(50); // first variant wins, no double-counting
  });

  it("sorts by score descending and caps at 20", () => {
    const items = Array.from({ length: 25 }, (_, i) => makeResult("history", `https://example.com/${i}`, i));
    const results = mergeResults([], [], items, null, null);
    expect(results).toHaveLength(20);
    expect(results[0]!.score).toBe(24);
  });

  it("filters out non-matching items in pattern plugin with query", () => {
    const plugin: FilterPlugin = { name: "P", prefix: "p", pluginType: "filter", patterns: ["github.com/**"], color: "#f00" };
    const results = mergeResults([], [], [
      makeResult("history", "https://github.com/match", 50),
      { ...makeResult("history", "https://github.com/other", 40), title: "Unrelated" },
    ], plugin, "match");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://github.com/match");
  });

  it("adds bookmark bonus on duplicate", () => {
    const results = mergeResults(
      [], [makeResult("bookmark", "https://a.com", BOOKMARK_BONUS)],
      [makeResult("history", "https://a.com", 80)], null, "a",
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(80 + BOOKMARK_BONUS);
  });

  it("carries visitCount from duplicate history entry", () => {
    const h1 = { ...makeResult("history", "https://a.com?v=1", 50), visitCount: 10, lastVisitTime: 1000 };
    const h2 = { ...makeResult("history", "https://a.com?v=2", 30), visitCount: 20, lastVisitTime: 2000 };
    const results = mergeResults([], [], [h1, h2], null, "a");
    expect(results).toHaveLength(1);
    expect(results[0]!.visitCount).toBe(20);
    expect(results[0]!.lastVisitTime).toBe(2000);
  });

  it("does not double-count bookmark bonus from duplicate bookmarks", () => {
    const results = mergeResults(
      [], [makeResult("bookmark", "https://a.com?x=1", BOOKMARK_BONUS), makeResult("bookmark", "https://a.com?x=2", BOOKMARK_BONUS)],
      [], null, "a",
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(BOOKMARK_BONUS);
  });
});

describe("urlKey", () => {
  it("strips query params and hash", () => {
    expect(urlKey("https://example.com/page?a=1&b=2")).toBe("https://example.com/page");
    expect(urlKey("https://example.com/page#section")).toBe("https://example.com/page");
  });
  it("preserves origin and pathname", () => {
    expect(urlKey("https://github.com/user/repo")).toBe("https://github.com/user/repo");
  });
  it("returns raw string for invalid URLs", () => {
    expect(urlKey("not-a-url")).toBe("not-a-url");
  });
});

describe("validateConfig", () => {
  it("returns defaults for null/undefined", () => {
    expect(validateConfig(null).plugins).toEqual([]);
  });
  it("stamps the current schema version", () => {
    expect(validateConfig(null).schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(validateConfig({ prefixes: {} }).schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
  });
  it("preserves valid fields and fills missing", () => {
    const c = validateConfig({ prefixes: { history: "hist" } });
    expect(c.prefixes.history).toBe("hist");
    expect(c.prefixes.tabs).toBe("t");
  });
  it("filters out invalid plugins", () => {
    const c = validateConfig({ plugins: [
      { name: "Good", prefix: "g", pluginType: "filter", patterns: ["x.com"], color: "#f00" },
      { name: "", prefix: "bad", pluginType: "filter" },
      null,
    ] });
    expect(c.plugins).toHaveLength(1);
  });
  it("uses default sourceColors when value is not an object", () => {
    const c = validateConfig({ sourceColors: "invalid" });
    expect(c.sourceColors).toEqual({ tabs: "#89b4fa", bookmarks: "#f9e2af", history: "#a6e3a1" });
  });
  it("merges custom sourceColors with defaults", () => {
    const c = validateConfig({ sourceColors: { tabs: "#ff0000" } });
    expect(c.sourceColors.tabs).toBe("#ff0000");
    expect(c.sourceColors.bookmarks).toBe("#f9e2af");
  });
});

// ── Cache layer tests ──

describe("mergeHistoryCache", () => {
  it("adds new entries by exact URL", () => {
    const cache = new Map<string, HistoryEntry>();
    mergeHistoryCache(cache, [
      { url: "https://a.com/page?x=1", title: "A1", visitCount: 5, lastVisitTime: 1000 },
      { url: "https://a.com/page?x=2", title: "A2", visitCount: 3, lastVisitTime: 2000 },
    ]);
    expect(cache.size).toBe(2); // separate entries, not deduped
  });

  it("updates entry when incoming is newer", () => {
    const cache = new Map<string, HistoryEntry>();
    mergeHistoryCache(cache, [{ url: "https://a.com", title: "Old", visitCount: 5, lastVisitTime: 1000 }]);
    mergeHistoryCache(cache, [{ url: "https://a.com", title: "New", visitCount: 8, lastVisitTime: 2000 }]);
    expect(cache.size).toBe(1);
    expect(cache.get("https://a.com")!.title).toBe("New");
    expect(cache.get("https://a.com")!.visitCount).toBe(8);
  });

  it("keeps existing entry when incoming is older", () => {
    const cache = new Map<string, HistoryEntry>();
    mergeHistoryCache(cache, [{ url: "https://a.com", title: "New", visitCount: 8, lastVisitTime: 2000 }]);
    mergeHistoryCache(cache, [{ url: "https://a.com", title: "Old", visitCount: 5, lastVisitTime: 1000 }]);
    expect(cache.get("https://a.com")!.title).toBe("New");
    expect(cache.get("https://a.com")!.visitCount).toBe(8);
  });

  it("skips entries without url or title", () => {
    const cache = new Map<string, HistoryEntry>();
    mergeHistoryCache(cache, [{ url: "", title: "X" }, { url: "https://a.com", title: "" }]);
    expect(cache.size).toBe(0);
  });
  it("defaults visitCount and lastVisitTime to 0 when missing", () => {
    const cache = new Map<string, HistoryEntry>();
    mergeHistoryCache(cache, [{ url: "https://a.com", title: "A" }]);
    expect(cache.get("https://a.com")).toEqual({ url: "https://a.com", title: "A", visitCount: 0, lastVisitTime: 0 });
  });
  it("updates entry when new item has no lastVisitTime and prev exists", () => {
    const cache = new Map<string, HistoryEntry>();
    mergeHistoryCache(cache, [{ url: "https://a.com", title: "Old", visitCount: 5, lastVisitTime: 0 }]);
    mergeHistoryCache(cache, [{ url: "https://a.com", title: "New", visitCount: 8 }]);
    expect(cache.get("https://a.com")!.title).toBe("New");
  });
});

// ── Query layer tests ──

describe("queryHistory", () => {
  const now = Date.now();
  const cache = new Map<string, HistoryEntry>();
  cache.set("https://a.com/page?x=1", { url: "https://a.com/page?x=1", title: "Page v1", visitCount: 10, lastVisitTime: now - 4 * 3600000 });
  cache.set("https://a.com/page?x=2", { url: "https://a.com/page?x=2", title: "Page v2", visitCount: 10, lastVisitTime: now - 1 * 3600000 });
  cache.set("https://b.com", { url: "https://b.com", title: "Other", visitCount: 5, lastVisitTime: now - 3600000 });

  it("deduplicates by urlKey, highest score wins", () => {
    const results = queryHistory(cache, "page");
    expect(results).toHaveLength(1);
    // x=2 visited more recently, so it wins
    expect(results[0]!.url).toBe("https://a.com/page?x=2");
  });

  it("filters by query", () => {
    const results = queryHistory(cache, "other");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://b.com");
  });

  it("returns all for empty query", () => {
    const results = queryHistory(cache, "");
    expect(results).toHaveLength(2); // a.com/page deduped, b.com separate
  });
});

describe("queryBookmarks", () => {
  const items = [
    { url: "https://a.com/page?v=1", title: "A" },
    { url: "https://a.com/page?v=2", title: "A2" },
    { url: "https://b.com", title: "B" },
  ];

  it("deduplicates by urlKey", () => {
    expect(queryBookmarks(items, "")).toHaveLength(2);
  });

  it("filters by query", () => {
    expect(queryBookmarks(items, "B")).toHaveLength(1);
  });
});

describe("queryTabs", () => {
  const items = [
    { url: "https://a.com", title: "Alpha Page", tabId: 1, windowId: 1 },
    { url: "https://b.com", title: "Beta Page", tabId: 2, windowId: 1 },
  ];

  it("filters by query", () => {
    expect(queryTabs(items, "Alpha")).toHaveLength(1);
  });

  it("returns all for empty query", () => {
    expect(queryTabs(items, "")).toHaveLength(2);
  });

  it("preserves tabId and windowId", () => {
    const results = queryTabs(items, "");
    expect(results[0]!.tabId).toBe(1);
  });
});

describe("fuzzyMatch", () => {
  it("matches exact substring", () => {
    expect(fuzzyMatch("GitHub Repository", "github")).toBeGreaterThan(0);
  });
  it("matches multiple words", () => {
    expect(fuzzyMatch("workspace/examples/a-example-pkg", "work pkg")).toBeGreaterThan(0);
  });
  it("returns 0 when a term is missing", () => {
    expect(fuzzyMatch("GitHub", "xyz")).toBe(0);
  });
  it("returns 0 when one of multiple terms is missing", () => {
    expect(fuzzyMatch("GitHub Repository", "github xyz")).toBe(0);
  });
  it("scores word-boundary matches higher", () => {
    const boundary = fuzzyMatch("my-project", "pro");
    const mid = fuzzyMatch("reproduce", "pro");
    expect(boundary).toBeGreaterThan(mid);
  });
  it("is case insensitive", () => {
    expect(fuzzyMatch("GitHub", "github")).toBeGreaterThan(0);
  });
});

describe("textMatch", () => {
  it("matches terms split across title and url", () => {
    expect(textMatch("hello page", "https://example.com/world", "hello world")).toBeGreaterThan(0);
  });
  it("still matches when all terms are in title only", () => {
    expect(textMatch("hello world page", "https://example.com", "hello world")).toBeGreaterThan(0);
  });
  it("returns 0 when a term is in neither", () => {
    expect(textMatch("hello page", "https://example.com", "hello world")).toBe(0);
  });
});

describe("truncateUrl", () => {
  it("returns full URL unchanged", () => {
    expect(truncateUrl("https://github.com/user/repo")).toBe("https://github.com/user/repo");
  });
  it("returns raw string for invalid URLs", () => {
    expect(truncateUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("computeExpression", () => {
  it("evaluates basic arithmetic", () => {
    expect(computeExpression("2 + 3")).toBe("5");
    expect(computeExpression("10 * 5")).toBe("50");
    expect(computeExpression("100 / 4")).toBe("25");
  });
  it("handles exponents via ^", () => {
    expect(computeExpression("2^10")).toBe("1024");
  });
  it("handles percentages", () => {
    expect(computeExpression("15% * 200")).toBe("30");
  });
  it("returns null for invalid input", () => {
    expect(computeExpression("")).toBeNull();
    expect(computeExpression("hello")).toBeNull();
    expect(computeExpression("alert(1)")).toBeNull();
  });
  it("returns null for non-finite results", () => {
    expect(computeExpression("1/0")).toBeNull();
  });
  it("returns decimal result trimmed", () => {
    expect(computeExpression("1 / 3")).toBe("0.3333333333");
  });
  it("returns null for expressions that throw", () => {
    expect(computeExpression(")(")).toBeNull();
  });
  it("handles subtraction", () => {
    expect(computeExpression("10 - 3")).toBe("7");
    expect(computeExpression("10 - 3 - 2")).toBe("5");
  });
  it("handles chained division", () => {
    expect(computeExpression("100 / 2 / 5")).toBe("10");
  });
  it("handles unary negation", () => {
    expect(computeExpression("-5 + 3")).toBe("-2");
  });
});

describe("validateConfig rejects / prefixes", () => {
  it("filters out plugins with / prefix", () => {
    const config = validateConfig({
      plugins: [
        { name: "Good", prefix: "g", pluginType: "template", url: "http://x.com?q={}", color: "#fff" },
        { name: "Bad", prefix: "/bad", pluginType: "template", url: "http://x.com?q={}", color: "#fff" },
      ],
    });
    expect(config.plugins).toHaveLength(1);
    expect(config.plugins[0]!.name).toBe("Good");
  });
});

describe("suggestGhost", () => {
  const entries = [
    { url: "https://github.com/user/repo", visitCount: 10 },
    { url: "https://github.com/user/other", visitCount: 5 },
    { url: "https://www.google.com/search", visitCount: 20 },
    { url: "https://example.com/page", visitCount: 0 },
  ];

  it("suggests url suffix for prefix match", () => {
    expect(suggestGhost("github.com/user/r", entries)).toBe("epo");
  });

  it("strips protocol for matching", () => {
    // both github URLs share github.com/user/ then diverge
    expect(suggestGhost("github", entries)).toBe(".com/user/");
  });

  it("strips www for matching", () => {
    // single match → full URL
    expect(suggestGhost("google", entries)).toBe(".com/search");
  });

  it("falls back to empty when prefix exhausted", () => {
    // github.com/user/ then r vs o → no common prefix → empty
    expect(suggestGhost("github.com/user/", entries)).toBe("");
  });

  it("returns empty for no match", () => {
    expect(suggestGhost("zzz", entries)).toBe("");
  });

  it("returns empty for short query", () => {
    expect(suggestGhost("g", entries)).toBe("");
  });

  it("case insensitive", () => {
    expect(suggestGhost("GitHub", entries)).toBe(".com/user/");
  });

  it("no suggestion when candidates diverge immediately", () => {
    const mixed = [
      { url: "https://example.com/page", visitCount: 0 },
      { url: "https://example.com/better", visitCount: 3 },
    ];
    expect(suggestGhost("example.com/", mixed)).toBe("");
  });

  it("common prefix stops at divergence point", () => {
    const yt = [
      { url: "https://www.youtube.com/watch?v=aaa", visitCount: 20 },
      { url: "https://www.youtube.com/watch?v=bbb", visitCount: 15 },
      { url: "https://www.youtube.com/shorts/ccc", visitCount: 10 },
    ];
    // all share youtube.com/ then watch vs shorts diverge
    expect(suggestGhost("you", yt)).toBe("tube.com/");
  });

  it("single candidate suggests full remaining URL", () => {
    expect(suggestGhost("example", [{ url: "https://example.com/page", visitCount: 1 }])).toBe(".com/page");
  });

  it("progressive narrowing works", () => {
    const entries = [
      { url: "https://code.test.com/reviews/CR-111", visitCount: 30 },
      { url: "https://code.test.com/reviews/CR-222", visitCount: 20 },
      { url: "https://code.test.com/packages/Foo", visitCount: 15 },
    ];
    // Step 1: type "code." → common prefix is "code.test.com/"
    expect(suggestGhost("code.", entries)).toBe("test.com/");
    // Step 2: accept, now query is "code.test.com/" → diverge at r vs p → empty
    expect(suggestGhost("code.test.com/", entries)).toBe("");
    // Step 3: type "r" → 2 review URLs share "reviews/CR-"
    expect(suggestGhost("code.test.com/r", entries)).toBe("eviews/cr-");
    // Step 4: accept, type "1" → single candidate
    expect(suggestGhost("code.test.com/reviews/cr-1", entries)).toBe("11");
  });

  it("handles protocol in query", () => {
    expect(suggestGhost("https://github", [
      { url: "https://github.com/user/repo", visitCount: 10 },
    ])).toBe(".com/user/repo");
  });

  it("duplicate URLs do not affect result", () => {
    const dupes = [
      { url: "https://example.com/page", visitCount: 5 },
      { url: "https://example.com/page", visitCount: 3 },
    ];
    expect(suggestGhost("example", dupes)).toBe(".com/page");
  });


describe("filterBookmarks", () => {
  it("keeps entries with url and title", () => {
    expect(filterBookmarks([{ url: "https://a.com", title: "A" }])).toEqual([{ url: "https://a.com", title: "A" }]);
  });
  it("drops entries missing url or title (folders)", () => {
    expect(filterBookmarks([{ title: "folder" }, { url: "https://b.com" }, { url: "https://c.com", title: "C" }]))
      .toEqual([{ url: "https://c.com", title: "C" }]);
  });
});

describe("filterTabs", () => {
  it("maps id/windowId to tabId/windowId", () => {
    expect(filterTabs([{ id: 5, windowId: 2, title: "T", url: "https://t.com" }]))
      .toEqual([{ url: "https://t.com", title: "T", tabId: 5, windowId: 2 }]);
  });
  it("drops tabs missing required fields", () => {
    expect(filterTabs([{ id: 1, title: "no window", url: "https://x.com" }, { windowId: 2, title: "no id", url: "https://y.com" }]))
      .toEqual([]);
  });
  it("keeps tab with id 0 (falsy but valid)", () => {
    expect(filterTabs([{ id: 0, windowId: 0, title: "T", url: "https://z.com" }]))
      .toEqual([{ url: "https://z.com", title: "T", tabId: 0, windowId: 0 }]);
  });
});

describe("loadCaches", () => {
  const fakePort: BrowserDataPort = {
    searchHistory: async () => [{ url: "https://h.com", title: "H", visitCount: 3, lastVisitTime: 100 }],
    getRecentBookmarks: async () => [{ url: "https://b.com", title: "B" }, { title: "folder" }],
    queryTabs: async () => [{ id: 1, windowId: 1, title: "T", url: "https://t.com" }],
  };
  it("fetches through the port, merges history, returns filtered caches", async () => {
    const history = new Map<string, HistoryEntry>();
    const { bookmarks, tabs } = await loadCaches(fakePort, history);
    expect(history.get("https://h.com")).toEqual({ url: "https://h.com", title: "H", visitCount: 3, lastVisitTime: 100 });
    expect(bookmarks).toEqual([{ url: "https://b.com", title: "B" }]);
    expect(tabs).toEqual([{ url: "https://t.com", title: "T", tabId: 1, windowId: 1 }]);
  });
});

describe("serializeCaches / applySnapshot", () => {
  it("round-trips caches through a snapshot", () => {
    const history = new Map<string, HistoryEntry>([
      ["https://h.com", { url: "https://h.com", title: "H", visitCount: 2, lastVisitTime: 50 }],
    ]);
    const bookmarks = [{ url: "https://b.com", title: "B" }];
    const tabs = [{ url: "https://t.com", title: "T", tabId: 1, windowId: 1 }];
    const snapshot = serializeCaches(history, bookmarks, tabs);

    const restored = new Map<string, HistoryEntry>();
    const { bookmarks: rb, tabs: rt } = applySnapshot(snapshot, restored);
    expect([...restored.values()]).toEqual([...history.values()]);
    expect(rb).toEqual(bookmarks);
    expect(rt).toEqual(tabs);
  });
});
});
describe("shouldSearch", () => {
  it("suppresses an empty bare query", () => {
    expect(shouldSearch("", false)).toBe(false);
  });

  it("searches a single-character bare query", () => {
    expect(shouldSearch("e", false)).toBe(true);
  });

  it("searches a multi-character bare query", () => {
    expect(shouldSearch("example", false)).toBe(true);
  });

  it("searches an empty query when a prefix is present", () => {
    expect(shouldSearch("", true)).toBe(true);
  });

  it("MIN_QUERY_LENGTH is 1 (dropdown shows from the first char)", () => {
    expect(MIN_QUERY_LENGTH).toBe(1);
    expect(shouldSearch("x".repeat(MIN_QUERY_LENGTH), false)).toBe(true);
    expect(shouldSearch("x".repeat(MIN_QUERY_LENGTH - 1), false)).toBe(false);
  });
});
