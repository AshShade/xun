// Content script: injects Xun overlay into the page
// Architecture: State → Computed (render-model) → Renderers

import type { SearchResponse, Shortcut } from "./types";
import type { FnResponse } from "./types";
import type { Mode, State, TextSegment, ResultItemModel, PluginLabelModel, GhostModel, PreviewModel } from "./types";
const VERSION = "__VERSION__";

// render-model.ts functions loaded as globals via manifest scripts array
declare const computeResultItems: (s: State) => ResultItemModel[];
declare const computePluginLabel: (s: State) => PluginLabelModel;
declare const computeGhost: (s: State) => GhostModel;
declare const computePreview: (s: State) => PreviewModel;
declare const hexToRgba: (hex: string, alpha: number) => string;

// ═══════════════════════════════════════════════════════════
// Layer 1: State — raw data, only mutated by user events
// ═══════════════════════════════════════════════════════════

let state: State = {
  query: "",
  mode: "normal",
  selectedIndex: -1,
  results: [],
  functionalResults: [],
  activePlugin: null,
  source: null,
  sourceColors: { tabs: "#89b4fa", bookmarks: "#f9e2af", history: "#a6e3a1" },
  hasPrefix: false,
  ghost: "",
  functionalPlugin: null,
  functionalListing: false,
};

type StateKey = keyof State;
const stateListeners: Partial<Record<StateKey, (() => void)[]>> = {};
const pendingKeys = new Set<StateKey>();
let pendingFlush = false;

function onState(keys: StateKey[], fn: () => void): void {
  for (const k of keys) (stateListeners[k] ??= []).push(fn);
}

function setState(patch: Partial<State>): void {
  if (!overlay) return;
  for (const k of Object.keys(patch) as StateKey[]) {
    if (state[k] !== (patch as State)[k]) pendingKeys.add(k);
  }
  Object.assign(state, patch);
  if (!pendingFlush && pendingKeys.size > 0) {
    pendingFlush = true;
    queueMicrotask(flush);
  }
}

