import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { instagramConnector } from "./instagram";

afterEach(() => {
  vi.unstubAllGlobals();
});

const REEL_PATH = "https://www.instagram.com/reel/BAAB/";
const CDN_COVER = "https://scontent.cdninstagram.com/v/reel-cover.jpg";
const LONG_CAPTION =
  "Bolo de cenoura da vovó: 3 cenouras médias, 4 ovos, 1 xícara de óleo, 2 xícaras de açúcar. " +
  "Bata tudo no liquidificador, acrescente a farinha e asse por 40 minutos.";

function stubFetch(handlers: Array<{ match: string; respond: () => Response | Promise<Response> }>) {
  const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    for (const handler of handlers) {
      if (url.includes(handler.match)) return handler.respond();
    }
    if (url.includes("www.instagram.com/reel/")) {
      return new Response("<html></html>", { status: 200 });
    }
    throw new Error(`UNEXPECTED_REQUEST:${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function oembedResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    version: "1.0",
    type: "rich",
    title: LONG_CAPTION,
    author_name: "ana.receitas",
    thumbnail_url: CDN_COVER,
    provider_name: "Instagram",
    ...overrides,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("instagramConnector", () => {
  it("uses the public oEmbed caption as the extraction text without any media URL", async () => {
    const fetchMock = stubFetch([
      { match: "oembed", respond: () => oembedResponse() },
    ]);

    await expect(instagramConnector.resolve(REEL_PATH)).resolves.toEqual({
      metadata: {
        title: LONG_CAPTION.slice(0, 200),
        author_name: "ana.receitas",
        provider_name: "Instagram",
        thumbnail_url: CDN_COVER,
      },
      content: { kind: "public_text", text: LONG_CAPTION },
    });

    const oembedCall = fetchMock.mock.calls.find(([request]) => String(request).includes("/api/v1/oembed/"));
    expect(String(oembedCall?.[0])).toContain("/api/v1/oembed/?url=");
    expect(String(oembedCall?.[0])).toContain(encodeURIComponent(REEL_PATH));
    // The public page is attempted for a direct video URL, then oEmbed supplies the caption fallback.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a link that cannot be analyzed when the caption carries no recipe", async () => {
    stubFetch([
      { match: "oembed", respond: () => oembedResponse({ title: "novo post 🍰", thumbnail_url: null }) },
    ]);

    const resolved = await instagramConnector.resolve(REEL_PATH);
    expect(resolved.content).toMatchObject({ kind: "unsupported_content", code: "SOURCE_NOT_ANALYZABLE" });
    if (resolved.content.kind === "unsupported_content") {
      expect(resolved.content.reason).toContain("Não foi possível analisar");
    }
    expect(resolved.metadata.title).toBe("novo post 🍰");
    expect(resolved.metadata.thumbnail_url).toBeNull();
  });

  it("falls back to the author when the caption is empty", async () => {
    stubFetch([
      { match: "oembed", respond: () => oembedResponse({ title: "", thumbnail_url: null }) },
    ]);

    const resolved = await instagramConnector.resolve(REEL_PATH);
    expect(resolved.metadata.title).toBe("Instagram de ana.receitas");
    expect(resolved.content.kind).toBe("unsupported_content");
  });

  it("resolves share links through allowlisted redirects before calling oEmbed", async () => {
    const fetchMock = stubFetch([
      { match: "instagram.com/share/abc", respond: () => new Response(null, { status: 302, headers: { Location: REEL_PATH } }) },
      { match: "/reel/BAAB/", respond: () => new Response("<html></html>", { status: 200 }) },
      { match: "oembed", respond: () => oembedResponse() },
    ]);

    const resolved = await instagramConnector.resolve("https://www.instagram.com/share/abc/");
    expect(resolved.content).toMatchObject({ kind: "public_text" });
    expect(fetchMock.mock.calls.map(([request]) => String(request)).some((url) => url.includes("oembed"))).toBe(true);
  });

  it("drops thumbnails served from untrusted hosts without failing the import", async () => {
    stubFetch([
      { match: "oembed", respond: () => oembedResponse({ thumbnail_url: "https://attacker.example/cover.jpg" }) },
    ]);

    const resolved = await instagramConnector.resolve(REEL_PATH);
    expect(resolved.metadata.thumbnail_url).toBeNull();
    expect(resolved.content.kind).toBe("public_text");
  });

  it("treats a rejected post as unavailable metadata", async () => {
    stubFetch([
      { match: "oembed", respond: () => new Response("not found", { status: 404 }) },
    ]);

    await expect(instagramConnector.resolve(REEL_PATH)).rejects.toThrow("SOURCE_METADATA_UNAVAILABLE");
  });

  it("reports a rate limit as a transient provider error instead of a permanent failure", async () => {
    stubFetch([
      { match: "oembed", respond: () => new Response("slow down", { status: 429 }) },
    ]);

    await expect(instagramConnector.resolve(REEL_PATH)).rejects.toThrow("SOURCE_PROVIDER_TEMPORARY_FAILURE");
  });

  it("treats a non-JSON oEmbed body as unavailable metadata", async () => {
    stubFetch([
      { match: "oembed", respond: () => new Response("<html>login</html>", { status: 200 }) },
    ]);

    await expect(instagramConnector.resolve(REEL_PATH)).rejects.toThrow("SOURCE_METADATA_UNAVAILABLE");
  });


  it("uses a public HTML video URL only when the CDN host is allowlisted and reachable", async () => {
    const videoUrl = "https://scontent.cdninstagram.com/v/reel-video.mp4";
    stubFetch([
      { match: "www.instagram.com/reel/BAAB/", respond: () => new Response(
        `<html><head><meta property="og:video" content="${videoUrl}"></head></html>`,
        { status: 200 },
      ) },
      { match: "oembed", respond: () => oembedResponse() },
      { match: "reel-video.mp4", respond: () => new Response(null, {
        status: 206,
        headers: { "Content-Range": "bytes 0-0/1000", "Content-Type": "video/mp4" },
      }) },
    ]);

    const resolved = await instagramConnector.resolve(REEL_PATH);
    expect(resolved.content).toEqual({
      kind: "external_media",
      mediaUrl: videoUrl,
      mimeType: "video/mp4",
    });
  });

  it("rejects hosts outside the Instagram page allowlist without any network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(instagramConnector.resolve("https://instagram.com.attacker.example/reel/BAAB/"))
      .rejects.toThrow("UNSUPPORTED_SOURCE");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
