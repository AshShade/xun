import type { BookmarkEntry, Config, HistoryEntry, ParsedQuery, Plugin, SearchResult, TabEntry } from "./types";

export function globMatch(str: string, pattern: string): boolean {
  if (!pattern.includes("/")) pattern += "/**";
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^./]*")
    .replace(/\0/g, ".*");
  return new RegExp("^" + re + "$", "i").test(str);
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

export function decayScore(visitCount: number | null | undefined, lastVisitTime: number | null | undefined): number {
  const v = Math.log2((visitCount ?? 0) + 1);
  if (!lastVisitTime || v === 0) return 0;
  const hours = Math.max(0, (Date.now() - lastVisitTime) / (1000 * 60 * 60));
  return Math.round(v * Math.exp(-0.3 * Math.sqrt(hours)) * 150);
}

export const TAB_BONUS = 300;
export const BOOKMARK_BONUS = 50;

const BOUNDARY = /[/\s.\-_]/;
function isBoundary(s: string, i: number): boolean { return i === 0 || BOUNDARY.test(s[i - 1]!); }

/** Word-level fuzzy match: every query term must appear as a substring. */
export function fuzzyMatch(str: string, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const s = str.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const idx = s.indexOf(term);
    if (idx < 0) return 0;
    score += term.length * 2;
    if (isBoundary(s, idx)) score += 3;
    if (s.length - term.length < 3) score += 5; // near-exact match bonus
  }
  return score;
}

export function textMatch(title: string, url: string, query: string): number {
  return Math.max(fuzzyMatch(title, query), fuzzyMatch(url, query));
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
      && !String(pl["prefix"]).startsWith("/")
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
    if (query && !textMatch(entry.title, entry.url, query)) continue;
    const key = urlKey(entry.url);
    const score = decayScore(entry.visitCount, entry.lastVisitTime) + textMatch(entry.title, entry.url, query);
    const prev = grouped.get(key);
    if (!prev || score > prev.score) {
      grouped.set(key, { type: "history", title: entry.title, url: entry.url, score, visitCount: entry.visitCount, lastVisitTime: entry.lastVisitTime });
    }
  }
  return [...grouped.values()];
}

export function queryBookmarks(items: BookmarkEntry[], query: string): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const b of items) {
    if (query && !textMatch(b.title, b.url, query)) continue;
    const key = urlKey(b.url);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ type: "bookmark", title: b.title, url: b.url, score: BOOKMARK_BONUS });
  }
  return results;
}

export function queryTabs(items: TabEntry[], query: string): SearchResult[] {
  return items.filter((t) =>
    !query || textMatch(t.title, t.url, query) > 0
  ).map((t) => ({ type: "tab" as const, title: t.title, url: t.url, tabId: t.tabId, windowId: t.windowId, score: TAB_BONUS + textMatch(t.title, t.url, query) }));
}

export function mergeResults(
  tabResults: SearchResult[],
  bookmarkResults: SearchResult[],
  historyResults: SearchResult[],
  plugin: Plugin | null,
  query: string | null,
): SearchResult[] {
  const isPatternPlugin = plugin !== null && plugin.pluginType === "pattern";
  const seen = new Map<string, { result: SearchResult; hasTab: boolean; hasBookmark: boolean; hasHistory: boolean }>();
  const merged: SearchResult[] = [];
  const q = query ? query.toLowerCase() : null;

  for (const item of [...tabResults, ...bookmarkResults, ...historyResults]) {
    if (plugin && !matchesPlugin(item.url, plugin)) continue;
    if (isPatternPlugin && q && !fuzzyMatch(item.title, q) && !fuzzyMatch(item.url, q)) continue;
    const key = urlKey(item.url);
    const entry = seen.get(key);
    if (entry) {
      if (item.type === "bookmark" && !entry.hasBookmark) { entry.result.score += BOOKMARK_BONUS; entry.hasBookmark = true; }
      if (item.type === "history" && !entry.hasHistory) { entry.result.score += item.score; entry.hasHistory = true; }
      if (item.visitCount != null) { entry.result.visitCount = item.visitCount; entry.result.lastVisitTime = item.lastVisitTime; }
      continue;
    }
    if (plugin) { item.categoryLabel = plugin.name; item.categoryColor = plugin.color; }
    seen.set(key, { result: item, hasTab: item.type === "tab", hasBookmark: item.type === "bookmark", hasHistory: item.type === "history" });
    merged.push(item);
  }

  return merged.sort((a, b) => b.score - a.score).slice(0, 20);
}

export function looksLikeUrl(s: string): boolean {
  if (s.includes(" ")) return false;
  if (/^https?:\/\//.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(\/|:|$)/.test(s)) return true;
  return /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(s);
}

export function suggestGhost(query: string, entries: { url: string; visitCount: number }[]): string {
  if (query.length < 2) return "";
  const q = query.toLowerCase();
  const candidates: string[] = [];
  for (const { url } of entries) {
    const lc = url.toLowerCase();
    const match = [lc, lc.replace(/^https?:\/\//, ""), lc.replace(/^https?:\/\/(www\.)?/, "")].find(f => f.startsWith(q));
    if (match) candidates.push(match);
  }
  if (!candidates.length) return "";
  let prefix = q;
  for (let i = q.length; ; i++) {
    const ch = candidates[0]![i];
    if (ch === undefined || !candidates.every(c => c[i] === ch)) break;
    prefix += ch;
  }
  return prefix.length > q.length ? prefix.slice(query.length) : "";
}

export function computeExpression(expr: string): string | null {
  if (!expr.trim() || !/^[\d\s+\-*/().,%^e]+$/i.test(expr)) return null;
  const sanitized = expr.replace(/\^/g, "**").replace(/%/g, "/100");
  let pos = 0;
  const ch = () => sanitized[pos];
  const skip = () => { while (ch() === " ") pos++; };

  function num(): number {
    skip();
    /* v8 ignore next */ if (ch() === "(") { pos++; const v = add(); skip(); pos++; return v; }
    /* v8 ignore next */ if (ch() === "-") { pos++; return -num(); }
    let s = "";
    while (pos < sanitized.length && /[\d.e]/i.test(sanitized[pos]!)) s += sanitized[pos++];
    return parseFloat(s);
  }

  function pow(): number {
    let v = num();
    skip();
    while (pos < sanitized.length - 1 && sanitized[pos] === "*" && sanitized[pos + 1] === "*") { pos += 2; v = v ** num(); skip(); }
    return v;
  }

  function mul(): number {
    let v = pow();
    skip();
    while (ch() === "*" || ch() === "/") { const op = ch()!; pos++; v = op === "*" ? v * pow() : v / pow(); skip(); }
    return v;
  }

  function add(): number {
    let v = mul();
    skip();
    while (ch() === "+" || ch() === "-") { const op = ch()!; pos++; v = op === "+" ? v + mul() : v - mul(); skip(); }
    return v;
  }

  const result = add();
  if (!isFinite(result)) return null;
  return Number.isInteger(result) ? String(result) : result.toFixed(10).replace(/\.?0+$/, "");
}
