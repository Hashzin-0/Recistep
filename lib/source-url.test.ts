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

  it("recognizes TikTok short links and photo posts", () => {
    const shortLink = validateSourceUrl("https://vm.tiktok.com/ZMabcdef/");
    expect(shortLink.ok).toBe(true);
    if (shortLink.ok) {
      expect(shortLink.platform).toBe("tiktok");
      expect(shortLink.url.hostname).toBe("vm.tiktok.com");
    }

    expect(validateSourceUrl("https://www.tiktok.com/@cook/photo/123").ok).toBe(true);
    expect(validateSourceUrl("https://vt.tiktok.com/Zabcdef/").ok).toBe(true);
  });

  it("recognizes Instagram links", () => {
    const result = validateSourceUrl("https://www.instagram.com/reel/CxYz123AbC_");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.platform).toBe("instagram");
  });

  it("recognizes Instagram posts, reels and share links", () => {
    expect(validateSourceUrl("https://instagram.com/p/CxYz123AbC_/").ok).toBe(true);
    expect(validateSourceUrl("https://www.instagram.com/reels/CxYz123/").ok).toBe(true);
    expect(validateSourceUrl("https://www.instagram.com/tv/CxYz123/").ok).toBe(true);
    expect(validateSourceUrl("https://www.instagram.com/share/reel/CxYz123/").ok).toBe(true);
  });

  it("rejects profile and feed pages because they cannot be extracted", () => {
    const profile = validateSourceUrl("https://www.instagram.com/cozinha.ana/");
    expect(profile.ok).toBe(false);
    if (!profile.ok) expect(profile.code).toBe("UNSUPPORTED_SOURCE");

    expect(validateSourceUrl("https://www.tiktok.com/@cozinha.ana").ok).toBe(false);
    expect(validateSourceUrl("https://www.instagram.com/").ok).toBe(false);
    expect(validateSourceUrl("https://vm.tiktok.com/").ok).toBe(false);
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
  it("recognizes the exact YouTube video supplied for the end-to-end test", () => {
    const result = validateSourceUrl("https://youtu.be/olw3gMc4YlU?is=JlA_W00Jux4R6fQO");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.platform).toBe("youtube");
      expect(result.url.hostname).toBe("youtu.be");
      expect(result.url.pathname).toBe("/olw3gMc4YlU");
    }
  });
});
