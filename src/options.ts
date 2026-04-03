declare const validateConfig: typeof import("./lib").validateConfig;
declare const DEFAULT_CONFIG: typeof import("./lib").DEFAULT_CONFIG;

import type { Config, Plugin, Shortcut } from "./types";

const status = document.getElementById("status")!;
const shortcutInput = document.getElementById("shortcut") as HTMLInputElement;
const prefixHistory = document.getElementById("prefix-history") as HTMLInputElement;
const prefixTabs = document.getElementById("prefix-tabs") as HTMLInputElement;
const prefixBookmarks = document.getElementById("prefix-bookmarks") as HTMLInputElement;
const searchEngine = document.getElementById("search-engine") as HTMLInputElement;
const categoriesEl = document.getElementById("categories")!;
const addCatBtn = document.getElementById("add-cat")!;
const builtinRows = document.querySelectorAll<HTMLDivElement>(".prefix-row[data-source]");

const isMac = navigator.platform.includes("Mac");
const DEFAULT_SHORTCUT: Shortcut = isMac
  ? { ctrlKey: false, shiftKey: false, altKey: false, metaKey: true, key: "k" }
  : { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: "k" };

interface PaletteColor { name: string; hex: string }
const PALETTE: PaletteColor[] = [
  { name: "Red", hex: "#f38ba8" }, { name: "Maroon", hex: "#eba0ac" },
  { name: "Peach", hex: "#fab387" }, { name: "Yellow", hex: "#f9e2af" },
  { name: "Green", hex: "#a6e3a1" }, { name: "Teal", hex: "#94e2d5" },
  { name: "Sky", hex: "#89dceb" }, { name: "Sapphire", hex: "#74c7ec" },
  { name: "Blue", hex: "#89b4fa" }, { name: "Lavender", hex: "#b4befe" },
  { name: "Mauve", hex: "#cba6f7" }, { name: "Pink", hex: "#f5c2e7" },
  { name: "Flamingo", hex: "#f2cdcd" }, { name: "Rosewater", hex: "#f5e0dc" },
];

function getAllColorRows(): HTMLDivElement[] {
  return [...builtinRows, ...categoriesEl.querySelectorAll<HTMLDivElement>(".cat-row")];
}

function getAssignedColors(excludeRow?: HTMLDivElement): Set<string> {
  const assigned = new Set<string>();
  getAllColorRows().forEach((row) => { if (row !== excludeRow) assigned.add(row.dataset["color"] ?? ""); });
  return assigned;
}

function nextAvailableColor(): string {
  const assigned = getAssignedColors();
  return PALETTE.find((c) => !assigned.has(c.hex))?.hex ?? PALETTE[0]!.hex;
}

function buildColorPicker(row: HTMLDivElement): void {
  const currentHex = row.dataset["color"] ?? "";
  const picker = row.querySelector<HTMLDivElement>(".color-picker")!;
  const assigned = getAssignedColors(row);
  const current = PALETTE.find((c) => c.hex === currentHex) ?? PALETTE[0]!;

  picker.innerHTML = `
    <button class="color-toggle" style="background:${current.hex}" title="${current.name}"></button>
    <div class="color-dropdown"></div>
  `;

  const dropdown = picker.querySelector<HTMLDivElement>(".color-dropdown")!;
  PALETTE.forEach((c) => {
    if (assigned.has(c.hex)) return;
    const btn = document.createElement("button");
    btn.className = "color-btn" + (c.hex === currentHex ? " selected" : "");
    btn.title = c.name;
    btn.style.background = c.hex;
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      row.dataset["color"] = c.hex;
      dropdown.classList.remove("open");
      refreshAllPickers();
      saveConfig();
    });
    dropdown.appendChild(btn);
  });

  picker.querySelector<HTMLButtonElement>(".color-toggle")!.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    document.querySelectorAll<HTMLDivElement>(".color-dropdown.open").forEach((d) => { if (d !== dropdown) d.classList.remove("open"); });
    dropdown.classList.toggle("open");
  });
}

function refreshAllPickers(): void {
  getAllColorRows().forEach((row) => buildColorPicker(row));
}

function shortcutToString(s: Shortcut): string {
  const parts: string[] = [];
  if (s.ctrlKey) parts.push("Ctrl");
  if (s.altKey) parts.push("Alt");
  if (s.shiftKey) parts.push("Shift");
  if (s.metaKey) parts.push("Cmd");
  parts.push(s.key === " " ? "Space" : s.key.length === 1 ? s.key.toUpperCase() : s.key);
  return parts.join("+");
}

function flash(): void {
  status.style.opacity = "1";
  setTimeout(() => { status.style.opacity = "0"; }, 1500);
}

