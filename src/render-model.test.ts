import { describe, test, expect } from "vitest";
import { segmentHighlight, hexToRgba, looksLikeUrl, computeMode, computeResultItems, computePluginLabel, computeGhost, computePreview, computeUI } from "./render-model";
import type { State } from "./types";

// --- Factory for default state ---
function makeState(overrides: Partial<State> = {}): State {
  return {
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
    ...overrides,
  };
}

describe("hexToRgba", () => {
  test("converts hex to rgba", () => {
    expect(hexToRgba("#89b4fa", 0.15)).toBe("rgba(137,180,250,0.15)");
  });
  test("handles black", () => {
    expect(hexToRgba("#000000", 1)).toBe("rgba(0,0,0,1)");
  });
});

describe("segmentHighlight", () => {
  test("no query returns single unhighlighted segment", () => {
    expect(segmentHighlight("hello world", "")).toEqual([
      { text: "hello world", highlight: false },
    ]);
  });

  test("single term match", () => {
    expect(segmentHighlight("hello world", "world")).toEqual([
      { text: "hello ", highlight: false },
      { text: "world", highlight: true },
    ]);
  });

  test("match at start", () => {
    expect(segmentHighlight("hello world", "hello")).toEqual([
      { text: "hello", highlight: true },
      { text: " world", highlight: false },
    ]);
  });

  test("multiple terms", () => {
    expect(segmentHighlight("foo bar baz", "foo baz")).toEqual([
      { text: "foo", highlight: true },
      { text: " bar ", highlight: false },
      { text: "baz", highlight: true },
    ]);
  });

  test("case insensitive", () => {
    expect(segmentHighlight("GitHub", "git")).toEqual([
      { text: "Git", highlight: true },
      { text: "Hub", highlight: false },
    ]);
  });

  test("no match returns single unhighlighted segment", () => {
    expect(segmentHighlight("hello", "xyz")).toEqual([
      { text: "hello", highlight: false },
    ]);
  });

  test("entire string matches", () => {
    expect(segmentHighlight("test", "test")).toEqual([
      { text: "test", highlight: true },
    ]);
  });

  test("overlapping terms merge", () => {
    // "hel" and "ello" overlap in "hello"
    expect(segmentHighlight("hello", "hel ello")).toEqual([
      { text: "hello", highlight: true },
    ]);
  });

  test("whitespace-only query returns single unhighlighted segment", () => {
    expect(segmentHighlight("hello", "   ")).toEqual([
      { text: "hello", highlight: false },
    ]);
  });
});

