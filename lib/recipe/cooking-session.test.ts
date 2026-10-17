import { describe, expect, it } from "vitest";
import { createRunningTimer, formatDuration, pauseTimer, remainingTimerSeconds, resumeTimer } from "./cooking-session";

describe("cooking timer helpers", () => {
  it("formats elapsed time without losing hours", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
  });
  it("derives remaining time from an absolute deadline", () => {
    const timer = createRunningTimer(2, 90, 1000);
    expect(remainingTimerSeconds(timer, 31_000)).toBe(60);
    expect(remainingTimerSeconds(timer, 100_000)).toBe(0);
  });
  it("preserves remaining time when paused and resumed", () => {
    const running = createRunningTimer(1, 120, 1000);
    const paused = pauseTimer(running, 41_000);
    expect(remainingTimerSeconds(paused, 500_000)).toBe(80);
    const resumed = resumeTimer(paused, 500_000);
    expect(remainingTimerSeconds(resumed, 520_000)).toBe(60);
  });
  it("rejects invalid durations", () => {
    expect(() => createRunningTimer(0, 0, 0)).toThrow(RangeError);
    expect(() => createRunningTimer(0, 604801, 0)).toThrow(RangeError);
  });
});
