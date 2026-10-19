import { describe, expect, it } from "vitest";
import { formatVideoClock } from "./video-player";

describe("formatVideoClock", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatVideoClock(0)).toBe("00:00");
    expect(formatVideoClock(65)).toBe("01:05");
    expect(formatVideoClock(600)).toBe("10:00");
  });

  it("adds hours when needed", () => {
    expect(formatVideoClock(3661)).toBe("1:01:01");
  });

  it("defends against invalid input", () => {
    expect(formatVideoClock(Number.NaN)).toBe("00:00");
    expect(formatVideoClock(-5)).toBe("00:00");
  });
});
