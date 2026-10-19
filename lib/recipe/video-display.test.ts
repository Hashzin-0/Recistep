import { describe, expect, it } from "vitest";
import {
  buildVideoDisplay,
  inferPlatformFromUrl,
  instagramShortcode,
  tiktokVideoId,
  youtubeVideoId,
} from "./video-display";

describe("inferPlatformFromUrl", () => {
  it("recognizes the supported hosts", () => {
    expect(inferPlatformFromUrl("https://youtu.be/abc")).toBe("youtube");
    expect(inferPlatformFromUrl("https://www.youtube.com/watch?v=abc")).toBe("youtube");
    expect(inferPlatformFromUrl("https://www.tiktok.com/@a/video/1")).toBe("tiktok");
    expect(inferPlatformFromUrl("https://www.instagram.com/reel/abc/")).toBe("instagram");
  });

  it("returns null for unknown hosts and invalid URLs", () => {
    expect(inferPlatformFromUrl("https://example.com/video")).toBeNull();
    expect(inferPlatformFromUrl("not a url")).toBeNull();
  });
});

describe("platform identifiers", () => {
  it("extracts the YouTube video id from every URL shape", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.tiktok.com/@a/video/123456789")).toBeNull();
  });

  it("extracts the TikTok video id", () => {
    expect(tiktokVideoId("https://www.tiktok.com/@cook/video/7412345678901234567")).toBe("7412345678901234567");
    expect(tiktokVideoId("https://www.tiktok.com/embed/v2/7412345678901234567")).toBe("7412345678901234567");
    expect(tiktokVideoId("https://vm.tiktok.com/ZMabc/")).toBeNull();
  });

  it("extracts the Instagram shortcode and kind", () => {
    expect(instagramShortcode("https://www.instagram.com/reel/Cabc123/")).toEqual({ shortcode: "Cabc123", kind: "reel" });
    expect(instagramShortcode("https://www.instagram.com/p/Cabc123/")).toEqual({ shortcode: "Cabc123", kind: "p" });
    expect(instagramShortcode("https://www.instagram.com/perfil/")).toBeNull();
  });
});

describe("buildVideoDisplay", () => {
  it("builds a YouTube embed with a thumbnail fallback", () => {
    const display = buildVideoDisplay({
      platform: "youtube",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Bolo",
    });

    expect(display).toMatchObject({
      platform: "youtube",
      embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&rel=0",
      thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      video_url: null,
    });
  });

  it("keeps the direct media URL for external media and still builds an embed", () => {
    const display = buildVideoDisplay({
      platform: "tiktok",
      sourceUrl: "https://www.tiktok.com/@cook/video/7412345678901234567",
      videoUrl: "https://v16-sign.tiktokcdn.com/video/play/abc.mp4",
    });

    expect(display).toMatchObject({
      platform: "tiktok",
      embed_url: "https://www.tiktok.com/embed/v2/7412345678901234567",
      video_url: "https://v16-sign.tiktokcdn.com/video/play/abc.mp4",
    });
  });

  it("uses the Instagram embed path for reels", () => {
    const display = buildVideoDisplay({
      platform: "instagram",
      sourceUrl: "https://www.instagram.com/reel/Cabc123/",
    });

    expect(display?.embed_url).toBe("https://www.instagram.com/reel/Cabc123/embed/");
  });

  it("infers the platform from the URL when it is not provided", () => {
    const display = buildVideoDisplay({ platform: null, sourceUrl: "https://youtu.be/dQw4w9WgXcQ" });
    expect(display?.platform).toBe("youtube");
  });

  it("returns null without a platform or without any URL", () => {
    expect(buildVideoDisplay({ platform: null, sourceUrl: null })).toBeNull();
    expect(buildVideoDisplay({ platform: null, sourceUrl: "https://example.com/video" })).toBeNull();
    expect(buildVideoDisplay({ platform: "tiktok", sourceUrl: null })).toBeNull();
  });
});
