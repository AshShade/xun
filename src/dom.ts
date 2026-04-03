import type { SearchResult } from "./types";

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    const display = u.hostname + path;
    return display.length > 60 ? display.slice(0, 60) + "…" : display;
  } catch { return url.slice(0, 60); }
}

const TYPE_LABELS: Record<string, string> = { tab: "Tab", bookmark: "Bookmark", history: "History" };
const TYPE_SOURCE_MAP: Record<string, string> = { tab: "tabs", bookmark: "bookmarks", history: "history" };

export function highlightIndex(container: Element, index: number): void {
  container.querySelectorAll(".xun-selected").forEach((el) => el.classList.remove("xun-selected"));
  const row = container.children[index] as HTMLElement | undefined;
  if (row) { row.classList.add("xun-selected"); row.scrollIntoView({ block: "nearest" }); }
}

export function buildResultRow(
  item: SearchResult, index: number, isSelected: boolean,
  sourceColors: Record<string, string>,
): HTMLDivElement {
  const label = item.categoryLabel || TYPE_LABELS[item.type] || item.type;
  const color = item.categoryColor || sourceColors[TYPE_SOURCE_MAP[item.type] ?? ""] || "#a6adc8";

  const row = document.createElement("div");
  row.className = "xun-result" + (isSelected ? " xun-selected" : "");
  row.dataset["index"] = String(index);

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

  return row;
}
