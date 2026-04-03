declare const DEFAULT_CONFIG: typeof import("./lib").DEFAULT_CONFIG;

import type { Config, Shortcut } from "./types";

const editor = document.getElementById("editor") as HTMLTextAreaElement;
const statusEl = document.getElementById("status")!;

const isMac = navigator.platform.includes("Mac");
const DEFAULT_SHORTCUT: Shortcut = isMac
  ? { ctrlKey: false, shiftKey: false, altKey: false, metaKey: true, key: "k" }
  : { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: "k" };

const DEFAULTS = { shortcut: DEFAULT_SHORTCUT, config: DEFAULT_CONFIG };

function flash(msg: string, ok: boolean): void {
  statusEl.textContent = msg;
  statusEl.className = ok ? "ok" : "err";
  statusEl.style.opacity = "1";
  setTimeout(() => { statusEl.style.opacity = "0"; }, 2000);
}

browser.storage.local.get(["shortcut", "config"]).then(({ shortcut, config }: { shortcut?: Shortcut; config?: Config }) => {
  editor.value = JSON.stringify({ shortcut: shortcut || DEFAULTS.shortcut, config: config || DEFAULTS.config }, null, 2);
});

document.getElementById("save-btn")!.addEventListener("click", () => {
  try {
    const data = JSON.parse(editor.value) as { shortcut?: Shortcut; config?: Config };
    const promises: Promise<void>[] = [];
    if (data.shortcut) promises.push(browser.storage.local.set({ shortcut: data.shortcut }));
    if (data.config) promises.push(browser.storage.local.set({ config: data.config }));
    Promise.all(promises).then(() => flash("Saved", true));
  } catch (e) {
    flash("Invalid JSON: " + (e instanceof Error ? e.message : String(e)), false);
  }
});

document.getElementById("format-btn")!.addEventListener("click", () => {
  try {
    const data: unknown = JSON.parse(editor.value);
    editor.value = JSON.stringify(data, null, 2);
    flash("Formatted", true);
  } catch (e) {
    flash("Invalid JSON: " + (e instanceof Error ? e.message : String(e)), false);
  }
});

document.getElementById("reset-btn")!.addEventListener("click", () => {
  editor.value = JSON.stringify(DEFAULTS, null, 2);
  flash("Reset to defaults (click Save to apply)", true);
});

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    document.getElementById("save-btn")!.click();
  }
});

editor.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const start = editor.selectionStart;
    editor.value = editor.value.substring(0, start) + "  " + editor.value.substring(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = start + 2;
  }
});

document.getElementById("toggle-docs")!.addEventListener("click", () => {
  document.getElementById("docs")!.classList.toggle("hidden");
});

// Doc examples are inline in editor.html