describe("computeResultItems", () => {
  test("empty results returns empty array", () => {
    expect(computeResultItems(makeState())).toEqual([]);
  });

  test("normal mode maps SearchResult to ResultItemModel", () => {
    const s = makeState({
      query: "git",
      results: [{ type: "history", title: "GitHub", url: "https://github.com", score: 100 }],
      selectedIndex: 0,
    });
    const items = computeResultItems(s);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe("History");
    expect(items[0]!.labelColor).toBe("#a6e3a1");
    expect(items[0]!.selected).toBe(true);
    expect(items[0]!.primary).toEqual([
      { text: "Git", highlight: true },
      { text: "Hub", highlight: false },
    ]);
    expect(items[0]!.secondary).toEqual([
      { text: "https://", highlight: false },
      { text: "git", highlight: true },
      { text: "hub.com", highlight: false },
    ]);
  });

  test("tab type uses tab color", () => {
    const s = makeState({
      query: "test",
      results: [{ type: "tab", title: "Test", url: "https://test.com", score: 300, tabId: 1, windowId: 1 }],
    });
    const items = computeResultItems(s);
    expect(items[0]!.label).toBe("Tab");
    expect(items[0]!.labelColor).toBe("#89b4fa");
  });

  test("bookmark type uses bookmark color", () => {
    const s = makeState({
      query: "test",
      results: [{ type: "bookmark", title: "Test", url: "https://test.com", score: 50 }],
    });
    const items = computeResultItems(s);
    expect(items[0]!.label).toBe("Bookmark");
    expect(items[0]!.labelColor).toBe("#f9e2af");
  });

  test("categoryLabel and categoryColor override defaults", () => {
    const s = makeState({
      query: "test",
      results: [{ type: "history", title: "Test", url: "https://test.com", score: 100, categoryLabel: "GitHub", categoryColor: "#f0f" }],
    });
    const items = computeResultItems(s);
    expect(items[0]!.label).toBe("GitHub");
    expect(items[0]!.labelColor).toBe("#f0f");
  });

  test("unknown type falls back to type string and default color", () => {
    const s = makeState({
      query: "test",
      results: [{ type: "unknown" as any, title: "Test", url: "https://test.com", score: 50 }],
    });
    const items = computeResultItems(s);
    expect(items[0]!.label).toBe("unknown");
    expect(items[0]!.labelColor).toBe("#a6adc8");
  });

  test("selectedIndex marks correct item", () => {
    const s = makeState({
      query: "test",
      results: [
        { type: "history", title: "A", url: "https://a.com", score: 100 },
        { type: "history", title: "B", url: "https://b.com", score: 90 },
      ],
      selectedIndex: 1,
    });
    const items = computeResultItems(s);
    expect(items[0]!.selected).toBe(false);
    expect(items[1]!.selected).toBe(true);
  });

  test("hasPrefix strips first word from query for highlighting", () => {
    const s = makeState({
      query: "h github",
      hasPrefix: true,
      results: [{ type: "history", title: "GitHub", url: "https://github.com", score: 100 }],
    });
    const items = computeResultItems(s);
    // Should highlight "github" not "h"
    expect(items[0]!.primary).toEqual([
      { text: "GitHub", highlight: true },
    ]);
  });

  test("functional mode maps FnResult to ResultItemModel", () => {
    const s = makeState({
      mode: "functional",
      functionalResults: [
        { value: "42", action: "copy" },
        { value: "abc-123", action: "copy" },
      ],
      selectedIndex: 0,
    });
    const items = computeResultItems(s);
    expect(items).toHaveLength(2);
    expect(items[0]!.label).toBe("");
    expect(items[0]!.labelColor).toBe("");
    expect(items[0]!.primary).toEqual([{ text: "42", highlight: false }]);
    expect(items[0]!.secondary).toEqual([]);
    expect(items[0]!.selected).toBe(true);
    expect(items[1]!.selected).toBe(false);
  });

  test("functional mode with label and secondary", () => {
    const s = makeState({
      mode: "functional",
      query: "/plugins ",
      hasPrefix: true,
      functionalResults: [
        { value: "cp", action: "fill", label: "CodePackage", labelColor: "#89b4fa", secondary: "git.example.com/packages/**" },
      ],
      selectedIndex: 0,
    });
    const items = computeResultItems(s);
    expect(items[0]!.label).toBe("CodePackage");
    expect(items[0]!.labelColor).toBe("#89b4fa");
    expect(items[0]!.primary).toEqual([{ text: "cp", highlight: false }]);
    expect(items[0]!.secondary).toEqual([{ text: "git.example.com/packages/**", highlight: false }]);
  });

  test("functional mode highlights primary and secondary with query", () => {
    const s = makeState({
      mode: "functional",
      query: "/plugins task",
      hasPrefix: true,
      functionalResults: [
        { value: "tt", action: "fill", label: "TaskTracker", labelColor: "#cba6f7", secondary: "tasks.example.dev/tasks/**" },
      ],
      selectedIndex: 0,
    });
    const items = computeResultItems(s);
    expect(items[0]!.label).toBe("TaskTracker");
    expect(items[0]!.primary).toEqual([{ text: "tt", highlight: false }]);
    expect(items[0]!.secondary).toEqual([
      { text: "task", highlight: true },
      { text: "s.example.dev/tasks/**", highlight: false },
    ]);
  });
  test("functional mode with open action and url", () => {
    const s = makeState({
      mode: "functional",
      query: "/translate hello",
      hasPrefix: true,
      functionalResults: [
        { value: "EN→中: hello", action: "open", url: "https://translate.google.com/?sl=en&tl=zh-CN&text=hello&op=translate", secondary: "Open Google Translate", noHighlight: true },
      ],
      selectedIndex: 0,
    });
    const items = computeResultItems(s);
    expect(items).toHaveLength(1);
    expect(items[0]!.primary).toEqual([{ text: "EN→中: hello", highlight: false }]);
    expect(items[0]!.secondary).toEqual([{ text: "Open Google Translate", highlight: false }]);
  });
});

describe("computePluginLabel", () => {
  test("no plugin or source returns hidden", () => {
    const model = computePluginLabel(makeState());
    expect(model.visible).toBe(false);
    expect(model.text).toBe("");
  });

  test("functional plugin hides label", () => {
    const model = computePluginLabel(makeState({
      functionalPlugin: { name: "Compute", prefix: "/compute" },
    }));
    expect(model.visible).toBe(false);
  });

  test("functional listing hides label", () => {
    const model = computePluginLabel(makeState({ functionalListing: true }));
    expect(model.visible).toBe(false);
  });

  test("pattern plugin shows plugin name", () => {
    const model = computePluginLabel(makeState({
      activePlugin: { name: "GitHub", prefix: "gh", pluginType: "pattern", patterns: ["github.com/**"], color: "#f0f" },
    }));
    expect(model.visible).toBe(true);
    expect(model.text).toBe("GitHub");
    expect(model.color).toBe("#f0f");
  });

  test("activePlugin without color falls back to default", () => {
    const model = computePluginLabel(makeState({
      activePlugin: { name: "NoColor", prefix: "nc", pluginType: "pattern", patterns: [], color: "" },
    }));
    expect(model.visible).toBe(true);
    expect(model.text).toBe("NoColor");
    expect(model.color).toBe("#a6adc8");
  });

  test("source without matching color falls back to default", () => {
    const model = computePluginLabel(makeState({ source: "unknown" }));
    expect(model.visible).toBe(true);
    expect(model.color).toBe("#a6adc8");
  });

  test("source filter shows source label", () => {
    const model = computePluginLabel(makeState({ source: "tabs" }));
    expect(model.visible).toBe(true);
    expect(model.text).toBe("Tabs");
    expect(model.color).toBe("#89b4fa");
  });

  test("priority: functional hidden, then activePlugin > source", () => {
    const model = computePluginLabel(makeState({
      functionalPlugin: { name: "Compute", prefix: "/compute" },
      functionalListing: true,
      activePlugin: { name: "GitHub", prefix: "gh", pluginType: "pattern", patterns: [], color: "#f0f" },
      source: "tabs",
    }));
    expect(model.visible).toBe(false);
  });
});

