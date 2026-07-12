export interface Shortcut {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  key: string;
}

export interface FilterPlugin {
  name: string;
  prefix: string;
  pluginType: "filter";
  patterns: string[];
  color: string;
}

export interface TemplatePlugin {
  name: string;
  prefix: string;
  pluginType: "template";
  url: string;
  color: string;
}

export type Plugin = FilterPlugin | TemplatePlugin;

export interface Config {
  schemaVersion?: number;
  prefixes: Record<string, string>;
  sourceColors: Record<string, string>;
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

// Raw browser-API shapes consumed by the cache builders (adapter boundary)
export interface RawHistoryItem { url?: string; title?: string; visitCount?: number; lastVisitTime?: number }
export interface RawBookmarkItem { url?: string; title?: string }
export interface RawTabItem { id?: number; windowId?: number; title?: string; url?: string }

// Port over the browser data APIs — lets the cache layer be unit-tested with a fake
export interface BrowserDataPort {
  searchHistory(): Promise<RawHistoryItem[]>;
  getRecentBookmarks(): Promise<RawBookmarkItem[]>;
  queryTabs(): Promise<RawTabItem[]>;
}

// Serializable snapshot persisted to storage.session to warm caches across SW wakes
export interface CacheSnapshot {
  history: HistoryEntry[];
  bookmarks: BookmarkEntry[];
  tabs: TabEntry[];
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
  ghost: string;
}

// Functional plugin protocol (content ↔ background)
export interface FnMatch { name: string; prefix: string; }
export interface FnResult { value: string; action: "copy" | "fill" | "open"; label?: string; labelColor?: string; secondary?: string; fillValue?: string; url?: string; noHighlight?: boolean; }
export interface FnResponse { match: FnMatch | null; results: FnResult[]; }

// --- Render data model (Layer 2: computed from state, consumed by renderers) ---

export type Mode = "normal" | "plugin" | "functional";

export interface State {
  query: string;
  mode: Mode;
  selectedIndex: number;
  results: SearchResult[];
  functionalResults: FnResult[];
  activePlugin: Plugin | null;
  source: string | null;
  sourceColors: Record<string, string>;
  hasPrefix: boolean;
  ghost: string;
  functionalPlugin: FnMatch | null;
  functionalListing: boolean;
}

export interface TextSegment { text: string; highlight: boolean; }

export interface ResultItemModel {
  label: string;
  labelBg: string;
  labelColor: string;
  primary: TextSegment[];
  secondary: TextSegment[];
  selected: boolean;
}

export interface PluginLabelModel {
  text: string;
  bg: string;
  color: string;
  visible: boolean;
}

export interface GhostModel { ghost: string; mirror: string; }
export interface PreviewModel { text: string; visible: boolean; }

export interface UIModel {
  results: ResultItemModel[];
  pluginLabel: PluginLabelModel;
  ghost: GhostModel;
  preview: PreviewModel;
}
