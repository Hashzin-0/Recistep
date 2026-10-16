import { describe, expect, it } from "vitest";
import { validateSourceUrl } from "./source-url";

describe("validateSourceUrl", () => {
  it("recognizes YouTube links", () => {
    const result = validateSourceUrl("https://www.youtube.com/watch?v=abc123");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.platform).toBe("youtube");
  });

  it("recognizes TikTok links", () => {
    const result = validateSourceUrl("https://www.tiktok.com/@cook/video/123");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.platform).toBe("tiktok");
  });

  it("rejects non-HTTPS URLs", () => {
    expect(validateSourceUrl("http://youtube.com/watch?v=x").ok).toBe(false);
  });

  it("rejects credentials in URLs", () => {
    expect(validateSourceUrl("https://user:pass@youtube.com/watch?v=x").ok).toBe(false);
  });

  it("rejects lookalike and unrecognized hosts", () => {
    expect(validateSourceUrl("https://youtube.com.attacker.example/watch?v=x").ok).toBe(false);
  });

  it("rejects custom ports", () => {
    expect(validateSourceUrl("https://youtube.com:8443/watch?v=x").ok).toBe(false);
  });

  it("rejects oversized input", () => {
    expect(validateSourceUrl("https://youtube.com/" + "a".repeat(2050)).ok).toBe(false);
  });
});
