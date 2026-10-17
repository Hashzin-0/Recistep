import "server-only";
import type { ResolvedSource, SourceConnector } from "@/lib/providers/sources/source-connector";
import { MIN_PUBLIC_TEXT_LENGTH } from "@/lib/providers/sources/source-connector";
import {
  fetchAllowlistedDocument,
  parseAllowedHttpsUrl,
  resolveAllowlistedLocation,
} from "@/lib/providers/sources/safe-fetch";
import { isPlatformMediaHost, isPlatformPageHost } from "@/lib/providers/sources/platform-hosts";
import { probeExternalMedia } from "@/lib/providers/media/remote-video";

const OEMBED_ENDPOINT = "https://www.instagram.com/api/v1/oembed/";
const POST_PATH = /^\/(?:[A-Za-z0-9._]+\/)?(?:p|tv|reels?|share\/[a-z]+)\/([A-Za-z0-9_-]+)/i;

type OEmbedPayload = {
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
};

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&#39;/g, "'");
}

function attribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ? decodeHtml(match[1]) : null;
}

/** Extracts only public HTML metadata; the resulting URL is still allowlisted and probed. */
function publicVideoUrl(html: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name") ?? "").toLowerCase();
    if (!["og:video", "og:video:secure_url", "twitter:player:stream"].includes(key)) continue;
    const value = attribute(tag, "content");
    if (value) return value;
  }

  const patterns = [
    /"(?:video_url|videoUrl|contentUrl)"\s*:\s*"((?:\\.|[^"\\])+)"/i,
    /"(?:video_versions|videoVersions)"\s*:\s*\[\s*\{[\s\S]{0,1000}?"url"\s*:\s*"((?:\\.|[^"\\])+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      const decoded = JSON.parse(`"${match[1]}"`) as unknown;
      if (typeof decoded === "string" && decoded.trim()) return decoded;
    } catch {
      // Try the next known public metadata shape.
    }
  }
  return null;
}

function extractJsonObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function publicCaptionFromHtml(html: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name") ?? "").toLowerCase();
    if (!["og:description", "description", "twitter:description"].includes(key)) continue;
    const value = attribute(tag, "content");
    if (value) return value.slice(0, 10_000);
  }

  // Older public Instagram pages expose the same caption in shared_data JSON.
  const marker = html.indexOf("_sharedData");
  const assignment = marker >= 0 ? html.indexOf("=", marker) : -1;
  const jsonStart = assignment >= 0 ? html.indexOf("{", assignment) : -1;
  const sharedData = jsonStart >= 0 ? extractJsonObject(html, jsonStart) : null;
  if (sharedData) {
    try {
      const parsed: unknown = JSON.parse(sharedData);
      if (parsed && typeof parsed === "object") {
        const entryData = (parsed as Record<string, unknown>).entry_data;
        if (entryData && typeof entryData === "object") {
          const posts = (entryData as Record<string, unknown>).PostPage;
          if (Array.isArray(posts)) {
            const media = (posts[0] as Record<string, unknown> | undefined)?.graphql;
            const shortcodeMedia = media && typeof media === "object"
              ? (media as Record<string, unknown>).shortcode_media
              : null;
            const edge = shortcodeMedia && typeof shortcodeMedia === "object"
              ? (shortcodeMedia as Record<string, unknown>).edge_media_to_caption
              : null;
            const edges = edge && typeof edge === "object" ? (edge as Record<string, unknown>).edges : null;
            if (Array.isArray(edges)) {
              for (const item of edges) {
                const node = item && typeof item === "object" ? (item as Record<string, unknown>).node : null;
                const text = node && typeof node === "object" ? (node as Record<string, unknown>).text : null;
                if (typeof text === "string" && text.trim()) return text.trim().slice(0, 10_000);
              }
            }
          }
        }
      }
    } catch {
      // Malformed legacy payloads are ignored; do not let HTML parsing fail the import.
    }
  }

  return null;
}

