import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { instagramConnector, shortcodeToMediaId } from "./instagram";

afterEach(() => {
  vi.unstubAllGlobals();
});

const REEL_PATH = "https://www.instagram.com/reel/BAAB/";
const CDN_VIDEO = "https://scontent.cdninstagram.com/v/reel-video.mp4";
const CDN_COVER = "https://scontent.cdninstagram.com/v/reel-cover.jpg";

function graphqlItem(overrides: Record<string, unknown> = {}): unknown {
  return {
    video_versions: [{ url: CDN_VIDEO, width: 1080, height: 1920 }],
    caption: { text: "Bolo de cenoura em 3 passos" },
    user: { username: "ana.receitas", full_name: "Ana Receitas" },
    image_versions2: { candidates: [{ url: CDN_COVER }] },
    ...overrides,
  };
}

function graphqlResponse(items: unknown[], status = "ok"): Response {
  return new Response(JSON.stringify({ status, items }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function openGraphPage(tags: string[]): Response {
  return new Response(`<!DOCTYPE html><html><head>${tags.join("\n")}</head><body></body></html>`, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

function stubFetch(handlers: Array<{ match: string; respond: () => Response | Promise<Response> }>) {
  const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    for (const handler of handlers) {
      if (url.includes(handler.match)) return handler.respond();
    }
    throw new Error(`UNEXPECTED_REQUEST:${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("shortcodeToMediaId", () => {
  it("decodes a shortcode with the base64url alphabet", () => {
    expect(shortcodeToMediaId("BAAB")).toBe("262145");
  });

  it("rejects shortcodes containing characters outside the alphabet", () => {
    expect(shortcodeToMediaId("A*B$")).toBeNull();
    expect(shortcodeToMediaId("AB")).toBeNull();
  });

  it("maps different shortcodes to different ids", () => {
    expect(shortcodeToMediaId("BAAB")).not.toBe(shortcodeToMediaId("BAAC"));
  });
});

describe("instagramConnector", () => {
  it("resolves a reel through the public GraphQL endpoint and the CDN probe", async () => {
    const fetchMock = stubFetch([
      { match: "i.instagram.com", respond: () => graphqlResponse([graphqlItem()]) },
      { match: "cdninstagram.com", respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/2097152" } }) },
    ]);

    await expect(instagramConnector.resolve(REEL_PATH)).resolves.toEqual({
      metadata: {
        title: "Bolo de cenoura em 3 passos",
        author_name: "Ana Receitas",
        provider_name: "Instagram",
        thumbnail_url: CDN_COVER,
      },
      content: { kind: "external_media", mediaUrl: CDN_VIDEO, mimeType: "video/mp4" },
    });

    const graphqlCall = fetchMock.mock.calls.find(([request]) => String(request).includes("i.instagram.com"));
    expect(String(graphqlCall?.[0])).toContain("/api/v1/media/262145/info/");
    expect((graphqlCall?.[1] as RequestInit).headers).toMatchObject({ "X-IG-App-ID": "936619743392459" });
  });

  it("falls back to the page Open Graph video when the GraphQL endpoint refuses", async () => {
    stubFetch([
      { match: "i.instagram.com", respond: () => graphqlResponse([], "fail") },
      { match: "/reel/BAAB/", respond: () => openGraphPage([
        `<meta property="og:title" content="Bolo rápido" />`,
        `<meta property="og:video" content="${CDN_VIDEO}?oe=1&amp;oh=2" />`,
        `<meta property="og:image" content="${CDN_COVER}" />`,
      ]) },
      { match: "cdninstagram.com", respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/2097152" } }) },
    ]);

    const resolved = await instagramConnector.resolve(REEL_PATH);
    expect(resolved.content).toMatchObject({ kind: "external_media", mediaUrl: `${CDN_VIDEO}?oe=1&oh=2` });
    expect(resolved.metadata.title).toBe("Bolo rápido");
    expect(resolved.metadata.thumbnail_url).toBe(CDN_COVER);
  });

  it("resolves share links by following allowlisted redirects", async () => {
    stubFetch([
      { match: "instagram.com/share/abc", respond: () => new Response(null, {
        status: 302,
        headers: { Location: REEL_PATH },
      }) },
      { match: "/reel/BAAB/", respond: () => openGraphPage([
        `<meta property="og:title" content="Compartilhado" />`,
        `<meta property="og:video" content="${CDN_VIDEO}" />`,
      ]) },
      { match: "i.instagram.com", respond: () => graphqlResponse([graphqlItem()]) },
      { match: "cdninstagram.com", respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/1000" } }) },
    ]);

    const resolved = await instagramConnector.resolve("https://www.instagram.com/share/abc/");
    expect(resolved.content).toMatchObject({ kind: "external_media", mediaUrl: CDN_VIDEO });
  });

  it("reports photo posts as requiring a transcript instead of a fake success", async () => {
    stubFetch([
      { match: "i.instagram.com", respond: () => graphqlResponse([graphqlItem({ video_versions: undefined, caption: null })]) },
      { match: "/reel/BAAB/", respond: () => openGraphPage([
        `<meta property="og:title" content="Foto de bolo" />`,
        `<meta property="og:image" content="${CDN_COVER}" />`,
      ]) },
    ]);

    const resolved = await instagramConnector.resolve(REEL_PATH);
    expect(resolved.content).toMatchObject({ kind: "transcript_required", code: "SOURCE_MEDIA_NOT_AVAILABLE" });
    expect(resolved.metadata.title).toBe("Foto de bolo");
  });

  it("never hands an unowned host to the provider", async () => {
    stubFetch([
      { match: "i.instagram.com", respond: () => graphqlResponse([graphqlItem({
        video_versions: [{ url: "https://attacker.example/reel.mp4", width: 720, height: 1280 }],
      })]) },
      { match: "/reel/BAAB/", respond: () => openGraphPage([]) },
    ]);

    const resolved = await instagramConnector.resolve(REEL_PATH);
    expect(resolved.content).toMatchObject({ kind: "transcript_required", code: "SOURCE_MEDIA_URL_INVALID" });
  });

  it("does not expose a video larger than the provider limit", async () => {
    stubFetch([
      { match: "i.instagram.com", respond: () => graphqlResponse([graphqlItem()]) },
      { match: "cdninstagram.com", respond: () => new Response(null, { status: 206, headers: { "Content-Range": "bytes 0-0/42949672" } }) },
    ]);

    const resolved = await instagramConnector.resolve(REEL_PATH);
    expect(resolved.content).toMatchObject({ kind: "transcript_required", code: "SOURCE_MEDIA_TOO_LARGE" });
  });

  it("rejects hosts outside the Instagram page allowlist without any network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(instagramConnector.resolve("https://instagram.com.attacker.example/reel/BAAB/"))
      .rejects.toThrow("UNSUPPORTED_SOURCE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a transient provider error as retryable instead of a permanent content failure", async () => {
    stubFetch([
      { match: "i.instagram.com", respond: () => graphqlResponse([], "fail") },
      { match: "/reel/BAAB/", respond: () => new Response("oops", { status: 503 }) },
    ]);

    await expect(instagramConnector.resolve(REEL_PATH)).rejects.toThrow("SOURCE_PROVIDER_TEMPORARY_FAILURE");
  });
});