describe("computeGhost", () => {
  test("returns query as mirror and ghost from state", () => {
    const model = computeGhost(makeState({ query: "gith", ghost: "ub.com" }));
    expect(model.mirror).toBe("gith");
    expect(model.ghost).toBe("ub.com");
  });

  test("empty state", () => {
    const model = computeGhost(makeState());
    expect(model.mirror).toBe("");
    expect(model.ghost).toBe("");
  });
});

describe("computePreview", () => {
  test("no selection returns hidden", () => {
    const model = computePreview(makeState({ selectedIndex: -1 }));
    expect(model.visible).toBe(false);
    expect(model.text).toBe("");
  });

  test("selected result shows URL", () => {
    const model = computePreview(makeState({
      selectedIndex: 0,
      results: [{ type: "history", title: "GitHub", url: "https://github.com", score: 100 }],
    }));
    expect(model.visible).toBe(true);
    expect(model.text).toBe("https://github.com");
  });

  test("selected tab shows (tab) prefix", () => {
    const model = computePreview(makeState({
      selectedIndex: 0,
      results: [{ type: "tab", title: "GitHub", url: "https://github.com", score: 300, tabId: 1, windowId: 1 }],
    }));
    expect(model.text).toBe("(tab) https://github.com");
  });

  test("functional mode returns hidden", () => {
    const model = computePreview(makeState({
      mode: "functional",
      selectedIndex: 0,
      results: [{ type: "history", title: "X", url: "https://x.com", score: 1 }],
    }));
    expect(model.visible).toBe(false);
  });

  test("out of bounds index returns hidden", () => {
    const model = computePreview(makeState({
      selectedIndex: 5,
      results: [{ type: "history", title: "X", url: "https://x.com", score: 1 }],
    }));
    expect(model.visible).toBe(false);
  });
});

describe("computeUI", () => {
  test("returns all sub-models", () => {
    const ui = computeUI(makeState());
    expect(ui.results).toEqual([]);
    expect(ui.pluginLabel.visible).toBe(false);
    expect(ui.ghost).toEqual({ ghost: "", mirror: "" });
    expect(ui.preview.visible).toBe(false);
  });
});

describe("computeMode", () => {
  test("normal when no plugin or functional state", () => {
    expect(computeMode(makeState())).toBe("normal");
  });
  test("plugin when activePlugin set", () => {
    expect(computeMode(makeState({ activePlugin: { name: "p" } as never }))).toBe("plugin");
  });
  test("functional when functionalListing set", () => {
    expect(computeMode(makeState({ functionalListing: true }))).toBe("functional");
  });
  test("functional when functionalPlugin set", () => {
    expect(computeMode(makeState({ functionalPlugin: { name: "p" } as never }))).toBe("functional");
  });
  test("functional takes precedence over plugin", () => {
    expect(computeMode(makeState({ activePlugin: { name: "p" } as never, functionalListing: true }))).toBe("functional");
  });
});

describe("looksLikeUrl", () => {
  test("matches domain with TLD", () => {
    expect(looksLikeUrl("github.com")).toBe(true);
    expect(looksLikeUrl("github.com/user/repo")).toBe(true);
    expect(looksLikeUrl("docs.example.com")).toBe(true);
  });
  test("matches explicit protocol", () => {
    expect(looksLikeUrl("https://example.com")).toBe(true);
    expect(looksLikeUrl("http://localhost:3000")).toBe(true);
  });
  test("rejects plain words", () => {
    expect(looksLikeUrl("hello world")).toBe(false);
    expect(looksLikeUrl("just a search")).toBe(false);
    expect(looksLikeUrl("react")).toBe(false);
  });
  test("rejects dots without valid TLD", () => {
    expect(looksLikeUrl("file.a")).toBe(false);
    expect(looksLikeUrl("v1.0")).toBe(false);
  });
  test("matches IP-like patterns", () => {
    expect(looksLikeUrl("192.168.1.1")).toBe(true);
  });
});