function flush(): void {
  pendingFlush = false;
  const keys = new Set(pendingKeys);
  pendingKeys.clear();
  const fired = new Set<() => void>();
  for (const k of keys) {
    for (const fn of stateListeners[k] ?? []) {
      if (!fired.has(fn)) { fired.add(fn); fn(); }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Layer 3: Renderers — pure DOM functions, never read state
// ═══════════════════════════════════════════════════════════

function renderSegments(parent: HTMLElement, segments: TextSegment[]): void {
  for (const seg of segments) {
    if (seg.highlight) {
      const mark = document.createElement("mark");
      mark.textContent = seg.text;
      parent.appendChild(mark);
    } else {
      parent.appendChild(document.createTextNode(seg.text));
    }
  }
}

function renderResultItems(container: HTMLElement, items: ResultItemModel[], onAction: (i: number, newTab: boolean) => void, onHover: (i: number) => void): void {
  container.innerHTML = "";
  container.style.pointerEvents = "none";
  items.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "xun-result" + (item.selected ? " xun-selected" : "");
    row.dataset["index"] = String(i);

    const typeSpan = document.createElement("span");
    typeSpan.className = "xun-type";
    typeSpan.textContent = item.label;
    typeSpan.style.background = item.labelBg;
    typeSpan.style.color = item.labelColor;
    if (!item.label) typeSpan.style.display = "none";

    const textDiv = document.createElement("div");
    textDiv.className = "xun-text";

    const titleSpan = document.createElement("span");
    titleSpan.className = "xun-title";
    renderSegments(titleSpan, item.primary);

    textDiv.appendChild(titleSpan);
    if (item.secondary.length > 0) {
      const urlSpan = document.createElement("span");
      urlSpan.className = "xun-url";
      renderSegments(urlSpan, item.secondary);
      textDiv.appendChild(urlSpan);
    }

    row.appendChild(typeSpan);
    row.appendChild(textDiv);
    row.addEventListener("click", (ev) => onAction(i, isMac ? ev.metaKey : ev.ctrlKey));
    row.addEventListener("mouseenter", () => onHover(i));
    container.appendChild(row);
  });
}

function renderPluginLabel(container: HTMLElement, model: PluginLabelModel): void {
  container.textContent = model.text;
  (container as HTMLElement).style.background = model.bg;
  (container as HTMLElement).style.color = model.color;
  (container as HTMLElement).style.display = model.visible ? "inline-block" : "none";
}

function renderGhostModel(ghostEl: HTMLElement, mirrorEl: HTMLElement, model: GhostModel): void {
  ghostEl.textContent = model.ghost;
  mirrorEl.textContent = model.mirror;
}

function renderPreviewModel(container: HTMLElement, model: PreviewModel): void {
  container.textContent = model.text;
  (container as HTMLElement).style.display = model.visible ? "block" : "none";
}

// ═══════════════════════════════════════════════════════════
// DOM refs & helpers
// ═══════════════════════════════════════════════════════════

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let overlay: HTMLDivElement | null = null;
let deepTimer: ReturnType<typeof setTimeout> | null = null;
let searchEngine = "https://www.google.com/search?q=%s";

// DOM element refs (set in open(), cleared in close())
let resultsEl: HTMLDivElement | null = null;
let previewEl: HTMLElement | null = null;
let pluginLabelEl: HTMLSpanElement | null = null;
let ghostEl: HTMLSpanElement | null = null;
let ghostMirrorEl: HTMLSpanElement | null = null;

function looksLikeUrl(s: string): boolean {
  if (s.includes(" ")) return false;
  if (/^https?:\/\//.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(\/|:|$)/.test(s)) return true;
  return /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(s);
}

function detectMode(): Mode {
  if (state.functionalListing || state.functionalPlugin) return "functional";
  if (state.activePlugin) return "plugin";
  const q = state.query.trim();
  if (q.startsWith('"') && q.endsWith('"')) return "normal";
  if (!q.includes(" ") && (/[./]/.test(q) || q.includes("://"))) return "address";
  return "normal";
}

function computeGhostText(): string {
  if (state.mode !== "address" || !state.results.length) return "";
  const q = state.query.toLowerCase();
  for (const r of state.results) {
    const url = r.url.toLowerCase();
    if (url.startsWith(q)) return r.url.slice(state.query.length);
    const bare = url.replace(/^https?:\/\//, "");
    if (bare.startsWith(q)) return bare.slice(state.query.length);
    const noWww = bare.replace(/^www\./, "");
    if (noWww.startsWith(q)) return noWww.slice(state.query.length);
  }
  return "";
}

// ═══════════════════════════════════════════════════════════
// Actions — called by renderers via callbacks, mutate state
// ═══════════════════════════════════════════════════════════

function handleResultAction(index: number, newTab: boolean): void {
  if (state.mode === "functional") {
    const fr = state.functionalResults[index];
    if (!fr) return;
    if (fr.action === "copy") { navigator.clipboard.writeText(fr.value); close(); }
    else {
      const input = overlay!.querySelector<HTMLInputElement>("#xun-input")!;
      const prefix = state.functionalPlugin?.prefix ?? fr.value.split(" ")[0] ?? "";
      input.value = prefix + " ";
      input.dispatchEvent(new Event("input"));
    }
    return;
  }
  const item = state.results[index];
  if (item) navigate(item, newTab);
}

function handleResultHover(index: number): void {
  setState({ selectedIndex: index });
}

function navigate(item: SearchResponse["results"][number], newTab = false): void {
  browser.runtime.sendMessage({ type: "navigate", url: item.url, tabId: item.tabId, windowId: item.windowId, newTab });
  close();
}

// ═══════════════════════════════════════════════════════════
// Keyboard shortcut
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// Open / Close / Toggle
// ═══════════════════════════════════════════════════════════

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

  // Grab DOM refs
  resultsEl = overlay.querySelector<HTMLDivElement>("#xun-results")!;
  previewEl = overlay.querySelector<HTMLElement>("#xun-preview")!;
  pluginLabelEl = overlay.querySelector<HTMLSpanElement>("#xun-plugin-label")!;
  ghostEl = overlay.querySelector<HTMLSpanElement>("#xun-ghost")!;
  ghostMirrorEl = overlay.querySelector<HTMLSpanElement>("#xun-ghost-mirror")!;

  // ── Layer 2 → Layer 3 wiring ──
  // State changes → compute models → render
  onState(["results", "functionalResults", "mode", "selectedIndex", "sourceColors", "hasPrefix", "query"], () => {
    renderResultItems(resultsEl!, computeResultItems(state), handleResultAction, handleResultHover);
  });

  onState(["activePlugin", "source", "sourceColors", "functionalPlugin", "functionalListing"], () => {
    renderPluginLabel(pluginLabelEl!, computePluginLabel(state));
  });

  onState(["ghost", "query"], () => {
    renderGhostModel(ghostEl!, ghostMirrorEl!, computeGhost(state));
  });

  onState(["selectedIndex", "results", "mode"], () => {
    renderPreviewModel(previewEl!, computePreview(state));
  });

  const input = overlay.querySelector<HTMLInputElement>("#xun-input")!;
  input.focus();
  input.addEventListener("input", onInput);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("mousemove", () => {
    if (resultsEl) resultsEl.style.pointerEvents = "auto";
  });
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("keyup", stopEvent, true);
  document.addEventListener("keypress", stopEvent, true);
}

function close(): void {
  if (!host) return;
  host.remove();
  host = null;
  shadow = null;
  overlay = null;
  resultsEl = null;
  previewEl = null;
  pluginLabelEl = null;
  ghostEl = null;
  ghostMirrorEl = null;
  state = { query: "", mode: "normal", selectedIndex: -1, results: [], functionalResults: [], activePlugin: null, source: null, sourceColors: state.sourceColors, hasPrefix: false, ghost: "", functionalPlugin: null, functionalListing: false };
  pendingKeys.clear();
  pendingFlush = false;
  for (const k of Object.keys(stateListeners) as StateKey[]) delete stateListeners[k];
  document.removeEventListener("keydown", onKeydown, true);
  document.removeEventListener("keyup", stopEvent, true);
  document.removeEventListener("keypress", stopEvent, true);
}

// ═══════════════════════════════════════════════════════════
// Input handler
// ═══════════════════════════════════════════════════════════

function onInput(e: Event): void {
  const query = (e.target as HTMLInputElement).value;
  if (deepTimer) clearTimeout(deepTimer);

  const trimmed = query.trim();

  // Functional plugin mode
  if (trimmed.startsWith("/")) {
    // #IF_DEV
    console.log("[xun:content] sending fn message:", trimmed);
    // #END_IF_DEV
    browser.runtime.sendMessage({ type: "fn", query: trimmed }).then((res: unknown) => {
      // #IF_DEV
      console.log("[xun:content] fn response:", JSON.stringify(res));
      // #END_IF_DEV
      const r = res as FnResponse | undefined;
      if (!r) return;
      setState({
        query, results: [], hasPrefix: true, activePlugin: null, source: null,
        functionalPlugin: r.match ?? null, functionalListing: !r.match,
        functionalResults: r.results,
        selectedIndex: r.results.length > 0 ? 0 : -1, mode: "functional", ghost: "",
      });
    }).catch((err: unknown) => { console.error("[xun:content] fn error:", err); });
    return;
  }

  const hasSpace = query.includes(" ");
  const searchQuery = (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1)
    ? trimmed.slice(1, -1) : trimmed;

  if (!hasSpace && trimmed.length < 2) {
    setState({ query, results: [], hasPrefix: false, selectedIndex: -1, activePlugin: null, source: null, mode: "normal", ghost: "", functionalResults: [], functionalPlugin: null, functionalListing: false });
    return;
  }
  browser.runtime.sendMessage({ type: "search", query: searchQuery }).then((raw: unknown) => {
    const res = raw as SearchResponse;
    setState({
      query,
      results: res.results,
      hasPrefix: res.hasPrefix,
      activePlugin: res.plugin,
      source: res.source,
      sourceColors: res.sourceColors,
      selectedIndex: res.hasPrefix && res.results.length > 0 ? 0 : -1,
      functionalResults: [], functionalPlugin: null, functionalListing: false,
    });
    const mode = detectMode();
    setState({ mode, ghost: mode === "address" ? computeGhostText() : "" });
  });
  deepTimer = setTimeout(() => {
    browser.runtime.sendMessage({ type: "deep-search", query: searchQuery }).then((raw: unknown) => {
      const res = raw as SearchResponse;
      if (state.query.trim() !== trimmed) return;
      const prevSelected = state.selectedIndex;
      setState({
        results: res.results,
        hasPrefix: res.hasPrefix,
        activePlugin: res.plugin,
        source: res.source,
        sourceColors: res.sourceColors,
        selectedIndex: prevSelected >= 0 ? Math.min(prevSelected, res.results.length - 1) : -1,
        functionalResults: [], functionalPlugin: null, functionalListing: false,
      });
      const mode = detectMode();
      setState({ mode, ghost: mode === "address" ? computeGhostText() : "" });
    });
  }, 300);
}

// ═══════════════════════════════════════════════════════════
// Keyboard handler
// ═══════════════════════════════════════════════════════════

function stopEvent(e: Event): void { e.stopPropagation(); }

function onKeydown(e: KeyboardEvent): void {
  e.stopPropagation();
  if (e.key === "Escape") { close(); e.preventDefault(); return; }
  if (state.ghost && (e.key === "Tab" || e.key === "ArrowRight")) {
    const input = overlay!.querySelector<HTMLInputElement>("#xun-input")!;
    if (input.selectionStart === input.value.length) {
      e.preventDefault();
      input.value = state.query + state.ghost;
      onInput({ target: input } as unknown as Event);
      return;
    }
  }
  const maxIdx = state.mode === "functional" ? state.functionalResults.length - 1 : state.results.length - 1;
  if (e.key === "ArrowDown") {
    setState({ selectedIndex: Math.min(state.selectedIndex + 1, maxIdx) });
    e.preventDefault();
  } else if (e.key === "ArrowUp") {
    setState({ selectedIndex: Math.max(state.selectedIndex - 1, state.hasPrefix ? 0 : -1) });
    e.preventDefault();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const newTab = isMac ? e.metaKey : e.ctrlKey;
    if (state.selectedIndex >= 0) {
      handleResultAction(state.selectedIndex, newTab);
    } else if (state.activePlugin?.pluginType === "search" && state.query) {
      const q = state.query.trim().split(" ").slice(1).join(" ").trim();
      if (q) navigate({ type: "history", title: "", url: (state.activePlugin as { url: string }).url.replace("%s", encodeURIComponent(q)), score: 0 }, newTab);
    } else if (state.query) {
      const q = state.query.trim();
      const url = looksLikeUrl(q) ? (q.includes("://") ? q : "https://" + q) : searchEngine.replace("%s", encodeURIComponent(q));
      navigate({ type: "history", title: "", url, score: 0 }, newTab);
    }
  }
}
