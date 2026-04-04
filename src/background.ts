// Background script: handles search across history, bookmarks, and tabs
// lib.ts functions are loaded via manifest scripts array

declare const matchesPlugin: typeof import("./lib").matchesPlugin;
declare const parseQuery: typeof import("./lib").parseQuery;
declare const mergeResults: typeof import("./lib").mergeResults;
declare const validateConfig: typeof import("./lib").validateConfig;
declare const DEFAULT_CONFIG: typeof import("./lib").DEFAULT_CONFIG;
declare const mergeHistoryCache: typeof import("./lib").mergeHistoryCache;
declare const queryHistory: typeof import("./lib").queryHistory;
declare const queryBookmarks: typeof import("./lib").queryBookmarks;
declare const queryTabs: typeof import("./lib").queryTabs;

import type { BookmarkEntry, Config, HistoryEntry, SearchResponse, TabEntry } from "./types";

let config: Config = { ...DEFAULT_CONFIG };
browser.storage.local.get("config").then(({ config: c }: { config?: unknown }) => {
  config = validateConfig(c);
});
browser.storage.onChanged.addListener((changes: Record<string, browser.storage.StorageChange>) => {
  if (changes["config"]) config = validateConfig(changes["config"].newValue);
});

// Cache layer — raw API data, keyed by exact URL
const historyCache = new Map<string, HistoryEntry>();
let bookmarkCache: BookmarkEntry[] = [];
let tabCache: TabEntry[] = [];

async function refreshCaches(): Promise<void> {
  const [historyItems, bookmarkItems, tabItems] = await Promise.all([
    browser.history.search({ text: "", maxResults: 1000, startTime: 0 }),
    browser.bookmarks.getRecent(500),
    browser.tabs.query({}),
  ]);
  mergeHistoryCache(historyCache, historyItems);
  bookmarkCache = bookmarkItems.filter((b): b is Required<Pick<typeof b, "url" | "title">> => !!(b.url && b.title));
  tabCache = tabItems.filter((t): t is typeof t & { id: number; windowId: number; title: string; url: string } => !!(t.url && t.title && t.id !== undefined && t.windowId !== undefined))
    .map((t) => ({ url: t.url, title: t.title, tabId: t.id, windowId: t.windowId }));
}

refreshCaches();

interface NavigateMessage { type: "navigate"; url: string; tabId?: number; windowId?: number; newTab?: boolean }
interface SearchMessage { type: "search"; query: string }
interface DeepSearchMessage { type: "deep-search"; query: string }
interface RefreshMessage { type: "refresh-cache" }
interface GetConfigMessage { type: "get-config" }
type Message = NavigateMessage | SearchMessage | DeepSearchMessage | RefreshMessage | GetConfigMessage;

browser.runtime.onMessage.addListener((msg: Message, sender: browser.runtime.MessageSender, sendResponse: (response: SearchResponse | Config) => void) => {
  if (msg.type === "refresh-cache") {
    refreshCaches().then(() => sendResponse({ results: [], hasPrefix: false, sourceColors: config.sourceColors, plugin: null, source: null }));
    return true;
  }
  if (msg.type === "search") {
    sendResponse(handleSearch(msg.query));
    return false;
  }
  if (msg.type === "deep-search") {
    deepSearch(msg.query).then(sendResponse);
    return true;
  }
  if (msg.type === "navigate") {
    if (msg.tabId && !msg.newTab) {
      browser.tabs.update(msg.tabId, { active: true });
      if (msg.windowId) browser.windows.update(msg.windowId, { focused: true });
    } else if (msg.newTab) {
      browser.tabs.create({ url: msg.url });
    } else if (sender.tab?.id) {
      browser.tabs.update(sender.tab.id, { url: msg.url });
    }
  }
  if (msg.type === "get-config") {
    sendResponse(config);
    return false;
  }
  return undefined;
});

function handleSearch(raw: string): SearchResponse {
  const { query, source, plugin } = parseQuery(raw, config);
  const hasPrefix = !!(source || plugin);

  if (!hasPrefix && (!query || query.length < 2)) {
    return { results: [], hasPrefix, sourceColors: config.sourceColors, plugin, source };
  }

  if (plugin && plugin.pluginType === "search") {
    return { results: [], hasPrefix, sourceColors: config.sourceColors, plugin, source };
  }

  // Query layer — scores, deduplicates, filters from raw caches
  const tabs = !source || source === "tabs" ? queryTabs(tabCache, query) : [];
  const bookmarks = !source || source === "bookmarks" ? queryBookmarks(bookmarkCache, query) : [];
  const history = !source || source === "history" ? queryHistory(historyCache, query) : [];

  const merged = mergeResults(tabs, bookmarks, history, plugin, query);
  return { results: merged, hasPrefix, sourceColors: config.sourceColors, plugin, source };
}

async function deepSearch(raw: string): Promise<SearchResponse> {
  const { query } = parseQuery(raw, config);
  if (!query || query.length < 2) return handleSearch(raw);

  const apiResults = await browser.history.search({ text: query, maxResults: 100, startTime: 0 });
  mergeHistoryCache(historyCache, apiResults);

  return handleSearch(raw);
}
