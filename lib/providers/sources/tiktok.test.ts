import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { tiktokConnector } from "./tiktok";

afterEach(() => {
  vi.unstubAllGlobals();
});

const VIDEO_URL = "https://v16-sign.tiktokcdn.com/video/play/abc.mp4";
const COVER_URL = "https://p16-sign.tiktokcdn.com/cover.jpg";
const SUBTITLE_URL = "https://v16m-webapp.tiktokcdn-us.com/sub/play.vtt";

function rehydrationPage(video: Record<string, unknown>, statusCode = 0): string {
  const payload = {
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        statusCode,
        itemInfo: { itemStruct: video },
      },
    },
  };

  return [
    "<!DOCTYPE html><html><head><title>TikTok</title></head><body>",
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(payload)}</script>`,
    "</body></html>",
  ].join("");
}

function recipeVideo(): Record<string, unknown> {
  return {
    id: "7300000000000000000",
    desc: "Bolo de chocolate em 3 passos",
    author: { nickname: "Cozinha da Ana", uniqueId: "cozinhadaana" },
    video: {
      cover: COVER_URL,
      playAddr: VIDEO_URL,
      downloadAddr: "https://v16-webapp-prime.tiktok.com/video/download/watermarked.mp4",
      width: 720,
      height: 1280,
    },
  };
}

function stubFetch(handlers: Array<{ match: string | RegExp; respond: () => Response | Promise<Response> }>) {
  const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    for (const handler of handlers) {
      const matched =
        typeof handler.match === "string" ? url.includes(handler.match) : handler.match.test(url);
      if (matched) return handler.respond();
    }
    throw new Error(`UNEXPECTED_REQUEST:${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("tiktokConnector", () => {
  it("extracts the no-watermark playback URL and caption from the rehydration payload", async () => {
    stubFetch([
      { match: "https://www.tiktok.com/@cook/video/123", respond: () => new Response(rehydrationPage(recipeVideo()), { status: 200 }) },
      { match: "tiktokcdn", respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/4194304" } }) },
    ]);

    await expect(tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123")).resolves.toEqual({
      metadata: {
        title: "Bolo de chocolate em 3 passos",
        author_name: "Cozinha da Ana",
        provider_name: "TikTok",
        thumbnail_url: COVER_URL,
      },
      content: { kind: "external_media", mediaUrl: VIDEO_URL, mimeType: "video/mp4" },
    });
  });

  it("prefers the highest bitrate rendition when playAddr is absent", async () => {
    const video = recipeVideo();
    (video.video as Record<string, unknown>) = {
      cover: COVER_URL,
      downloadAddr: "https://v16.tiktok.com/watermarked.mp4",
      bitrateInfo: [
        { Bitrate: 400_000, PlayAddr: { UrlList: ["https://v16.tiktok.com/low.mp4"] } },
        { Bitrate: 1_600_000, PlayAddr: { UrlList: ["https://v16.tiktok.com/high.mp4"] } },
      ],
    };

    stubFetch([
      { match: "high.mp4", respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/1000" } }) },
      { match: "low.mp4", respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/1000" } }) },
      { match: "https://www.tiktok.com/@cook/video/123", respond: () => new Response(rehydrationPage(video), { status: 200 }) },
    ]);

    const resolved = await tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123");
    expect(resolved.content).toMatchObject({ kind: "external_media", mediaUrl: "https://v16.tiktok.com/high.mp4" });
  });

  it("falls back to the authorized transcript when the media URL is not an owned CDN host", async () => {
    const video = recipeVideo();
    (video.video as Record<string, unknown>).playAddr = "https://attacker.example/video.mp4";

    stubFetch([
      { match: "tiktok.com", respond: () => new Response(rehydrationPage(video), { status: 200 }) },
    ]);

    const resolved = await tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123");
    expect(resolved.content.kind).toBe("transcript_required");
    if (resolved.content.kind === "transcript_required") {
      expect(resolved.content.code).toBe("SOURCE_MEDIA_URL_INVALID");
    }
  });

  it("falls back to the authorized transcript when the file exceeds the provider limit", async () => {
    stubFetch([
      { match: "tiktok.com", respond: () => new Response(rehydrationPage(recipeVideo()), { status: 200 }) },
      { match: "tiktokcdn", respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/20971520" } }) },
    ]);

    const resolved = await tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123");
    expect(resolved.content).toMatchObject({ kind: "transcript_required", code: "SOURCE_MEDIA_TOO_LARGE" });
  });

  it("reports photo posts as requiring a transcript instead of pretending they are videos", async () => {
    const video = recipeVideo();
    (video.video as Record<string, unknown>) = { cover: COVER_URL };

    stubFetch([
      { match: "tiktok.com", respond: () => new Response(rehydrationPage(video), { status: 200 }) },
    ]);

    const resolved = await tiktokConnector.resolve("https://www.tiktok.com/@cook/photo/123");
    expect(resolved.content).toMatchObject({ kind: "transcript_required", code: "SOURCE_MEDIA_NOT_AVAILABLE" });
    expect(resolved.metadata.title).toBe("Bolo de chocolate em 3 passos");
  });

  it("drops thumbnails served from untrusted hosts without failing the import", async () => {
    const video = recipeVideo();
    (video.video as Record<string, unknown>).cover = "https://attacker.example/cover.jpg";

    stubFetch([
      { match: "tiktok.com", respond: () => new Response(rehydrationPage(video), { status: 200 }) },
      { match: "tiktokcdn", respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/1000" } }) },
    ]);

    const resolved = await tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123");
    expect(resolved.metadata.thumbnail_url).toBeNull();
  });

  it("treats a login wall without rehydration data as unavailable metadata", async () => {
    stubFetch([
      {
        match: "tiktok.com",
        respond: () => new Response("<!DOCTYPE html><html><body>login</body></html>", { status: 200 }),
      },
    ]);

    await expect(tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123"))
      .rejects.toThrow("SOURCE_METADATA_UNAVAILABLE");
  });

  it("fails when the platform reports a non-zero detail status code", async () => {
    stubFetch([
      { match: "tiktok.com", respond: () => new Response(rehydrationPage(recipeVideo(), 10204), { status: 200 }) },
    ]);

    await expect(tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123"))
      .rejects.toThrow("SOURCE_METADATA_UNAVAILABLE");
  });

  it("falls back to the public caption track when the CDN rejects the video", async () => {
    const video = recipeVideo();
    (video.video as Record<string, unknown>).subtitleInfos = [
      { LanguageCodeName: "por-BR", Url: SUBTITLE_URL },
    ];

    stubFetch([
      { match: "https://www.tiktok.com/@cook/video/123", respond: () => new Response(rehydrationPage(video), { status: 200 }) },
      { match: "play/abc.mp4", respond: () => new Response("forbidden", { status: 403 }) },
    ]);

    const resolved = await tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123");
    expect(resolved.content).toEqual({ kind: "external_subtitles", url: SUBTITLE_URL, mimeType: "text/vtt" });
  });

  it("uses the caption as public text when there is no video and no subtitle track", async () => {
    const video = recipeVideo();
    (video.video as Record<string, unknown>) = { cover: COVER_URL };
    video.desc =
      "Bolo de chocolate: 200g de chocolate meio amargo, 3 ovos, 1 xícara de açúcar, 2 xícaras de farinha. " +
      "Misture tudo, leve ao forno por 35 minutos e deixe esfriar antes de servir.";

    stubFetch([
      { match: "https://www.tiktok.com/@cook/video/123", respond: () => new Response(rehydrationPage(video), { status: 200 }) },
    ]);

    const resolved = await tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123");
    expect(resolved.content).toMatchObject({ kind: "public_text" });
    if (resolved.content.kind === "public_text") {
      expect(resolved.content.text).toContain("200g de chocolate");
    }
  });

  it("ignores subtitle tracks served from untrusted hosts", async () => {
    const video = recipeVideo();
    (video.video as Record<string, unknown>).subtitleInfos = [{ Url: "https://attacker.example/sub.vtt" }];

    stubFetch([
      { match: "https://www.tiktok.com/@cook/video/123", respond: () => new Response(rehydrationPage(video), { status: 200 }) },
      { match: "play/abc.mp4", respond: () => new Response("forbidden", { status: 403 }) },
    ]);

    const resolved = await tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123");
    expect(resolved.content).toMatchObject({ kind: "transcript_required", code: "SOURCE_MEDIA_UNAVAILABLE" });
  });

  it("rejects hosts outside the TikTok page allowlist without any network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(tiktokConnector.resolve("https://tiktok.com.attacker.example/@cook/video/123"))
      .rejects.toThrow("UNSUPPORTED_SOURCE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("extracts a public video from the legacy SIGI_STATE payload used by upstream scrapers", async () => {
    const legacyItem = {
      id: "123",
      desc: "Receita de panqueca com ovos, leite e farinha. Misture os ingredientes e doure dos dois lados em frigideira quente.",
      author: { nickname: "Cozinha antiga", uniqueId: "cozinhaantiga" },
      video: { cover: COVER_URL, playAddr: VIDEO_URL },
    };
    const html = `<html><body><script id="SIGI_STATE" type="application/json">${JSON.stringify({
      ItemModule: { "123": legacyItem },
    })}</script></body></html>`;

    stubFetch([
      { match: "https://www.tiktok.com/@cook/video/123", respond: () => new Response(html, { status: 200 }) },
      { match: "tiktokcdn", respond: () => new Response(null, {
        status: 206,
        headers: { "Content-Range": "bytes 0-0/1000" },
      }) },
    ]);

    const resolved = await tiktokConnector.resolve("https://www.tiktok.com/@cook/video/123");
    expect(resolved.metadata.author_name).toBe("Cozinha antiga");
    expect(resolved.content).toEqual({ kind: "external_media", mediaUrl: VIDEO_URL, mimeType: "video/mp4" });
  });
});
