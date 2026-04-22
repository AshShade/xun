// Content script: injects Xun overlay into the page
// Architecture: State → Computed (render-model) → Renderers

import type { SearchResponse, Shortcut } from "./types";
import type { FnResponse } from "./types";
import type { Mode, State, TextSegment, ResultItemModel, PluginLabelModel, GhostModel, PreviewModel, UIModel } from "./types";
const VERSION = "__VERSION__";

// render-model.ts functions loaded as globals via manifest scripts array
declare const computeUI: (s: State) => UIModel;
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

let render: ((model: UIModel) => void) | null = null;
let renderPending = false;

function setState(patch: Partial<State>): void {
  if (!render) return;
  Object.assign(state, patch);
  if (!renderPending) {
    renderPending = true;
    queueMicrotask(() => { renderPending = false; render!(computeUI(state)); });
  }
}

// ═══════════════════════════════════════════════════════════
// Layer 3: Renderer — single render function owns all DOM
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

function createRenderer(
  root: HTMLElement,
  onResultAction: (i: number, newTab: boolean) => void,
  onResultHover: (i: number) => void,
): (model: UIModel) => void {
  const resultsEl = root.querySelector<HTMLDivElement>("#xun-results")!;
  const previewEl = root.querySelector<HTMLElement>("#xun-preview")!;
  const pluginLabelEl = root.querySelector<HTMLSpanElement>("#xun-plugin-label")!;
  const ghostEl = root.querySelector<HTMLSpanElement>("#xun-ghost")!;
  const ghostMirrorEl = root.querySelector<HTMLSpanElement>("#xun-ghost-mirror")!;

  let prev: UIModel | null = null;

  return (model: UIModel) => {
    // ── Results ──
    if (!prev || !resultsContentEqual(prev.results, model.results)) {
      // Full rebuild
      resultsEl.innerHTML = "";
      resultsEl.style.pointerEvents = "none";
      model.results.forEach((item, i) => {
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
        row.addEventListener("click", (ev) => onResultAction(i, isMac ? ev.metaKey : ev.ctrlKey));
        row.addEventListener("mouseenter", () => onResultHover(i));
        resultsEl.appendChild(row);
      });
      const labels = resultsEl.querySelectorAll<HTMLSpanElement>(".xun-type");
      const widths = new Set<number>();
      labels.forEach(l => { if (l.style.display !== "none") widths.add(l.offsetWidth); });
      if (widths.size > 1) {
        const max = Math.max(...widths) + "px";
        labels.forEach(l => { if (l.style.display !== "none") l.style.minWidth = max; });
      }
    } else {
      // Selection-only update
      resultsEl.querySelectorAll(".xun-selected").forEach(el => el.classList.remove("xun-selected"));
    }
    const selIdx = model.results.findIndex(it => it.selected);
    const selRow = resultsEl.children[selIdx] as HTMLElement | undefined;
    if (selRow) { selRow.classList.add("xun-selected"); selRow.scrollIntoView({ block: "nearest" }); }

    // ── Plugin label ──
    if (!prev || prev.pluginLabel !== model.pluginLabel) {
      pluginLabelEl.textContent = model.pluginLabel.text;
      pluginLabelEl.style.background = model.pluginLabel.bg;
      pluginLabelEl.style.color = model.pluginLabel.color;
      pluginLabelEl.style.display = model.pluginLabel.visible ? "inline-block" : "none";
    }

    // ── Ghost ──
    if (!prev || prev.ghost !== model.ghost) {
      ghostEl.textContent = model.ghost.ghost;
      ghostMirrorEl.textContent = model.ghost.mirror;
    }

    // ── Preview ──
    if (!prev || prev.preview !== model.preview) {
      previewEl.textContent = model.preview.text;
      previewEl.style.display = model.preview.visible ? "block" : "none";
    }

    prev = model;
  };
}

