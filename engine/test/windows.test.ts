import { describe, expect, it } from "vitest";
import { createWindows } from "../src/whisper/windows";

describe("createWindows", () => {
  it("handles empty and short media", () => {
    expect(createWindows(0)).toEqual([]);
    expect(createWindows(12)).toEqual([{ index: 0, start: 0, end: 12 }]);
    expect(createWindows(30)).toEqual([{ index: 0, start: 0, end: 30 }]);
  });

  it("overlaps a boundary and handles the final short window", () => {
    expect(createWindows(31)).toEqual([
      { index: 0, start: 0, end: 30 },
      { index: 1, start: 25, end: 31 },
    ]);
  });

  it("covers a one-hour file without a window beyond the duration", () => {
    const windows = createWindows(3_600);
    expect(windows.length).toBe(144);
    expect(windows[0]).toEqual({ index: 0, start: 0, end: 30 });
    expect(windows.at(-1)).toEqual({ index: 143, start: 3_575, end: 3_600 });
    expect(windows.every((window) => window.start < window.end && window.end <= 3_600)).toBe(true);
  });
});
