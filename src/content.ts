// Content script: injects Xun overlay into the page

import type { Plugin, SearchResponse, Shortcut } from "./types";
const VERSION = "__VERSION__";

// --- Centralized state with granular dispatch ---
type Mode = "normal" | "plugin" | "address";
interface State {
  results: SearchResponse["results"];
  selectedIndex: number;
  hasPrefix: boolean;
  activePlugin: Plugin | null;
  source: string | null;
  sourceColors: Record<string, string>;
  mode: Mode;
  ghost: string;
}

let state: State = {
  results: [],
  selectedIndex: -1,
  hasPrefix: false,
  activePlugin: null,
  source: null,
  sourceColors: { tabs: "#89b4fa", bookmarks: "#f9e2af", history: "#a6e3a1" },
  mode: "normal",
  ghost: "",
};

type StateKey = keyof State;
type Listener = () => void;
const listeners: Partial<Record<StateKey, Listener[]>> = {};

function on(keys: StateKey[], fn: Listener): void {
  for (const k of keys) (listeners[k] ??= []).push(fn);
}

function setState(patch: Partial<State>): void {
  if (!overlay) return;
  const changed = new Set<StateKey>();
  for (const k of Object.keys(patch) as StateKey[]) {
    if (state[k] !== (patch as State)[k]) changed.add(k);
  }
  Object.assign(state, patch);
  const fired = new Set<Listener>();
  for (const k of changed) {
    for (const fn of listeners[k] ?? []) {
      if (!fired.has(fn)) { fired.add(fn); fn(); }
    }
  }
}

// --- DOM refs ---
let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let overlay: HTMLDivElement | null = null;
let currentQuery = "";
let deepTimer: ReturnType<typeof setTimeout> | null = null;
let searchEngine = "https://www.google.com/search?q=%s";

// --- Mode detection ---
function detectMode(): Mode {
  if (state.activePlugin) return "plugin";
  const q = currentQuery.trim();
  if (q.startsWith('"') && q.endsWith('"')) return "normal";
  if (!q.includes(" ") && (/[./]/.test(q) || q.includes("://"))) return "address";
  return "normal";
}

function computeGhost(): string {
  if (state.mode !== "address" || !state.results.length) return "";
  const q = currentQuery.toLowerCase();
  // Find first result URL that starts with what user typed (with or without protocol)
  for (const r of state.results) {
    const url = r.url.toLowerCase();
    if (url.startsWith(q)) return r.url.slice(currentQuery.length);
    const bare = url.replace(/^https?:\/\//, "");
    if (bare.startsWith(q)) return bare.slice(currentQuery.length);
    // Also try without www.
    const noWww = bare.replace(/^www\./, "");
    if (noWww.startsWith(q)) return noWww.slice(currentQuery.length);
  }
  return "";
}

function renderGhost(): void {
  const ghost = overlay!.querySelector<HTMLSpanElement>("#xun-ghost")!;
  const mirror = overlay!.querySelector<HTMLSpanElement>("#xun-ghost-mirror")!;
  ghost.textContent = state.ghost;
  mirror.textContent = currentQuery;
}

// --- Renderers (registered as listeners below open()) ---

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(text: string, query: string): string {
  if (!query) return escHtml(text);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return escHtml(text);
  const lower = text.toLowerCase();
  const marks = new Uint8Array(text.length);
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx >= 0) for (let i = idx; i < idx + term.length; i++) marks[i] = 1;
  }
  let out = "", inMark = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] && !inMark) { out += "<mark>"; inMark = true; }
    else if (!marks[i] && inMark) { out += "</mark>"; inMark = false; }
    out += escHtml(text[i]!);
  }
  if (inMark) out += "</mark>";
  return out;
}

