// Background script (MV3 service worker): handles search across history, bookmarks, and tabs
// In MV3, this runs as a service worker — caches re-init on every wake via refreshCaches()
// lib.ts and render-model.ts are bundled into background.bundle.js by build.js

declare const matchesPlugin: typeof import("./lib").matchesPlugin;
declare const parseQuery: typeof import("./lib").parseQuery;
declare const mergeResults: typeof import("./lib").mergeResults;
declare const validateConfig: typeof import("./lib").validateConfig;
declare const DEFAULT_CONFIG: typeof import("./lib").DEFAULT_CONFIG;
declare const mergeHistoryCache: typeof import("./lib").mergeHistoryCache;
declare const queryHistory: typeof import("./lib").queryHistory;
declare const queryBookmarks: typeof import("./lib").queryBookmarks;
declare const queryTabs: typeof import("./lib").queryTabs;

declare const computeExpression: typeof import("./lib").computeExpression;
declare const fuzzyMatch: typeof import("./lib").fuzzyMatch;
declare const suggestGhost: typeof import("./lib").suggestGhost;
declare const decayScore: typeof import("./lib").decayScore;
declare const textMatch: typeof import("./lib").textMatch;

import type { BookmarkEntry, Config, FnResponse, HistoryEntry, SearchResponse, TabEntry } from "./types";

let config: Config = { ...DEFAULT_CONFIG };
let syncUrl = "";
let syncLastModified = "";
let syncingFromRemote = false;
chrome.storage.local.get(["config", "syncUrl", "syncLastModified"]).then(({ config: c, syncUrl: s, syncLastModified: lm }: { config?: unknown; syncUrl?: string; syncLastModified?: string }) => {
  config = validateConfig(c);
  syncUrl = s || "";
  syncLastModified = lm || "";
  pullRemoteConfig();
});
chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>) => {
  // Process syncUrl first so push/pull use the new URL
  if (changes["syncUrl"]) {
    const newUrl = (changes["syncUrl"].newValue as string) || "";
    if (newUrl !== syncUrl) {
      syncUrl = newUrl;
      syncLastModified = "";
    }
  }
  if (changes["config"]) {
    config = validateConfig(changes["config"].newValue);
    if (!syncingFromRemote) pushRemoteConfig();
  }
});

// Periodic sync via chrome.alarms (survives service worker sleep)
chrome.alarms.create("sync-config", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
  if (alarm.name === "sync-config") pullRemoteConfig();
});

function pullRemoteConfig(force = false): void {
  if (!syncUrl) return;
  const headers: Record<string, string> = {};
  if (!force && syncLastModified) headers["If-Modified-Since"] = syncLastModified;
  // #IF_DEV
  console.log("[xun:sync] pull", syncUrl, "lastMod:", syncLastModified);
  // #END_IF_DEV
  fetch(syncUrl, { method: "HEAD", headers }).then(r => {
    // #IF_DEV
    console.log("[xun:sync] HEAD →", r.status, "Last-Modified:", r.headers.get("Last-Modified"));
    // #END_IF_DEV
    if (r.status === 304) return;
    if (r.status === 404) { pushRemoteConfig(); return; }
    if (!r.ok) return;
    return fetch(syncUrl).then(r2 => r2.ok ? r2.text() : null).then(text => {
      if (!text) return;
      try {
        config = validateConfig(JSON.parse(text));
        syncLastModified = r.headers.get("Last-Modified") || "";
        syncingFromRemote = true;
        chrome.storage.local.set({ config, syncLastModified }).then(() => { syncingFromRemote = false; });
      } catch {}
    });
  }).catch((e) => {
    // #IF_DEV
    console.error("[xun:sync] pull error:", e);
    // #END_IF_DEV
  });
}

function pushRemoteConfig(): void {
  if (!syncUrl) return;
  // #IF_DEV
  console.log("[xun:sync] push", syncUrl);
  // #END_IF_DEV
  fetch(syncUrl, {
    method: "PUT",
    body: JSON.stringify(config),
  }).then(r => r.ok ? r.json() : null).then((json: unknown) => {
    // #IF_DEV
    console.log("[xun:sync] push response:", json);
    // #END_IF_DEV
    if (json && typeof json === "object" && "updatedAt" in json) {
      syncLastModified = (json as { updatedAt: string }).updatedAt;
      chrome.storage.local.set({ syncLastModified });
    }
  }).catch((e) => {
    // #IF_DEV
    console.error("[xun:sync] push error:", e);
    // #END_IF_DEV
  });
}

// Cache layer — raw API data, keyed by exact URL
const historyCache = new Map<string, HistoryEntry>();
let bookmarkCache: BookmarkEntry[] = [];
let tabCache: TabEntry[] = [];

