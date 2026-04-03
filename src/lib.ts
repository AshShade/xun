import type { BookmarkEntry, Config, HistoryEntry, ParsedQuery, Plugin, SearchResult, TabEntry } from "./types";

export function globMatch(str: string, pattern: string): boolean {
  if (!pattern.includes("/")) pattern += "/**";
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^./]*")
    .replace(/\0/g, ".*");
  try {
    return new RegExp("^" + re + "$", "i").test(str);
  } catch {
    return false;
  }
}

export function matchesPlugin(url: string, plugin: Plugin | null | undefined): boolean {
  if (!plugin || !("patterns" in plugin) || !plugin.patterns.length) return true;
  try {
    const u = new URL(url);
    const bare = u.hostname + u.pathname;
    return plugin.patterns.some((p) => globMatch(bare, p));
  } catch {
    return false;
  }
}

export function parseQuery(raw: string, config: Config): ParsedQuery {
  const words = raw.split(" ");
  const firstWord = words[0];
  const rest = words.slice(1).join(" ").trim();

  for (const plugin of config.plugins ?? []) {
    if (plugin.prefix && firstWord === plugin.prefix) {
      return { query: rest, source: null, plugin };
    }
  }
  for (const [source, prefix] of Object.entries(config.prefixes)) {
    if (firstWord === prefix) {
      return { query: rest, source, plugin: null };
    }
  }
  return { query: raw, source: null, plugin: null };
}

export function recencyBoost(lastVisitTime: number | null | undefined): number {
  if (!lastVisitTime) return 0;
  const hoursAgo = (Date.now() - lastVisitTime) / (1000 * 60 * 60);
  if (hoursAgo < 1) return 50;
  if (hoursAgo < 4) return 40;
  if (hoursAgo < 24) return 30;
  if (hoursAgo < 72) return 20;
  if (hoursAgo < 168) return 10;
  return 0;
}

export function historyScore(visitCount: number | null | undefined, lastVisitTime: number | null | undefined): number {
  return Math.min(visitCount ?? 0, 50) * 2 + recencyBoost(lastVisitTime);
}

const DEFAULT_CONFIG: Config = {
  prefixes: { history: "h", tabs: "t", bookmarks: "b" },
  sourceColors: { tabs: "#89b4fa", bookmarks: "#f9e2af", history: "#a6e3a1" },
  searchEngine: "https://www.google.com/search?q=%s",
  plugins: [],
};

export function validateConfig(raw: unknown): Config {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  const obj = raw as Record<string, unknown>;

  const prefixes = (typeof obj["prefixes"] === "object" && obj["prefixes"] !== null)
    ? { ...DEFAULT_CONFIG.prefixes, ...(obj["prefixes"] as Record<string, string>) }
    : { ...DEFAULT_CONFIG.prefixes };

  const sourceColors = (typeof obj["sourceColors"] === "object" && obj["sourceColors"] !== null)
    ? { ...DEFAULT_CONFIG.sourceColors, ...(obj["sourceColors"] as Record<string, string>) }
    : { ...DEFAULT_CONFIG.sourceColors };

  const searchEngine = typeof obj["searchEngine"] === "string" && obj["searchEngine"]
    ? obj["searchEngine"]
    : DEFAULT_CONFIG.searchEngine;

  const rawPlugins = Array.isArray(obj["plugins"]) ? obj["plugins"] : (Array.isArray(obj["categories"]) ? obj["categories"] : []);
  const plugins: Plugin[] = rawPlugins.filter((p: unknown): p is Plugin => {
    if (!p || typeof p !== "object") return false;
    const pl = p as Record<string, unknown>;
    return !!pl["name"] && typeof pl["name"] === "string" && !!pl["prefix"] && typeof pl["prefix"] === "string"
      && (pl["pluginType"] === "pattern" || pl["pluginType"] === "search");
  });

  return { prefixes, sourceColors, searchEngine, plugins };
}

export { DEFAULT_CONFIG };

export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

// ── Cache layer: thin wrapper over browser API data, keyed by exact URL ──

export function mergeHistoryCache(existing: Map<string, HistoryEntry>, items: Array<{ url?: string; title?: string; visitCount?: number; lastVisitTime?: number }>): void {
  for (const h of items) {
    if (!h.url || !h.title) continue;
    const prev = existing.get(h.url);
    if (!prev || (h.lastVisitTime ?? 0) >= prev.lastVisitTime) {
      existing.set(h.url, { url: h.url, title: h.title, visitCount: h.visitCount ?? 0, lastVisitTime: h.lastVisitTime ?? 0 });
    }
  }
}

// ── Query layer: scoring, dedup by urlKey, filtering ──

export function queryHistory(cache: Map<string, HistoryEntry>, query: string): SearchResult[] {
  // Dedup by urlKey — highest scoring variant wins
  const grouped = new Map<string, SearchResult>();
  for (const entry of cache.values()) {
    if (query && !entry.title.toLowerCase().includes(query.toLowerCase()) && !urlKey(entry.url).toLowerCase().includes(query.toLowerCase())) continue;
    const key = urlKey(entry.url);
    const score = historyScore(entry.visitCount, entry.lastVisitTime);
    const prev = grouped.get(key);
    if (!prev || score > prev.score) {
      grouped.set(key, { type: "history", title: entry.title, url: entry.url, score });
    }
  }
  return [...grouped.values()];
}

export function queryBookmarks(items: BookmarkEntry[], query: string): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const b of items) {
    if (query && !b.title.toLowerCase().includes(query.toLowerCase()) && !urlKey(b.url).toLowerCase().includes(query.toLowerCase())) continue;
    const key = urlKey(b.url);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ type: "bookmark", title: b.title, url: b.url, score: 50 });
  }
  return results;
}

export function queryTabs(items: TabEntry[], query: string): SearchResult[] {
  return items.filter((t) =>
    !query || t.title.toLowerCase().includes(query.toLowerCase()) || urlKey(t.url).toLowerCase().includes(query.toLowerCase())
  ).map((t) => ({ type: "tab" as const, title: t.title, url: t.url, tabId: t.tabId, windowId: t.windowId, score: 100 }));
}

export function mergeResults(
  tabResults: SearchResult[],
  bookmarkResults: SearchResult[],
  historyResults: SearchResult[],
  plugin: Plugin | null,
  query: string | null,
): SearchResult[] {
  const isPatternPlugin = plugin !== null && plugin.pluginType === "pattern";
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  const q = query ? query.toLowerCase() : null;

  for (const item of [...tabResults, ...bookmarkResults, ...historyResults]) {
    if (plugin && !matchesPlugin(item.url, plugin)) continue;
    if (isPatternPlugin && q && !item.title.toLowerCase().includes(q) && !item.url.toLowerCase().includes(q)) continue;
    const key = urlKey(item.url);
    if (seen.has(key)) {
      const existing = merged.find((r) => urlKey(r.url) === key);
      if (existing) existing.score += item.score;
      continue;
    }
    seen.add(key);
    if (plugin) {
      item.categoryLabel = plugin.name;
      item.categoryColor = plugin.color;
    }
    merged.push(item);
  }

  return merged.sort((a, b) => b.score - a.score).slice(0, 20);
}