function renderResults(): void {
  const container = overlay!.querySelector<HTMLDivElement>("#xun-results")!;
  container.innerHTML = "";
  container.style.pointerEvents = "none";
  const q = state.hasPrefix ? currentQuery.trim().split(" ").slice(1).join(" ").trim() : currentQuery.trim();
  state.results.forEach((item, i) => {
    const label = item.categoryLabel || TYPE_LABELS[item.type] || item.type;
    const color = item.categoryColor || state.sourceColors[TYPE_SOURCE_MAP[item.type] ?? ""] || "#a6adc8";

    const row = document.createElement("div");
    row.className = "xun-result" + (i === state.selectedIndex ? " xun-selected" : "");
    row.dataset["index"] = String(i);

    const typeSpan = document.createElement("span");
    typeSpan.className = "xun-type";
    typeSpan.textContent = label;
    typeSpan.style.background = hexToRgba(color, 0.15);
    typeSpan.style.color = color;

    const textDiv = document.createElement("div");
    textDiv.className = "xun-text";

    const titleSpan = document.createElement("span");
    titleSpan.className = "xun-title";
    titleSpan.innerHTML = highlight(item.title, q);

    const urlSpan = document.createElement("span");
    urlSpan.className = "xun-url";
    urlSpan.innerHTML = highlight(item.url, q);

    textDiv.appendChild(titleSpan);
    textDiv.appendChild(urlSpan);
    row.appendChild(typeSpan);
    row.appendChild(textDiv);

    row.addEventListener("click", (ev) => { navigate(item, isMac ? ev.metaKey : ev.ctrlKey); });
    row.addEventListener("mouseenter", () => { setState({ selectedIndex: i }); });

    container.appendChild(row);
  });
}

function renderSelection(): void {
  const container = overlay!.querySelector("#xun-results")!;
  container.querySelectorAll(".xun-selected").forEach((el) => el.classList.remove("xun-selected"));
  const row = container.children[state.selectedIndex] as HTMLElement | undefined;
  if (row) { row.classList.add("xun-selected"); row.scrollIntoView({ block: "nearest" }); }
  // #IF_DEV
  const item = state.selectedIndex >= 0 ? state.results[state.selectedIndex] : null;
  if (item) {
    const v = item.visitCount !== undefined ? item.visitCount : "?";
    const age = item.lastVisitTime ? ((Date.now() - item.lastVisitTime) / 60000).toFixed(1) + "m ago" : "n/a";
    const flags = [item.type, item.tabId != null ? "tab" : "", item.visitCount != null ? "hist" : ""].filter(Boolean).join("+");
    console.log("[xun]", `#${state.selectedIndex}`, `score=${item.score} visits=${v} age=${age}`, flags, item.title, item.url);
  }
  // #END_IF_DEV
}

function renderPreview(): void {
  const preview = overlay!.querySelector("#xun-preview") as HTMLElement | undefined;
  if (!preview) return;
  const item = state.selectedIndex >= 0 ? state.results[state.selectedIndex] : null;
  preview.textContent = item ? (item.tabId != null ? "(tab) " : "") + item.url : "";
  preview.style.display = item ? "block" : "none";
}

function renderPluginLabel(): void {
  const label = overlay!.querySelector<HTMLSpanElement>("#xun-plugin-label")!;
  const { activePlugin: plugin, source } = state;
  if (plugin) {
    const color = plugin.color || "#a6adc8";
    label.textContent = plugin.name;
    label.style.background = hexToRgba(color, 0.15);
    label.style.color = color;
    label.style.display = "inline-block";
  } else if (source) {
    const color = state.sourceColors[source] || "#a6adc8";
    label.textContent = SOURCE_LABELS[source] || source;
    label.style.background = hexToRgba(color, 0.15);
    label.style.color = color;
    label.style.display = "inline-block";
  } else {
    label.style.display = "none";
    label.textContent = "";
  }
}

// --- Keyboard shortcut ---
const isMac = navigator.platform.includes("Mac");
const DEFAULT_SHORTCUT: Shortcut = isMac
  ? { ctrlKey: false, shiftKey: false, altKey: false, metaKey: true, key: "k" }
  : { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: "k" };

