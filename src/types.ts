export interface Shortcut {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  key: string;
}

export interface PatternPlugin {
  name: string;
  prefix: string;
  pluginType: "pattern";
  patterns: string[];
  color: string;
}

export interface SearchPlugin {
  name: string;
  prefix: string;
  pluginType: "search";
  url: string;
  color: string;
}

export type Plugin = PatternPlugin | SearchPlugin;

export interface Config {
  prefixes: Record<string, string>;
  sourceColors: Record<string, string>;
  searchEngine: string;
  plugins: Plugin[];
}

// Raw cache entries — thin layer over browser APIs, keyed by exact URL
export interface HistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  lastVisitTime: number;
}

export interface BookmarkEntry {
  url: string;
  title: string;
}

export interface TabEntry {
  url: string;
  title: string;
  tabId: number;
  windowId: number;
}

// Query layer output
export interface SearchResult {
  type: "history" | "bookmark" | "tab";
  title: string;
  url: string;
  score: number;
  tabId?: number;
  windowId?: number;
  categoryLabel?: string;
  categoryColor?: string;
  visitCount?: number;
  lastVisitTime?: number;
}

export interface ParsedQuery {
  query: string;
  source: string | null;
  plugin: Plugin | null;
}

export interface SearchResponse {
  results: SearchResult[];
  hasPrefix: boolean;
  sourceColors: Record<string, string>;
  plugin: Plugin | null;
  source: string | null;
}

// Functional plugin protocol (content ↔ background)
export interface FnMatch { name: string; prefix: string; color: string; }
export interface FnResult { label: string; value: string; color: string; action: "copy" | "fill"; }
export interface FnResponse { match: FnMatch | null; results: FnResult[]; }
