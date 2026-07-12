import type { SearchResponse, FnResponse } from "./types";

// ═══════════════════════════════════════════════════════════
// Message protocol: content.ts ↔ background.ts
// Type-only — no runtime code. Both sides import types only.
// ═══════════════════════════════════════════════════════════

// Requests (content → background)
export interface SearchMessage { type: "search"; query: string }
export interface DeepSearchMessage { type: "deep-search"; query: string }
export interface RefreshMessage { type: "refresh-cache" }
export interface FnMessage { type: "fn"; query: string }
export interface ForceSyncMessage { type: "force-sync"; syncUrl?: string }
export interface NavigateMessage { type: "navigate"; url: string; tabId?: number; windowId?: number; newTab?: boolean }
export interface DefaultSearchMessage { type: "default-search"; query: string; newTab?: boolean }

export type Message = SearchMessage | DeepSearchMessage | RefreshMessage | FnMessage | ForceSyncMessage | NavigateMessage | DefaultSearchMessage;

// Response map: maps each request type to its response type
export interface MessageResponseMap {
  "search": SearchResponse;
  "deep-search": SearchResponse;
  "refresh-cache": void;
  "fn": FnResponse;
  "force-sync": { ok: boolean };
  "navigate": void;
  "default-search": void;
}
