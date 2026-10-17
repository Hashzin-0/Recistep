import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { fetchYouTubePublicMetadata } from "./youtube-oembed";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchYouTubePublicMetadata", () => {
  it("rejects hosts outside the YouTube allowlist without network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchYouTubePublicMetadata("https://youtube.com.attacker.example/watch?v=x"),
    ).rejects.toThrow("UNSUPPORTED_SOURCE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns only validated public metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: "Receita pública",
      author_name: "Canal culinário",
      provider_name: "YouTube",
      thumbnail_url: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchYouTubePublicMetadata("https://www.youtube.com/watch?v=abc"),
    ).resolves.toEqual({
      title: "Receita pública",
      author_name: "Canal culinário",
      provider_name: "YouTube",
      thumbnail_url: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    });

    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.origin).toBe("https://www.youtube.com");
    expect(requestedUrl.pathname).toBe("/oembed");
  });

  it("requests public metadata for the exact user-provided video URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: "Vídeo de teste Recistep",
      author_name: "Canal de teste",
      provider_name: "YouTube",
      thumbnail_url: "https://i.ytimg.com/vi/olw3gMc4YlU/hqdefault.jpg",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchYouTubePublicMetadata("https://youtu.be/olw3gMc4YlU?is=JlA_W00Jux4R6fQO"),
    ).resolves.toMatchObject({
      title: "Vídeo de teste Recistep",
      provider_name: "YouTube",
    });

    const endpoint = new URL(String(fetchMock.mock.calls[0][0]));
    expect(endpoint.origin).toBe("https://www.youtube.com");
    expect(endpoint.pathname).toBe("/oembed");
    expect(endpoint.searchParams.get("url")).toBe("https://youtu.be/olw3gMc4YlU?is=JlA_W00Jux4R6fQO");
  });

  it("rejects thumbnails served from untrusted hosts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      title: "Receita",
      thumbnail_url: "https://attacker.example/thumbnail.jpg",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(
      fetchYouTubePublicMetadata("https://youtu.be/abc"),
    ).rejects.toThrow("SOURCE_METADATA_INVALID");
  });
});