function stripProtocol(s: string): string {
  return s.replace(/^https?:\/\//, "");
}

function saveConfig(): void {
  const plugins: Plugin[] = [...categoriesEl.querySelectorAll<HTMLDivElement>(".cat-row")].map((row) => {
    const name = row.querySelector<HTMLInputElement>("[name=name]")!.value;
    const prefix = row.querySelector<HTMLInputElement>("[name=prefix]")!.value.trim();
    const pluginType = (row.dataset["pluginType"] ?? "pattern") as "pattern" | "search";
    const color = row.dataset["color"] ?? "";

    if (pluginType === "search") {
      return { name, prefix, pluginType, url: row.querySelector<HTMLInputElement>("[name=url]")!.value, color };
    }
    return {
      name, prefix, pluginType,
      patterns: row.querySelector<HTMLInputElement>("[name=patterns]")!.value.split(",").map((s) => stripProtocol(s.trim())).filter(Boolean),
      color,
    };
  }).filter((p) => p.name && p.prefix);

  const sourceColors: Record<string, string> = {};
  builtinRows.forEach((row) => { sourceColors[row.dataset["source"] ?? ""] = row.dataset["color"] ?? ""; });

  const config: Config = {
    prefixes: { history: prefixHistory.value.trim(), tabs: prefixTabs.value.trim(), bookmarks: prefixBookmarks.value.trim() },
    sourceColors,
    searchEngine: searchEngine.value || DEFAULT_CONFIG.searchEngine,
    plugins,
  };
  browser.storage.local.set({ config }).then(flash);
}

function addCategoryRow(cat: Partial<Plugin> = {}): void {
  const color = cat.color || nextAvailableColor();
  const pluginType = cat.pluginType || "pattern";
  const row = document.createElement("div");
  row.className = "cat-row";
  row.dataset["color"] = color;
  row.dataset["pluginType"] = pluginType;

  const valueField = pluginType === "search"
    ? `<input name="url" type="text" placeholder="https://example.com/search?q=%s" value="${"url" in cat ? cat.url : ""}" />`
    : `<input name="patterns" type="text" placeholder="*.example.com" value="${"patterns" in cat ? (cat.patterns ?? []).join(", ") : ""}" />`;

  row.innerHTML = `
    <input name="prefix" type="text" placeholder="x" value="${cat.prefix || ""}" />
    <input name="name" type="text" placeholder="Name" value="${cat.name || ""}" />
    <select name="pluginType"><option value="pattern"${pluginType === "pattern" ? " selected" : ""}>Pattern</option><option value="search"${pluginType === "search" ? " selected" : ""}>Search</option></select>
    ${valueField}
    <div class="color-picker"></div>
    <button class="cat-remove">×</button>
  `;

  row.querySelector("select")!.addEventListener("change", (e) => {
    const newType = (e.target as HTMLSelectElement).value;
    row.dataset["pluginType"] = newType;
    const old = row.querySelector<HTMLInputElement>("[name=patterns],[name=url]")!;
    const replacement = document.createElement("input");
    replacement.type = "text";
    if (newType === "search") { replacement.name = "url"; replacement.placeholder = "https://example.com/search?q=%s"; }
    else { replacement.name = "patterns"; replacement.placeholder = "*.example.com"; }
    replacement.addEventListener("input", saveConfig);
    old.replaceWith(replacement);
    saveConfig();
  });

  row.querySelector(".cat-remove")!.addEventListener("click", () => { row.remove(); refreshAllPickers(); saveConfig(); });
  row.querySelectorAll("input").forEach((el) => el.addEventListener("input", saveConfig));
  categoriesEl.appendChild(row);
  refreshAllPickers();
}

// Load
browser.storage.local.get(["shortcut", "config"]).then(({ shortcut, config }: { shortcut?: Shortcut; config?: Config }) => {
  shortcutInput.value = shortcutToString(shortcut || DEFAULT_SHORTCUT);
  const c: Config = validateConfig(config);
  prefixHistory.value = c.prefixes["history"] ?? "h";
  prefixTabs.value = c.prefixes["tabs"] ?? "t";
  prefixBookmarks.value = c.prefixes["bookmarks"] ?? "b";
  searchEngine.value = c.searchEngine;
  builtinRows.forEach((row) => {
    const src = row.dataset["source"] ?? "";
    if (c.sourceColors[src]) row.dataset["color"] = c.sourceColors[src];
  });
  c.plugins.forEach((cat) => addCategoryRow(cat));
  refreshAllPickers();
});

shortcutInput.addEventListener("keydown", (e: KeyboardEvent) => {
  e.preventDefault();
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
  const s: Shortcut = { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, key: e.key };
  shortcutInput.value = shortcutToString(s);
  browser.storage.local.set({ shortcut: s }).then(flash);
});

[prefixHistory, prefixTabs, prefixBookmarks, searchEngine].forEach((el) => el.addEventListener("input", saveConfig));
addCatBtn.addEventListener("click", () => addCategoryRow());

document.addEventListener("click", () => {
  document.querySelectorAll<HTMLDivElement>(".color-dropdown.open").forEach((d) => d.classList.remove("open"));
});

document.getElementById("edit-json")!.addEventListener("click", () => {
  browser.tabs.create({ url: browser.runtime.getURL("editor.html") });
});