async function refreshCaches(): Promise<void> {
  const [historyItems, bookmarkItems, tabItems] = await Promise.all([
    chrome.history.search({ text: "", maxResults: 1000, startTime: 0 }),
    chrome.bookmarks.getRecent(500),
    chrome.tabs.query({}),
  ]);
  mergeHistoryCache(historyCache, historyItems);
  bookmarkCache = bookmarkItems.filter((b): b is Required<Pick<typeof b, "url" | "title">> => !!(b.url && b.title));
  tabCache = tabItems.filter((t): t is typeof t & { id: number; windowId: number; title: string; url: string } => !!(t.url && t.title && t.id !== undefined && t.windowId !== undefined))
    .map((t) => ({ url: t.url, title: t.title, tabId: t.id, windowId: t.windowId }));
}

// Caches are populated by "refresh-cache" message from content.ts on every open

interface NavigateMessage { type: "navigate"; url: string; tabId?: number; windowId?: number; newTab?: boolean }
interface SearchMessage { type: "search"; query: string }
interface DeepSearchMessage { type: "deep-search"; query: string }
interface RefreshMessage { type: "refresh-cache" }
interface GetConfigMessage { type: "get-config" }
interface FnMessage { type: "fn"; query: string }
interface SuggestMessage { type: "suggest"; query: string }
interface ForceSyncMessage { type: "force-sync"; syncUrl?: string }
interface DefaultSearchMessage { type: "default-search"; query: string; newTab?: boolean }
type Message = NavigateMessage | SearchMessage | DeepSearchMessage | RefreshMessage | GetConfigMessage | FnMessage | SuggestMessage | ForceSyncMessage | DefaultSearchMessage;

chrome.runtime.onMessage.addListener((msg: Message, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): true | void => {
  if (msg.type === "fn") {
    const r = handleFn(msg.query);
    // #IF_DEV
    console.log("[xun:bg] fn result:", JSON.stringify(r));
    // #END_IF_DEV
    sendResponse(r); return true;
  }
  if (msg.type === "search") { sendResponse(handleSearch(msg.query)); return true; }
  if (msg.type === "get-config") { sendResponse({ ...config, syncLastModified }); return true; }
  if (msg.type === "force-sync") {
    if (msg.syncUrl) syncUrl = msg.syncUrl;
    pullRemoteConfig(true);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "refresh-cache") {
    refreshCaches().then(() => sendResponse({ results: [], hasPrefix: false, sourceColors: config.sourceColors, plugin: null, source: null }));
    return true;
  }
  if (msg.type === "deep-search") {
    deepSearch(msg.query).then(sendResponse);
    return true;
  }
  if (msg.type === "suggest") {
    sendResponse(handleSuggest(msg.query));
    return true;
  }
  if (msg.type === "default-search") {
    const disposition = msg.newTab ? "NEW_TAB" : "CURRENT_TAB";
    (chrome as any).search.query({ text: msg.query, disposition });
    return;
  }
  if (msg.type === "navigate") {
    if (msg.tabId && !msg.newTab) {
      chrome.tabs.update(msg.tabId, { active: true });
      if (msg.windowId) chrome.windows.update(msg.windowId, { focused: true });
    } else if (msg.newTab) {
      const idx = sender.tab?.index !== undefined ? sender.tab.index + 1 : undefined;
      const tab = chrome.tabs.create({ url: msg.url, index: idx });
      if (sender.tab && (sender.tab as any).groupId > 0) {
        tab.then(t => { if (t.id) (chrome.tabs as any).group({ tabIds: t.id, groupId: (sender.tab as any).groupId }); });
      }
    } else if (sender.tab?.id) {
      chrome.tabs.update(sender.tab.id, { url: msg.url });
    }
  }
});

function handleSearch(raw: string): SearchResponse {
  const { query, source, plugin } = parseQuery(raw, config);
  const hasPrefix = !!(source || plugin);

  if (!hasPrefix && (!query || query.length < 2)) {
    return { results: [], hasPrefix, sourceColors: config.sourceColors, plugin, source };
  }

  if (plugin && plugin.pluginType === "template") {
    return { results: [], hasPrefix, sourceColors: config.sourceColors, plugin, source };
  }

  // Query layer — scores, deduplicates, filters from raw caches
  const tabs = !source || source === "tabs" ? queryTabs(tabCache, query) : [];
  const bookmarks = !source || source === "bookmarks" ? queryBookmarks(bookmarkCache, query) : [];
  const history = !source || source === "history" ? queryHistory(historyCache, query) : [];

  const merged = mergeResults(tabs, bookmarks, history, plugin, query);
  // #IF_DEV
  for (let i = 0; i < Math.min(5, merged.length); i++) {
    const r = merged[i]!;
    const decay = r.visitCount != null ? decayScore(r.visitCount, r.lastVisitTime) : 0;
    const text = textMatch(r.title, r.url, query);
    const age = r.lastVisitTime ? Math.round((Date.now() - r.lastVisitTime) / 60000) : -1;
    console.log(`[xun] #${i + 1} score=${r.score} decay=${decay} text=${text} visits=${r.visitCount ?? 0} age=${age}min ${r.type} ${r.title?.slice(0, 40)} ${r.url?.slice(0, 60)}`);
  }
  // #END_IF_DEV
  return { results: merged, hasPrefix, sourceColors: config.sourceColors, plugin, source };
}

