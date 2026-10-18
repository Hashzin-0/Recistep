import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { tiktokConnector } from "./tiktok";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SOURCE_URL = "https://www.tiktok.com/@cozinha/video/123";
const VIDEO_URL = "https://v16-sign.tiktokcdn.com/video/play/recipe.mp4";
const THUMBNAIL_URL = "https://p16-sign.tiktokcdn.com/cover.jpg";

function stubFetch(handlers: Array<{ match: string | RegExp; respond: () => Response | Promise<Response> }>) {
  const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    for (const handler of handlers) {
      const matched = typeof handler.match === "string" ? url.includes(handler.match) : handler.match.test(url);
      if (matched) return handler.respond();
    }
    throw new Error(`UNEXPECTED_REQUEST:${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function tikwmResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    code: 0,
    data: {
      title: "Receita de bolo",
      author: { nickname: "Cozinha da Ana", unique_id: "cozinhaana" },
      cover: THUMBNAIL_URL,
      hdplay: VIDEO_URL,
      play: "https://v16-sign.tiktokcdn.com/video/play/standard.mp4",
      ...overrides,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function oembedResponse() {
  return new Response(JSON.stringify({
    title: "Receita pública",
    author_name: "Cozinha da Ana",
    provider_name: "TikTok",
    thumbnail_url: THUMBNAIL_URL,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("tiktokConnector (TikWM + official oEmbed)", () => {
  it("uses TikWM first and returns its validated video URL and metadata", async () => {
    stubFetch([
      { match: "www.tikwm.com/api/", respond: () => tikwmResponse() },
      { match: VIDEO_URL, respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/4194304" } }) },
    ]);

    await expect(tiktokConnector.resolve(SOURCE_URL)).resolves.toEqual({
      metadata: {
        title: "Receita de bolo",
        author_name: "Cozinha da Ana",
        provider_name: "TikTok",
        thumbnail_url: THUMBNAIL_URL,
      },
      content: { kind: "external_media", mediaUrl: VIDEO_URL, mimeType: "video/mp4" },
    });
  });

  it("falls back to official oEmbed metadata when TikWM fails, without pretending oEmbed provides video", async () => {
    stubFetch([
      { match: "www.tikwm.com/api/", respond: () => new Response(JSON.stringify({ code: 1 }), { status: 200 }) },
      { match: "www.tiktok.com/oembed", respond: () => oembedResponse() },
    ]);

    const resolved = await tiktokConnector.resolve(SOURCE_URL);
    expect(resolved.metadata).toEqual({
      title: "Receita pública",
      author_name: "Cozinha da Ana",
      provider_name: "TikTok",
      thumbnail_url: THUMBNAIL_URL,
    });
    expect(resolved.content).toMatchObject({
      kind: "transcript_required",
      code: "SOURCE_MEDIA_NOT_AVAILABLE",
    });
  });

  it("tries standard playback when HD playback is missing", async () => {
    stubFetch([
      { match: "www.tikwm.com/api/", respond: () => tikwmResponse({ hdplay: "", play: VIDEO_URL }) },
      { match: VIDEO_URL, respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/1000" } }) },
    ]);

    const resolved = await tiktokConnector.resolve(SOURCE_URL);
    expect(resolved.content).toMatchObject({ kind: "external_media", mediaUrl: VIDEO_URL });
  });

  it("rejects a TikWM media URL outside trusted TikTok/TikWM hosts", async () => {
    stubFetch([
      { match: "www.tikwm.com/api/", respond: () => tikwmResponse({ hdplay: "https://attacker.example/video.mp4", play: "", wmplay: "" }) },
      { match: "www.tiktok.com/oembed", respond: () => oembedResponse() },
    ]);

    const resolved = await tiktokConnector.resolve(SOURCE_URL);
    expect(resolved.content).toMatchObject({ kind: "transcript_required", code: "SOURCE_MEDIA_NOT_AVAILABLE" });
  });

  it("rejects source URLs outside the TikTok page host allowlist without network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(tiktokConnector.resolve("https://tiktok.com.attacker.example/@cook/video/123"))
      .rejects.toThrow("UNSUPPORTED_SOURCE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws metadata unavailable if both TikWM and official oEmbed fail", async () => {
    stubFetch([
      { match: "www.tikwm.com/api/", respond: () => new Response("unavailable", { status: 503 }) },
      { match: "www.tiktok.com/oembed", respond: () => new Response("not found", { status: 404 }) },
    ]);

    await expect(tiktokConnector.resolve(SOURCE_URL)).rejects.toThrow("SOURCE_METADATA_UNAVAILABLE");
  });
});