export const instagramConnector: SourceConnector = {
  platform: "instagram",

  async resolve(sourceUrl: string): Promise<ResolvedSource> {
    const source = parseAllowedHttpsUrl(sourceUrl, (hostname) => isPlatformPageHost("instagram", hostname));
    if (!source) throw new Error("UNSUPPORTED_SOURCE");

    const canonical = POST_PATH.test(source.pathname)
      ? source
      : new URL(await resolveAllowlistedLocation({ url: source.toString(), isAllowedHost: (hostname) => isPlatformPageHost("instagram", hostname) }));
    if (!POST_PATH.test(canonical.pathname)) throw new Error("UNSUPPORTED_SOURCE");

    let pageHtml = "";
    try {
      const page = await fetchAllowlistedDocument({
        url: canonical.toString(),
        isAllowedHost: (hostname) => isPlatformPageHost("instagram", hostname),
      });
      pageHtml = page.body;
    } catch {
      // Instagram often returns a login shell or blocks server requests; oEmbed remains a fallback.
    }

    let oembed: OEmbedPayload | null = null;
    try {
      const document = await fetchAllowlistedDocument({
        url: `${OEMBED_ENDPOINT}?url=${encodeURIComponent(canonical.toString())}`,
        isAllowedHost: (hostname) => isPlatformPageHost("instagram", hostname),
      });
      const parsed: unknown = JSON.parse(document.body);
      if (parsed && typeof parsed === "object") oembed = parsed as OEmbedPayload;
    } catch (error) {
      // The upstream scraper also parses public page payloads directly. Prefer
      // oEmbed when available, but do not discard a usable public HTML caption.
      if (error instanceof Error && error.message === "SOURCE_PROVIDER_TEMPORARY_FAILURE") {
        if (!publicCaptionFromHtml(pageHtml)) throw error;
      }
    }

    const htmlCaption = publicCaptionFromHtml(pageHtml);
    const caption = firstString(oembed?.title, htmlCaption) ?? "";
    const authorName = firstString(oembed?.author_name);
    const thumbnail = firstString(oembed?.thumbnail_url);
    if (!oembed && !caption) throw new Error("SOURCE_METADATA_UNAVAILABLE");
    const metadata = {
      title: (caption || (authorName ? `Instagram de ${authorName}` : "Post do Instagram")).slice(0, 200),
      author_name: authorName?.slice(0, 200) ?? null,
      provider_name: "Instagram",
      thumbnail_url: thumbnail
        ? (parseAllowedHttpsUrl(thumbnail, (hostname) => isPlatformMediaHost("instagram", hostname))?.toString() ?? null)
        : null,
    };

    const candidate = publicVideoUrl(pageHtml);
    const mediaUrl = candidate
      ? parseAllowedHttpsUrl(candidate, (hostname) => isPlatformMediaHost("instagram", hostname))
      : null;
    if (mediaUrl) {
      try {
        await probeExternalMedia({
          mediaUrl: mediaUrl.toString(),
          isAllowedHost: (hostname) => isPlatformMediaHost("instagram", hostname),
          referer: "https://www.instagram.com/",
        });
        return {
          metadata,
          content: { kind: "external_media", mediaUrl: mediaUrl.toString(), mimeType: "video/mp4" },
        };
      } catch {
        // A blocked/expired CDN URL must not prevent use of a public caption.
      }
    }

    if (caption.length < MIN_PUBLIC_TEXT_LENGTH) {
      return {
        metadata,
        content: {
          kind: "unsupported_content",
          code: "SOURCE_NOT_ANALYZABLE",
          reason:
            "Não foi possível analisar este link do Instagram: o vídeo não está disponível publicamente e a legenda não traz dados suficientes para montar a receita.",
        },
      };
    }

    return { metadata, content: { kind: "public_text", text: caption } };
  },
};