let shortcut: Shortcut = DEFAULT_SHORTCUT;
browser.storage.local.get("shortcut").then(({ shortcut: s }: { shortcut?: Shortcut }) => {
  if (s) shortcut = s;
});
browser.storage.onChanged.addListener((changes: Record<string, browser.storage.StorageChange>) => {
  if (changes["shortcut"]) shortcut = changes["shortcut"].newValue as Shortcut;
});

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === shortcut.key && e.ctrlKey === shortcut.ctrlKey && e.shiftKey === shortcut.shiftKey && e.altKey === shortcut.altKey && e.metaKey === shortcut.metaKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    toggle();
  }
}, true);

browser.runtime.onMessage.addListener((msg: { type: string }) => {
  if (msg.type === "toggle") toggle();
});

// --- Open / Close / Toggle ---
function toggle(): void { host ? close() : open(); }

function open(): void {
  browser.runtime.sendMessage({ type: "refresh-cache" });
  browser.runtime.sendMessage({ type: "get-config" }).then((raw: unknown) => {
    const c = raw as { searchEngine?: string };
    if (c.searchEngine) searchEngine = c.searchEngine;
  });
  host = document.createElement("div");
  host.id = "xun-host";
  shadow = host.attachShadow({ mode: "open" });

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = browser.runtime.getURL("xun.css");
  shadow.appendChild(link);

  overlay = document.createElement("div");
  overlay.id = "xun-overlay";
  overlay.innerHTML = `
    <div id="xun-modal">
      <div id="xun-input-row">
        <span id="xun-icon">寻</span>
        <div id="xun-input-wrap">
          <div id="xun-ghost-layer"><span id="xun-ghost-mirror"></span><span id="xun-ghost"></span></div>
          <input id="xun-input" type="text" placeholder="Search tabs, bookmarks, history..." autocomplete="off" spellcheck="false" />
        </div>
        <span id="xun-plugin-label"></span>
      </div>
      <div id="xun-results"></div>
    </div>
    <div id="xun-preview" style="display:none"></div>
    <span id="xun-version">${VERSION}</span>
  `;
  shadow.appendChild(overlay);
  document.documentElement.appendChild(host);
  const input = overlay.querySelector<HTMLInputElement>("#xun-input")!;
  input.focus();
  input.addEventListener("input", onInput);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("mousemove", () => {
    const c = overlay?.querySelector<HTMLDivElement>("#xun-results");
    if (c) c.style.pointerEvents = "auto";
  });
  document.addEventListener("keydown", onKeydown);

  // Register listeners: each renderer subscribes to its relevant state keys
  on(["results", "sourceColors"], renderResults);
  on(["selectedIndex"], renderSelection);
  on(["selectedIndex", "results"], renderPreview);
  on(["activePlugin", "source", "sourceColors"], renderPluginLabel);
  on(["ghost"], renderGhost);
}

function close(): void {
  if (!host) return;
  host.remove();
  host = null;
  shadow = null;
  overlay = null;
  currentQuery = "";
  state = { results: [], selectedIndex: -1, hasPrefix: false, activePlugin: null, source: null, sourceColors: state.sourceColors, mode: "normal", ghost: "" };
  for (const k of Object.keys(listeners) as StateKey[]) delete listeners[k];
  document.removeEventListener("keydown", onKeydown);
}

