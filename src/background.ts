// Background script (MV3 service worker): handles search across history, bookmarks, and tabs
// In MV3, this runs as a service worker — caches re-init on every wake via refreshCaches()

import {
  matchesPlugin, parseQuery, mergeResults, validateConfig, DEFAULT_CONFIG,
  mergeHistoryCache, loadCaches, serializeCaches, applySnapshot,
  queryHistory, queryBookmarks, queryTabs,
  computeExpression, fuzzyMatch, suggestGhost, decayScore, textMatch, shouldSearch,
} from "./lib";

import type { BookmarkEntry, BrowserDataPort, CacheSnapshot, Config, FnResponse, HistoryEntry, SearchResponse, TabEntry } from "./types";

let config: Config = { ...DEFAULT_CONFIG };
let syncUrl = "";
let syncLastModified = "";
let syncingFromRemote = false;
let resolveConfigReady: () => void;
const configReady = new Promise<void>((resolve) => { resolveConfigReady = resolve; });
chrome.storage.local.get(["config", "syncUrl", "syncLastModified"]).then(({ config: c, syncUrl: s, syncLastModified: lm }: { config?: unknown; syncUrl?: string; syncLastModified?: string }) => {
  config = validateConfig(c);
  syncUrl = s || "";
  syncLastModified = lm || "";
  resolveConfigReady();
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
  DEV: {
  console.log("[xun:sync] pull", syncUrl, "lastMod:", syncLastModified);
  }
  fetch(syncUrl, { method: "HEAD", headers }).then(r => {
    DEV: {
    console.log("[xun:sync] HEAD →", r.status, "Last-Modified:", r.headers.get("Last-Modified"));
    }
    if (r.status === 304) return;
    if (r.status === 404) { pushRemoteConfig(); return; }
    if (!r.ok) return;
    return fetch(syncUrl).then(r2 => r2.ok ? r2.text() : null).then(text => {
      if (!text) return;
      try {
        config = validateConfig(JSON.parse(text));
        syncLastModified = r.headers.get("Last-Modified") || "";
        syncingFromRemote = true;
        chrome.storage.local.set({ config, syncLastModified }).finally(() => { syncingFromRemote = false; });
      } catch {}
    });
  }).catch((e) => {
    DEV: {
    console.error("[xun:sync] pull error:", e);
    }
  });
}

function pushRemoteConfig(): void {
  if (!syncUrl) return;
  DEV: {
  console.log("[xun:sync] push", syncUrl);
  }
  fetch(syncUrl, {
    method: "PUT",
    body: JSON.stringify(config),
  }).then(r => r.ok ? r.json() : null).then((json: unknown) => {
    DEV: {
    console.log("[xun:sync] push response:", json);
    }
    if (json && typeof json === "object" && "updatedAt" in json) {
      syncLastModified = (json as { updatedAt: string }).updatedAt;
      chrome.storage.local.set({ syncLastModified });
    }
  }).catch((e) => {
    DEV: {
    console.error("[xun:sync] push error:", e);
    }
  });
}

// Cache layer — raw API data, keyed by exact URL
const historyCache = new Map<string, HistoryEntry>();
let bookmarkCache: BookmarkEntry[] = [];
let tabCache: TabEntry[] = [];

// Adapter over the browser data APIs — swappable with a fake in tests (see loadCaches)
const browserPort: BrowserDataPort = {
  searchHistory: () => chrome.history.search({ text: "", maxResults: 10000, startTime: 0 }),
  getRecentBookmarks: () => chrome.bookmarks.getRecent(500),
  queryTabs: () => chrome.tabs.query({}),
};

const SNAPSHOT_KEY = "cacheSnapshot";
const sessionStore = chrome.storage.session;

function saveSnapshot(): void {
  if (!sessionStore) return;
  sessionStore.set({ [SNAPSHOT_KEY]: serializeCaches(historyCache, bookmarkCache, tabCache) }).catch(() => {});
}

// Warm caches from the last snapshot on service-worker wake, so an early search
// isn't blocked on the full refresh. refreshCaches() still runs on open for freshness.
if (sessionStore) {
  sessionStore.get(SNAPSHOT_KEY).then((data) => {
    const snapshot = data[SNAPSHOT_KEY] as CacheSnapshot | undefined;
    if (snapshot && historyCache.size === 0) {
      const { bookmarks, tabs } = applySnapshot(snapshot, historyCache);
      bookmarkCache = bookmarks;
      tabCache = tabs;
    }
  }).catch(() => {});
}

async function refreshCaches(): Promise<void> {
  try {
    const { bookmarks, tabs } = await loadCaches(browserPort, historyCache);
    bookmarkCache = bookmarks;
    tabCache = tabs;
    saveSnapshot();
  } catch (e) {
    // Keep existing caches on failure so search still works with stale data
    DEV: {
    console.error("[xun:bg] refreshCaches failed:", e);
    }
  }
}

// Caches are populated by "refresh-cache" message from content.ts on every open

import type { Message } from "./messages";

chrome.runtime.onMessage.addListener((msg: Message, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): true | void => {
  if (msg.type === "fn") {
    configReady.then(() => {
      const r = handleFn(msg.query);
      DEV: {
      console.log("[xun:bg] fn result:", JSON.stringify(r));
      }
      sendResponse(r);
    });
    return true;
  }
  if (msg.type === "search") { configReady.then(() => sendResponse(handleSearch(msg.query))); return true; }
  if (msg.type === "force-sync") {
    if (msg.syncUrl) syncUrl = msg.syncUrl;
    pullRemoteConfig(true);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "refresh-cache") {
    refreshCaches();
    return;
  }
  if (msg.type === "deep-search") {
    configReady.then(() => deepSearch(msg.query).then(sendResponse));
    return true;
  }
  if (msg.type === "default-search") {
    const isNewTab = sender.tab?.url?.includes("newtab.html");
    const disposition = msg.newTab ? "NEW_TAB" : "CURRENT_TAB";
    const senderTabId = (msg.newTab && isNewTab) ? sender.tab?.id : undefined;
    chrome.search.query({ text: msg.query, disposition }, () => {
      if (senderTabId) chrome.tabs.remove(senderTabId);
    });
    return;
  }
  if (msg.type === "navigate") {
    const isNewTab = sender.tab?.url?.includes("newtab.html");
    if (msg.tabId && !msg.newTab) {
      chrome.tabs.update(msg.tabId, { active: true });
      if (msg.windowId) chrome.windows.update(msg.windowId, { focused: true });
      if (isNewTab && sender.tab?.id) chrome.tabs.remove(sender.tab.id);
    } else if (msg.newTab) {
      const idx = sender.tab?.index !== undefined ? sender.tab.index + 1 : undefined;
      const groupId = (sender.tab && sender.tab.groupId !== undefined && sender.tab.groupId > 0)
        ? sender.tab.groupId : undefined;
      const senderTabId = isNewTab ? sender.tab?.id : undefined;
      chrome.tabs.create({ url: msg.url, index: idx }).then(t => {
        if (t.id && groupId !== undefined) chrome.tabs.group({ tabIds: t.id, groupId });
        if (senderTabId) chrome.tabs.remove(senderTabId);
      });
    } else if (sender.tab?.id) {
      chrome.tabs.update(sender.tab.id, { url: msg.url });
    }
  }
});

function handleSearch(raw: string): SearchResponse {
  const { query, source, plugin } = parseQuery(raw, config);
  const hasPrefix = !!(source || plugin);
  const ghost = (!hasPrefix && query) ? handleSuggest(raw) : "";

  if (!shouldSearch(query, hasPrefix)) {
    return { results: [], hasPrefix, sourceColors: config.sourceColors, plugin, source, ghost };
  }

  if (plugin && plugin.pluginType === "template") {
    return { results: [], hasPrefix, sourceColors: config.sourceColors, plugin, source, ghost: "" };
  }

  // Query layer — scores, deduplicates, filters from raw caches
  const tabs = !source || source === "tabs" ? queryTabs(tabCache, query) : [];
  const bookmarks = !source || source === "bookmarks" ? queryBookmarks(bookmarkCache, query) : [];
  const history = !source || source === "history" ? queryHistory(historyCache, query) : [];

  const merged = mergeResults(tabs, bookmarks, history, plugin, query);
  DEV: {
  for (let i = 0; i < Math.min(5, merged.length); i++) {
    const r = merged[i]!;
    const decay = r.visitCount != null ? decayScore(r.visitCount, r.lastVisitTime) : 0;
    const text = textMatch(r.title, r.url, query);
    const age = r.lastVisitTime ? Math.round((Date.now() - r.lastVisitTime) / 60000) : -1;
    console.log(`[xun] #${i + 1} score=${r.score} decay=${decay} text=${text} visits=${r.visitCount ?? 0} age=${age}min ${r.type} ${r.title?.slice(0, 40)} ${r.url?.slice(0, 60)}`);
  }
  }
  return { results: merged, hasPrefix, sourceColors: config.sourceColors, plugin, source, ghost };
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
  DEV: {
  const q = query.toLowerCase();
  const candidates = entries.filter(e => {
    const lc = e.url.toLowerCase();
    return lc.startsWith(q) || lc.replace(/^https?:\/\//, "").startsWith(q) || lc.replace(/^https?:\/\/(www\.)?/, "").startsWith(q);
  }).sort((a, b) => b.visitCount - a.visitCount).slice(0, 5);
  if (candidates.length) console.log(`[xun:suggest] q="${query}" → "${result?.slice(0, 40)}" top:`, candidates.map(c => `${c.visitCount}×${c.url.slice(0, 50)}`).join(" | "));
  }
  return result;
}
