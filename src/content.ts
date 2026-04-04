// Content script: injects Xun overlay into the page

import type { Plugin, SearchResponse, Shortcut } from "./types";
const DEV = true;

let overlay: HTMLDivElement | null = null;
let selectedIndex = -1;
let results: SearchResponse["results"] = [];
let hasPrefix = false;
let currentQuery = "";
let deepTimer: ReturnType<typeof setTimeout> | null = null;

function highlightSelected(): void {
  if (!overlay) return;
  const container = overlay.querySelector("#xun-results");
  if (!container) return;
  container.querySelectorAll(".xun-selected").forEach((el) => el.classList.remove("xun-selected"));
  const row = container.children[selectedIndex] as HTMLElement | undefined;
  if (row) { row.classList.add("xun-selected"); row.scrollIntoView({ block: "nearest" }); }
  const item = selectedIndex >= 0 ? results[selectedIndex] : null;
  if (DEV && item) {
    const v = item.visitCount !== undefined ? item.visitCount : "?";
    const age = item.lastVisitTime ? ((Date.now() - item.lastVisitTime) / 60000).toFixed(1) + "m ago" : "n/a";
    const flags = [item.type, item.tabId != null ? "tab" : "", item.visitCount != null ? "hist" : ""].filter(Boolean).join("+");
    console.log("[xun]", `#${selectedIndex}`, `score=${item.score} visits=${v} age=${age}`, flags, item.title, item.url);
  }
  const preview = overlay.querySelector("#xun-preview") as HTMLElement | undefined;
  if (preview) {
    const item = selectedIndex >= 0 ? results[selectedIndex] : null;
    const label = item ? (item.tabId != null ? "(tab) " : "") + item.url : "";
    preview.textContent = label;
    preview.style.display = label ? "block" : "none";
  }
}
let activePlugin: Plugin | null = null;
let sourceColors: Record<string, string> = { tabs: "#89b4fa", bookmarks: "#f9e2af", history: "#a6e3a1" };

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

function toggle(): void {
  overlay ? close() : open();
}

function open(): void {
  browser.runtime.sendMessage({ type: "refresh-cache" });
  overlay = document.createElement("div");
  overlay.id = "xun-overlay";
  overlay.innerHTML = `
    <div id="xun-modal">
      <div id="xun-input-row">
        <span id="xun-icon">寻</span>
        <input id="xun-input" type="text" placeholder="Search tabs, bookmarks, history..." autocomplete="off" spellcheck="false" />
        <span id="xun-plugin-label"></span>
      </div>
      <div id="xun-results"></div>
    </div>
    <div id="xun-preview"></div>
  `;
  document.documentElement.appendChild(overlay);
  const input = overlay.querySelector<HTMLInputElement>("#xun-input")!;
  input.focus();
  input.addEventListener("input", onInput);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("mousemove", () => {
    const c = overlay?.querySelector<HTMLDivElement>("#xun-results");
    if (c) c.style.pointerEvents = "auto";
  });
  document.addEventListener("keydown", onKeydown);
}

function close(): void {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  results = [];
  selectedIndex = -1;
  hasPrefix = false;
  activePlugin = null;
  currentQuery = "";
  document.removeEventListener("keydown", onKeydown);
}

function onInput(e: Event): void {
  currentQuery = (e.target as HTMLInputElement).value;
  if (deepTimer) clearTimeout(deepTimer);

  const hasSpace = currentQuery.includes(" ");
  const trimmed = currentQuery.trim();

  if (!hasSpace && trimmed.length < 2) {
    results = [];
    hasPrefix = false;
    renderResults([]);
    if (overlay) updatePluginLabel(null, null);
    return;
  }
  browser.runtime.sendMessage({ type: "search", query: trimmed }).then((raw: unknown) => {
    const res = raw as SearchResponse;
    results = res.results;
    hasPrefix = res.hasPrefix;
    activePlugin = res.plugin;
    sourceColors = res.sourceColors;
    selectedIndex = hasPrefix && results.length > 0 ? 0 : -1;
    updatePluginLabel(res.plugin, res.source);
    renderResults(results);
  });
  // Deep search after 300ms idle — queries browser API and merges into cache
  deepTimer = setTimeout(() => {
    browser.runtime.sendMessage({ type: "deep-search", query: trimmed }).then((raw: unknown) => {
      const res = raw as SearchResponse;
      if (currentQuery.trim() !== trimmed) return; // query changed, discard
      results = res.results;
      hasPrefix = res.hasPrefix;
      activePlugin = res.plugin;
      sourceColors = res.sourceColors;
      const prevSelected = selectedIndex;
      selectedIndex = prevSelected >= 0 ? Math.min(prevSelected, results.length - 1) : -1;
      updatePluginLabel(res.plugin, res.source);
      renderResults(results);
    });
  }, 300);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") { close(); e.preventDefault(); return; }
  if (e.key === "ArrowDown") {
    selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
    highlightSelected();
    e.preventDefault();
  } else if (e.key === "ArrowUp") {
    selectedIndex = Math.max(selectedIndex - 1, hasPrefix ? 0 : -1);
    highlightSelected();
    e.preventDefault();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const newTab = isMac ? e.metaKey : e.ctrlKey;
    if (selectedIndex >= 0 && results[selectedIndex]) {
      navigate(results[selectedIndex]!, newTab);
    } else if (activePlugin?.pluginType === "search" && currentQuery) {
      const q = currentQuery.trim().split(" ").slice(1).join(" ").trim();
      if (q) {
        browser.runtime.sendMessage({ type: "plugin-search", urlTemplate: (activePlugin as { url: string }).url, query: q });
        close();
      }
    } else if (currentQuery) {
      browser.runtime.sendMessage({ type: "search-engine", query: currentQuery.trim(), newTab });
      close();
    }
  }
}