// --- Input handler ---
function onInput(e: Event): void {
  currentQuery = (e.target as HTMLInputElement).value;
  if (deepTimer) clearTimeout(deepTimer);

  const hasSpace = currentQuery.includes(" ");
  const trimmed = currentQuery.trim();
  // Strip surrounding quotes for forced normal mode search
  const searchQuery = (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1)
    ? trimmed.slice(1, -1) : trimmed;

  if (!hasSpace && trimmed.length < 2) {
    setState({ results: [], hasPrefix: false, selectedIndex: -1, activePlugin: null, source: null, mode: "normal", ghost: "" });
    return;
  }
  browser.runtime.sendMessage({ type: "search", query: searchQuery }).then((raw: unknown) => {
    const res = raw as SearchResponse;
    setState({
      results: res.results,
      hasPrefix: res.hasPrefix,
      activePlugin: res.plugin,
      source: res.source,
      sourceColors: res.sourceColors,
      selectedIndex: res.hasPrefix && res.results.length > 0 ? 0 : -1,
    });
    const mode = detectMode();
    setState({ mode, ghost: mode === "address" ? computeGhost() : "" });
  });
  deepTimer = setTimeout(() => {
    browser.runtime.sendMessage({ type: "deep-search", query: searchQuery }).then((raw: unknown) => {
      const res = raw as SearchResponse;
      if (currentQuery.trim() !== trimmed) return;
      const prevSelected = state.selectedIndex;
      setState({
        results: res.results,
        hasPrefix: res.hasPrefix,
        activePlugin: res.plugin,
        source: res.source,
        sourceColors: res.sourceColors,
        selectedIndex: prevSelected >= 0 ? Math.min(prevSelected, res.results.length - 1) : -1,
      });
      const mode = detectMode();
      setState({ mode, ghost: mode === "address" ? computeGhost() : "" });
    });
  }, 300);
}

// --- Keyboard handler ---
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") { close(); e.preventDefault(); return; }
  // Accept ghost text with Tab or → (only when cursor is at end)
  if (state.ghost && (e.key === "Tab" || e.key === "ArrowRight")) {
    const input = overlay!.querySelector<HTMLInputElement>("#xun-input")!;
    if (input.selectionStart === input.value.length) {
      e.preventDefault();
      input.value = currentQuery + state.ghost;
      currentQuery = input.value;
      onInput({ target: input } as unknown as Event);
      return;
    }
  }
  if (e.key === "ArrowDown") {
    setState({ selectedIndex: Math.min(state.selectedIndex + 1, state.results.length - 1) });
    e.preventDefault();
  } else if (e.key === "ArrowUp") {
    setState({ selectedIndex: Math.max(state.selectedIndex - 1, state.hasPrefix ? 0 : -1) });
    e.preventDefault();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const newTab = isMac ? e.metaKey : e.ctrlKey;
    if (state.selectedIndex >= 0 && state.results[state.selectedIndex]) {
      navigate(state.results[state.selectedIndex]!, newTab);
    } else if (state.activePlugin?.pluginType === "search" && currentQuery) {
      const q = currentQuery.trim().split(" ").slice(1).join(" ").trim();
      if (q) navigate({ type: "history", title: "", url: (state.activePlugin as { url: string }).url.replace("%s", encodeURIComponent(q)), score: 0 }, newTab);
    } else if (currentQuery) {
      const q = currentQuery.trim();
      const url = looksLikeUrl(q) ? (q.includes("://") ? q : "https://" + q) : searchEngine.replace("%s", encodeURIComponent(q));
      navigate({ type: "history", title: "", url, score: 0 }, newTab);
    }
  }
}

function navigate(item: SearchResponse["results"][number], newTab = false): void {
  browser.runtime.sendMessage({ type: "navigate", url: item.url, tabId: item.tabId, windowId: item.windowId, newTab });
  close();
}

// --- Constants & helpers ---
const TYPE_LABELS: Record<string, string> = { tab: "Tab", bookmark: "Bookmark", history: "History" };
const TYPE_SOURCE_MAP: Record<string, string> = { tab: "tabs", bookmark: "bookmarks", history: "history" };
const SOURCE_LABELS: Record<string, string> = { history: "History", tabs: "Tabs", bookmarks: "Bookmarks" };

function looksLikeUrl(s: string): boolean {
  if (s.includes(" ")) return false;
  if (/^https?:\/\//.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(\/|:|$)/.test(s)) return true;
  return /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(s);
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
