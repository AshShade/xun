import { describe, it, expect } from "vitest";
import { globMatch, matchesPlugin, parseQuery, decayScore, TAB_BONUS, BOOKMARK_BONUS, mergeResults, urlKey, validateConfig, mergeHistoryCache, queryHistory, queryBookmarks, queryTabs } from "./lib";
import type { Config, HistoryEntry, PatternPlugin, SearchPlugin, SearchResult } from "./types";

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
  const plugin: PatternPlugin = { name: "P", prefix: "p", pluginType: "pattern", patterns: ["github.com"], color: "#f00" };
  it("matches URL against plugin patterns", () => {
    expect(matchesPlugin("https://github.com/user/repo", plugin)).toBe(true);
    expect(matchesPlugin("https://gitlab.com/user/repo", plugin)).toBe(false);
  });
  it("returns true when no plugin", () => {
    expect(matchesPlugin("https://anything.com", null)).toBe(true);
  });
});

describe("parseQuery", () => {
  const config: Config = {
    prefixes: { history: "h", tabs: "t", bookmarks: "b" },
    sourceColors: {}, searchEngine: "", plugins: [
      { name: "P", prefix: "p", pluginType: "pattern", patterns: [], color: "#f00" },
      { name: "S", prefix: "cs", pluginType: "search", url: "https://s.com?q=%s", color: "#0f0" },
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
});

const hours = (h: number) => Date.now() - h * 60 * 60 * 1000;
const days = (d: number) => hours(d * 24);

describe("decayScore", () => {
  it("returns 0 for no visits", () => { expect(decayScore(0, Date.now())).toBe(0); });
  it("returns 0 for null lastVisitTime", () => { expect(decayScore(10, null)).toBe(0); });

  // Scenario: page just opened should rank high
  it("just visited page scores high", () => {
    expect(decayScore(5, Date.now())).toBeGreaterThan(400);
  });

  // Scenario: decay is steep in first few hours
  it("score drops significantly after 4 hours", () => {
    const now = decayScore(10, Date.now());
    const fourHoursAgo = decayScore(10, hours(4));
    expect(fourHoursAgo).toBeLessThan(now * 0.6);
  });

  // Scenario: decay flattens after a week (difference shrinks)
  it("score difference between 7 and 14 days is small relative to 0-7 day drop", () => {
    const now = decayScore(50, Date.now());
    const sevenDays = decayScore(50, days(7));
    const fourteenDays = decayScore(50, days(14));
    const firstWeekDrop = now - sevenDays;
    const secondWeekDrop = sevenDays - fourteenDays;
    expect(secondWeekDrop).toBeLessThan(firstWeekDrop);
  });

  // Scenario: 30 days ago is basically zero
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
    const plugin: PatternPlugin = { name: "Pipeline", prefix: "p", pluginType: "pattern", patterns: ["ci.example.com"], color: "#f38ba8" };
    const results = mergeResults([], [], [makeResult("history", "https://ci.example.com/foo", 50)], plugin, "foo");
    expect(results[0]!.categoryLabel).toBe("Pipeline");
    expect(results[0]!.categoryColor).toBe("#f38ba8");
  });

  it("sets categoryLabel and categoryColor for search plugin results", () => {
    const plugin: SearchPlugin = { name: "CodeSearch", prefix: "cs", pluginType: "search", url: "https://grep.app/search?q=%s", color: "#fab387" };
    const results = mergeResults([], [], [makeResult("history", "https://grep.app/search?q=test", 50)], plugin, null);
    expect(results[0]!.categoryLabel).toBe("CodeSearch");
    expect(results[0]!.categoryColor).toBe("#fab387");
  });

  it("does not set category fields when no plugin", () => {
    const results = mergeResults([makeResult("tab", "https://example.com", 100)], [], [], null, "example");
    expect(results[0]!.categoryLabel).toBeUndefined();
  });

  it("filters by pattern plugin", () => {
    const plugin: PatternPlugin = { name: "P", prefix: "p", pluginType: "pattern", patterns: ["github.com"], color: "#f00" };
    const results = mergeResults([], [], [
      makeResult("history", "https://github.com/repo", 50),
      makeResult("history", "https://gitlab.com/repo", 40),
    ], plugin, "repo");
    expect(results).toHaveLength(1);
  });

  it("deduplicates and combines scores", () => {
    const results = mergeResults(
      [makeResult("tab", "https://example.com", 100)],
      [makeResult("bookmark", "https://example.com", 50)],
      [makeResult("history", "https://example.com", 30)],
      null, "example",
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(180);
  });

  it("deduplicates URLs that differ only by query params", () => {
    const results = mergeResults([], [], [
      makeResult("history", "https://example.com/page?a=1", 50),
      makeResult("history", "https://example.com/page?b=2", 30),
    ], null, "page");
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(80);
  });

  it("sorts by score descending and caps at 20", () => {
    const items = Array.from({ length: 25 }, (_, i) => makeResult("history", `https://example.com/${i}`, i));
    const results = mergeResults([], [], items, null, null);
    expect(results).toHaveLength(20);
    expect(results[0]!.score).toBe(24);
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
    expect(validateConfig(undefined).searchEngine).toContain("google");
  });
  it("preserves valid fields and fills missing", () => {
    const c = validateConfig({ prefixes: { history: "hist" } });
    expect(c.prefixes.history).toBe("hist");
    expect(c.prefixes.tabs).toBe("t");
  });
  it("filters out invalid plugins", () => {
    const c = validateConfig({ plugins: [
      { name: "Good", prefix: "g", pluginType: "pattern", patterns: ["x.com"], color: "#f00" },
      { name: "", prefix: "bad", pluginType: "pattern" },
      null,
    ] });
    expect(c.plugins).toHaveLength(1);
  });
  it("migrates old categories to plugins", () => {
    const c = validateConfig({ categories: [{ name: "W", prefix: "w", pluginType: "pattern", patterns: [], color: "#f00" }] });
    expect(c.plugins).toHaveLength(1);
  });
  it("prefers plugins over categories", () => {
    const c = validateConfig({
      plugins: [{ name: "A", prefix: "a", pluginType: "search", url: "https://a.com?q=%s", color: "#f00" }],
      categories: [{ name: "B", prefix: "b", pluginType: "pattern", patterns: [], color: "#0f0" }],
    });
    expect(c.plugins[0]!.name).toBe("A");
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
});

// ── Query layer tests ──

describe("queryHistory", () => {
  const now = Date.now();
  const cache = new Map<string, HistoryEntry>();
  cache.set("https://a.com/page?x=1", { url: "https://a.com/page?x=1", title: "Page v1", visitCount: 10, lastVisitTime: now - 2 * 3600000 });
  cache.set("https://a.com/page?x=2", { url: "https://a.com/page?x=2", title: "Page v2", visitCount: 20, lastVisitTime: now - 2 * 3600000 });
  cache.set("https://b.com", { url: "https://b.com", title: "Other", visitCount: 5, lastVisitTime: now - 3600000 });

  it("deduplicates by urlKey, highest score wins", () => {
    const results = queryHistory(cache, "page");
    expect(results).toHaveLength(1);
    // visitCount 20 > 10 at same lastVisitTime, so ?x=2 variant wins
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
    { url: "https://a.com", title: "Tab A", tabId: 1, windowId: 1 },
    { url: "https://b.com", title: "Tab B", tabId: 2, windowId: 1 },
  ];

  it("filters by query", () => {
    expect(queryTabs(items, "Tab A")).toHaveLength(1);
  });

  it("returns all for empty query", () => {
    expect(queryTabs(items, "")).toHaveLength(2);
  });

  it("preserves tabId and windowId", () => {
    const results = queryTabs(items, "");
    expect(results[0]!.tabId).toBe(1);
  });
});