function navigate(item: SearchResponse["results"][number], newTab = false): void {
  browser.runtime.sendMessage({ type: "navigate", url: item.url, tabId: item.tabId, windowId: item.windowId, newTab });
  close();
}

const TYPE_LABELS: Record<string, string> = { tab: "Tab", bookmark: "Bookmark", history: "History" };
const TYPE_SOURCE_MAP: Record<string, string> = { tab: "tabs", bookmark: "bookmarks", history: "history" };
const SOURCE_LABELS: Record<string, string> = { history: "History", tabs: "Tabs", bookmarks: "Bookmarks" };

function updatePluginLabel(plugin: Plugin | null, source: string | null): void {
  if (!overlay) return;
  const label = overlay.querySelector<HTMLSpanElement>("#xun-plugin-label")!;
  if (plugin) {
    const color = plugin.color || "#a6adc8";
    label.textContent = plugin.name;
    label.style.background = hexToRgba(color, 0.15);
    label.style.color = color;
    label.style.display = "inline-block";
  } else if (source) {
    const color = sourceColors[source] || "#a6adc8";
    label.textContent = SOURCE_LABELS[source] || source;
    label.style.background = hexToRgba(color, 0.15);
    label.style.color = color;
    label.style.display = "inline-block";
  } else {
    label.style.display = "none";
    label.textContent = "";
  }
}

function renderResults(items: SearchResponse["results"]): void {
  if (!overlay) return;
  const container = overlay.querySelector<HTMLDivElement>("#xun-results")!;
  container.innerHTML = "";
  container.style.pointerEvents = "none";
  if (!items.length) {
    const preview = overlay.querySelector("#xun-preview") as HTMLElement | undefined;
    if (preview) { preview.textContent = ""; preview.style.display = "none"; }
    return;
  }

  items.forEach((item, i) => {
    const label = item.categoryLabel || TYPE_LABELS[item.type] || item.type;
    const color = item.categoryColor || sourceColors[TYPE_SOURCE_MAP[item.type] ?? ""] || "#a6adc8";

    const row = document.createElement("div");
    row.className = "xun-result" + (i === selectedIndex ? " xun-selected" : "");
    row.dataset["index"] = String(i);

    const typeSpan = document.createElement("span");
    typeSpan.className = "xun-type";
    typeSpan.textContent = label;
    typeSpan.style.background = hexToRgba(color, 0.15);
    typeSpan.style.color = color;

    const titleSpan = document.createElement("span");
    titleSpan.className = "xun-title";
    titleSpan.textContent = item.title;

    const urlSpan = document.createElement("span");
    urlSpan.className = "xun-url";
    urlSpan.textContent = truncateUrl(item.url);

    row.appendChild(typeSpan);
    row.appendChild(titleSpan);
    row.appendChild(urlSpan);

    row.addEventListener("click", (ev) => { navigate(items[i]!, isMac ? ev.metaKey : ev.ctrlKey); });
    row.addEventListener("mouseenter", () => {
      selectedIndex = i;
      highlightSelected();
    });

    container.appendChild(row);
  });

  const preview = overlay.querySelector("#xun-preview") as HTMLElement | undefined;
  if (preview) {
    const item = selectedIndex >= 0 ? items[selectedIndex] : null;
    const label = item ? (item.tabId != null ? "(tab) " : "") + item.url : "";
    preview.textContent = label;
    preview.style.display = label ? "block" : "none";
  }
}

function truncateUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch { return url.slice(0, 40); }
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
