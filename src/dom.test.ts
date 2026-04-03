/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { highlightIndex, buildResultRow, hexToRgba, truncateUrl } from "./dom";
import type { SearchResult } from "./types";

const makeResult = (type: SearchResult["type"] = "history", title = "Test", url = "https://example.com"): SearchResult => ({
  type, title, url, score: 50,
});

describe("highlightIndex", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    for (let i = 0; i < 5; i++) {
      const row = document.createElement("div");
      row.className = "xun-result";
      container.appendChild(row);
    }
  });

  it("adds xun-selected to the correct row", () => {
    highlightIndex(container, 2);
    expect(container.children[2]!.classList.contains("xun-selected")).toBe(true);
  });

  it("removes xun-selected from previously selected row", () => {
    container.children[1]!.classList.add("xun-selected");
    highlightIndex(container, 3);
    expect(container.children[1]!.classList.contains("xun-selected")).toBe(false);
    expect(container.children[3]!.classList.contains("xun-selected")).toBe(true);
  });

  it("handles out-of-bounds index gracefully", () => {
    highlightIndex(container, 99);
    expect(container.querySelectorAll(".xun-selected")).toHaveLength(0);
  });

  it("handles negative index gracefully", () => {
    highlightIndex(container, -1);
    expect(container.querySelectorAll(".xun-selected")).toHaveLength(0);
  });

  it("only one row is selected at a time", () => {
    highlightIndex(container, 0);
    highlightIndex(container, 4);
    expect(container.querySelectorAll(".xun-selected")).toHaveLength(1);
    expect(container.children[4]!.classList.contains("xun-selected")).toBe(true);
  });
});

describe("buildResultRow", () => {
  const colors = { tabs: "#89b4fa", bookmarks: "#f9e2af", history: "#a6e3a1" };

  it("creates a row with type, title, and url spans", () => {
    const row = buildResultRow(makeResult("history", "My Page", "https://example.com/page"), 0, false, colors);
    expect(row.className).toBe("xun-result");
    expect(row.querySelector(".xun-type")!.textContent).toBe("History");
    expect(row.querySelector(".xun-title")!.textContent).toBe("My Page");
    expect(row.querySelector(".xun-url")!.textContent).toBe("example.com/page");
  });

  it("adds xun-selected class when isSelected is true", () => {
    const row = buildResultRow(makeResult(), 0, true, colors);
    expect(row.classList.contains("xun-selected")).toBe(true);
  });

  it("does not add xun-selected when isSelected is false", () => {
    const row = buildResultRow(makeResult(), 0, false, colors);
    expect(row.classList.contains("xun-selected")).toBe(false);
  });

  it("uses categoryLabel and categoryColor when present", () => {
    const item = { ...makeResult(), categoryLabel: "Pipeline", categoryColor: "#f38ba8" };
    const row = buildResultRow(item, 0, false, colors);
    expect(row.querySelector(".xun-type")!.textContent).toBe("Pipeline");
  });

  it("sets data-index attribute", () => {
    const row = buildResultRow(makeResult(), 3, false, colors);
    expect(row.dataset["index"]).toBe("3");
  });

  it("uses correct source color for tabs", () => {
    const row = buildResultRow(makeResult("tab"), 0, false, colors);
    const typeSpan = row.querySelector(".xun-type") as HTMLElement;
    expect(typeSpan.style.color).toBe("#89b4fa");
  });
});

describe("hexToRgba", () => {
  it("converts hex to rgba", () => {
    expect(hexToRgba("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
    expect(hexToRgba("#89b4fa", 0.15)).toBe("rgba(137,180,250,0.15)");
  });
});

describe("truncateUrl", () => {
  it("strips protocol and shows hostname + path", () => {
    expect(truncateUrl("https://example.com/page")).toBe("example.com/page");
  });

  it("strips trailing slash", () => {
    expect(truncateUrl("https://example.com/")).toBe("example.com");
  });

  it("truncates long URLs with ellipsis", () => {
    const long = "https://example.com/" + "a".repeat(80);
    expect(truncateUrl(long).endsWith("…")).toBe(true);
    expect(truncateUrl(long).length).toBe(61);
  });

  it("handles invalid URLs", () => {
    expect(truncateUrl("not-a-url")).toBe("not-a-url");
  });
});