/** Compare results ignoring the `selected` field */
function resultsContentEqual(a: ResultItemModel[], b: ResultItemModel[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const { selected: _a, ...ra } = a[i]!;
    const { selected: _b, ...rb } = b[i]!;
    if (JSON.stringify(ra) !== JSON.stringify(rb)) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════
// DOM refs & helpers
// ═══════════════════════════════════════════════════════════

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let overlay: HTMLDivElement | null = null;
let deepTimer: ReturnType<typeof setTimeout> | null = null;
let searchEngine = "https://www.google.com/search?q=%s";

function looksLikeUrl(s: string): boolean {
  if (s.includes(" ")) return false;
  if (/^https?:\/\//.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(\/|:|$)/.test(s)) return true;
  return /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(s);
}

function detectMode(): Mode {
  if (state.functionalListing || state.functionalPlugin) return "functional";
  if (state.activePlugin) return "plugin";
  return "normal";
}

function requestGhost(): void {
  if (state.mode !== "normal") { setState({ ghost: "" }); return; }
  chrome.runtime.sendMessage({ type: "suggest", query: state.query }).then((ghost: unknown) => {
    if (typeof ghost === "string") setState({ ghost });
  });
}

// ═══════════════════════════════════════════════════════════
// Actions — called by renderers via callbacks, mutate state
// ═══════════════════════════════════════════════════════════

function handleResultAction(index: number, newTab: boolean): void {
  if (state.mode === "functional") {
    const fr = state.functionalResults[index];
    if (!fr) return;
    if (fr.action === "copy") { navigator.clipboard.writeText(fr.value); close(); }
    else if (fr.action === "open" && fr.url) { chrome.runtime.sendMessage({ type: "navigate", url: fr.url, newTab }); close(); }
    else {
      const input = overlay!.querySelector<HTMLInputElement>("#xun-input")!;
      const prefix = fr.fillValue ?? state.functionalPlugin?.prefix ?? fr.value.split(" ")[0] ?? "";
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
  chrome.runtime.sendMessage({ type: "navigate", url: item.url, tabId: item.tabId, windowId: item.windowId, newTab });
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
chrome.storage.local.get("shortcut").then(({ shortcut: s }: { shortcut?: Shortcut }) => {
  if (s) shortcut = s;
});
chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>) => {
  if (changes["shortcut"]) shortcut = changes["shortcut"].newValue as Shortcut;
});

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === shortcut.key && e.ctrlKey === shortcut.ctrlKey && e.shiftKey === shortcut.shiftKey && e.altKey === shortcut.altKey && e.metaKey === shortcut.metaKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    toggle();
  }
}, true);

chrome.runtime.onMessage.addListener((msg: { type: string }) => {
  if (msg.type === "toggle") toggle();
});

// ═══════════════════════════════════════════════════════════
// Open / Close / Toggle
// ═══════════════════════════════════════════════════════════

function toggle(): void { host ? close() : open(); }

function open(): void {
  chrome.runtime.sendMessage({ type: "refresh-cache" });
  chrome.runtime.sendMessage({ type: "get-config" }).then((raw: unknown) => {
    const c = raw as { searchEngine?: string };
    if (c.searchEngine) searchEngine = c.searchEngine;
  });
  host = document.createElement("div");
  host.id = "xun-host";
  shadow = host.attachShadow({ mode: "open" });

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("xun.css");
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

  // ── Single renderer: State → computeUI → render ──
  render = createRenderer(overlay, handleResultAction, handleResultHover);

  const input = overlay.querySelector<HTMLInputElement>("#xun-input")!;
  input.focus();
  input.addEventListener("input", onInput);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("mousemove", () => {
    overlay!.querySelector<HTMLDivElement>("#xun-results")!.style.pointerEvents = "auto";
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
  render = null;
  renderPending = false;
  state = { query: "", mode: "normal", selectedIndex: -1, results: [], functionalResults: [], activePlugin: null, source: null, sourceColors: state.sourceColors, hasPrefix: false, ghost: "", functionalPlugin: null, functionalListing: false };
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
    chrome.runtime.sendMessage({ type: "fn", query: query.trimStart() }).then((res: unknown) => {
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
    }).catch((err: unknown) => {
      // #IF_DEV
      console.error("[xun:content] fn error:", err);
      // #END_IF_DEV
    });
    return;
  }

  const hasSpace = query.includes(" ");
  const searchQuery = (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1)
    ? trimmed.slice(1, -1) : trimmed;

  if (!hasSpace && trimmed.length < 2) {
    setState({ query, results: [], hasPrefix: false, selectedIndex: -1, activePlugin: null, source: null, mode: "normal", ghost: "", functionalResults: [], functionalPlugin: null, functionalListing: false });
    return;
  }
  chrome.runtime.sendMessage({ type: "search", query: searchQuery }).then((raw: unknown) => {
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
    setState({ mode });
    requestGhost();
  });
  deepTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: "deep-search", query: searchQuery }).then((raw: unknown) => {
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
      setState({ mode });
      requestGhost();
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