async function deepSearch(raw: string): Promise<SearchResponse> {
  const { query } = parseQuery(raw, config);
  if (!query || query.length < 2) return handleSearch(raw);

  const apiResults = await chrome.history.search({ text: query, maxResults: 100, startTime: 0 });
  mergeHistoryCache(historyCache, apiResults);

  return handleSearch(raw);
}

// --- Functional plugins ---
interface FnPlugin {
  name: string;
  prefix: string;
  description: string;
  run(query: string): FnResponse["results"];
}

const fnPlugins: FnPlugin[] = [
  {
    name: "Compute", prefix: "/compute", description: "Evaluate math expressions",
    run(q) {
      if (!q) return [{ value: this.prefix + " — " + this.description, action: "fill" as const }];
      const r = computeExpression(q);
      return r ? [{ value: r, action: "copy" as const }] : [];
    },
  },
  {
    name: "Translate", prefix: "/translate", description: "Translate between English and Chinese",
    run(q) {
      if (!q) return [{ value: this.prefix + " — " + this.description, action: "fill" as const }];
      const hasCJK = /[\u4e00-\u9fff]/.test(q);
      const sl = hasCJK ? "zh-CN" : "en";
      const tl = hasCJK ? "en" : "zh-CN";
      const url = `https://translate.google.com/?sl=${sl}&tl=${tl}&text=${encodeURIComponent(q)}&op=translate`;
      return [{ value: `${hasCJK ? "中→EN" : "EN→中"}: ${q}`, action: "open" as const, url, secondary: "Open Google Translate", noHighlight: true }];
    },
  },
  {
    name: "Plugins", prefix: "/plugins", description: "Browse registered plugins",
    run(q) {
      const plugins = config.plugins ?? [];
      if (!plugins.length) return [{ value: "No plugins configured", action: "fill" as const }];
      const results = plugins.map(p => {
        const secondary = "patterns" in p ? p.patterns.join(", ") : p.url;
        const score = q ? Math.max(fuzzyMatch(p.name, q), fuzzyMatch(p.prefix, q), fuzzyMatch(secondary, q)) : 1;
        return { p, secondary, score };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
      return results.map(({ p, secondary }) => ({
        value: p.prefix, action: "fill" as const, label: p.name, labelColor: p.color, secondary, fillValue: p.prefix,
      }));
    },
  },
];

function handleFn(raw: string): FnResponse {
  const firstWord = raw.split(" ")[0] ?? "";
  const hasSpace = raw.includes(" ");
  const partial = firstWord.slice(1).toLowerCase();

  // Once space is typed, lock to best matching plugin and evaluate
  if (hasSpace) {
    const exact = fnPlugins.find(p => firstWord === p.prefix);
    if (exact) {
      const query = raw.slice(firstWord.length).trim();
      return { match: { name: exact.name, prefix: exact.prefix }, results: exact.run(query) };
    }
    const matches = fnPlugins.filter(p => p.prefix.slice(1).startsWith(partial));
    if (matches.length >= 1) {
      const p = matches[0]!;
      const query = raw.slice(firstWord.length).trim();
      return { match: { name: p.name, prefix: p.prefix }, results: p.run(query) };
    }
    return { match: null, results: [] };
  }

  // No space yet — list plugins sorted by match quality
  const scored = fnPlugins.map(p => {
    const name = p.prefix.slice(1);
    const score = name === partial ? 100 : name.startsWith(partial) ? 50 + partial.length : 0;
    return { p, score };
  }).filter(x => x.score > 0 || !partial).sort((a, b) => b.score - a.score);

  return {
    match: null,
    results: scored.map(({ p }) => ({ value: p.prefix + " — " + p.description, action: "fill" as const })),
  };
}

function handleSuggest(query: string): string {
  const entries: { url: string; visitCount: number }[] = [];
  for (const [, h] of historyCache) entries.push({ url: h.url, visitCount: h.visitCount });
  for (const b of bookmarkCache) entries.push({ url: b.url, visitCount: 0 });
  const result = suggestGhost(query, entries);
  // #IF_DEV
  const q = query.toLowerCase();
  const candidates = entries.filter(e => {
    const lc = e.url.toLowerCase();
    return lc.startsWith(q) || lc.replace(/^https?:\/\//, "").startsWith(q) || lc.replace(/^https?:\/\/(www\.)?/, "").startsWith(q);
  }).sort((a, b) => b.visitCount - a.visitCount).slice(0, 5);
  if (candidates.length) console.log(`[xun:suggest] q="${query}" → "${result?.slice(0, 40)}" top:`, candidates.map(c => `${c.visitCount}×${c.url.slice(0, 50)}`).join(" | "));
  // #END_IF_DEV
  return result;
}
