// Layer 2: Pure compute functions — State → Render Data Models
// No DOM, no side effects, fully testable.

import type { State, Mode, TextSegment, ResultItemModel, PluginLabelModel, GhostModel, PreviewModel, UIModel } from "./types";

// --- Shared pure helpers ---

export function looksLikeUrl(s: string): boolean {
  if (s.includes(" ")) return false;
  if (/^https?:\/\//.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(\/|:|$)/.test(s)) return true;
  return /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(s);
}

export function computeMode(s: State): Mode {
  if (s.functionalListing || s.functionalPlugin) return "functional";
  if (s.activePlugin) return "plugin";
  return "normal";
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const TYPE_LABELS: Record<string, string> = { tab: "Tab", bookmark: "Bookmark", history: "History" };
const TYPE_SOURCE_MAP: Record<string, string> = { tab: "tabs", bookmark: "bookmarks", history: "history" };
const SOURCE_LABELS: Record<string, string> = { history: "History", tabs: "Tabs", bookmarks: "Bookmarks" };

/** Split text into segments with highlight markers based on query terms. */
export function segmentHighlight(text: string, query: string): TextSegment[] {
  if (!query) return [{ text, highlight: false }];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [{ text, highlight: false }];
  const lower = text.toLowerCase();
  const marks = new Uint8Array(text.length);
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx >= 0) for (let i = idx; i < idx + term.length; i++) marks[i] = 1;
  }
  const segments: TextSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const hl = !!marks[i];
    let j = i + 1;
    while (j < text.length && !!marks[j] === hl) j++;
    segments.push({ text: text.slice(i, j), highlight: hl });
    i = j;
  }
  return segments;
}

// --- Compute functions ---

export function computeResultItems(s: State): ResultItemModel[] {
  const q = s.hasPrefix ? s.query.trim().split(" ").slice(1).join(" ").trim() : s.query.trim();

  if (s.mode === "functional") {
    const fnQ = s.query.trim().split(" ").slice(1).join(" ").trim();
    return s.functionalResults.map((item, i) => {
      const color = item.labelColor || "";
      const hl = fnQ && !item.noHighlight;
      return {
        label: item.label || "",
        labelBg: color ? hexToRgba(color, 0.15) : "",
        labelColor: color,
        primary: hl && item.label ? segmentHighlight(item.value, fnQ) : [{ text: item.value, highlight: false }],
        secondary: item.secondary ? (hl ? segmentHighlight(item.secondary, fnQ) : [{ text: item.secondary, highlight: false }]) : [],
        selected: i === s.selectedIndex,
      };
    });
  }

  return s.results.map((item, i) => {
    const label = item.categoryLabel || TYPE_LABELS[item.type] || item.type;
    const color = item.categoryColor || s.sourceColors[TYPE_SOURCE_MAP[item.type] ?? ""] || "#a6adc8";
    return {
      label,
      labelBg: hexToRgba(color, 0.15),
      labelColor: color,
      primary: segmentHighlight(item.title, q),
      secondary: segmentHighlight(item.url, q),
      selected: i === s.selectedIndex,
    };
  });
}

export function computePluginLabel(s: State): PluginLabelModel {
  const { activePlugin: p, source } = s;
  if (s.functionalPlugin || s.functionalListing) return { text: "", bg: "", color: "", visible: false };
  if (p) { const c = p.color || "#a6adc8"; return { text: p.name, bg: hexToRgba(c, 0.15), color: c, visible: true }; }
  if (source) { const c = s.sourceColors[source] || "#a6adc8"; return { text: SOURCE_LABELS[source] || source, bg: hexToRgba(c, 0.15), color: c, visible: true }; }
  return { text: "", bg: "", color: "", visible: false };
}

export function computeGhost(s: State): GhostModel {
  return { ghost: s.ghost, mirror: s.query };
}

export function computePreview(s: State): PreviewModel {
  if (s.mode === "functional" || s.selectedIndex < 0) return { text: "", visible: false };
  const item = s.results[s.selectedIndex];
  if (!item) return { text: "", visible: false };
  return {
    text: (item.tabId != null ? "(tab) " : "") + item.url,
    visible: true,
  };
}

export function computeUI(s: State): UIModel {
  return {
    results: computeResultItems(s),
    pluginLabel: computePluginLabel(s),
    ghost: computeGhost(s),
    preview: computePreview(s),
  };
}
