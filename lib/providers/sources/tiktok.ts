import "server-only";
import type { ResolvedSource, SourceConnector } from "@/lib/providers/sources/source-connector";
import { fetchAllowlistedDocument, hostMatchesSuffix, parseAllowedHttpsUrl } from "@/lib/providers/sources/safe-fetch";
import { isPlatformMediaHost, isPlatformPageHost } from "@/lib/providers/sources/platform-hosts";
import { probeExternalMedia } from "@/lib/providers/media/remote-video";

type TikwmData = {
  title?: unknown;
  author?: { nickname?: unknown; unique_id?: unknown };
  cover?: unknown;
  origin_cover?: unknown;
  play?: unknown;
  hdplay?: unknown;
  wmplay?: unknown;
};

type OEmbedData = {
  title?: unknown;
  author_name?: unknown;
  provider_name?: unknown;
  thumbnail_url?: unknown;
};

const PAGE_HOST = (hostname: string) => isPlatformPageHost("tiktok", hostname);
const MEDIA_HOST = (hostname: string) =>
  isPlatformMediaHost("tiktok", hostname) || hostMatchesSuffix(hostname, ["tikwm.com"]);
const TIKWM_HOST = (hostname: string) => hostMatchesSuffix(hostname, ["tikwm.com"]);

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeMediaUrl(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  return parseAllowedHttpsUrl(raw, MEDIA_HOST)?.toString() ?? null;
}

function safeThumbnailUrl(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  return parseAllowedHttpsUrl(raw, MEDIA_HOST)?.toString() ?? null;
}

async function fetchTikwm(sourceUrl: string): Promise<{ metadata: ResolvedSource["metadata"]; mediaUrl: string } | null> {
  const endpoint = new URL("https://www.tikwm.com/api/");
  endpoint.searchParams.set("url", sourceUrl);
  endpoint.searchParams.set("hd", "1");

  try {
    const response = await fetchAllowlistedDocument({
      url: endpoint.toString(),
      isAllowedHost: TIKWM_HOST,
      maxBytes: 1_000_000,
      timeoutMs: 8_000,
    });
    const parsed: unknown = JSON.parse(response.body);
    if (!parsed || typeof parsed !== "object") return null;
    const envelope = parsed as { code?: unknown; data?: unknown };
    if (envelope.code !== 0 || !envelope.data || typeof envelope.data !== "object") return null;

    const data = envelope.data as TikwmData;
    const mediaUrl = safeMediaUrl(data.hdplay) ?? safeMediaUrl(data.play) ?? safeMediaUrl(data.wmplay);
    if (!mediaUrl) return null;

    const author = data.author && typeof data.author === "object"
      ? nonEmptyString(data.author.nickname) ?? nonEmptyString(data.author.unique_id)
      : null;
    const title = nonEmptyString(data.title);
    const thumbnailUrl = safeThumbnailUrl(data.cover) ?? safeThumbnailUrl(data.origin_cover);

    return {
      metadata: {
        title: (title ?? (author ? `TikTok de ${author}` : "Post do TikTok")).slice(0, 200),
        author_name: author?.slice(0, 200) ?? null,
        provider_name: "TikTok",
        thumbnail_url: thumbnailUrl,
      },
      mediaUrl,
    };
  } catch {
    // TikWM is an external free service; a failure proceeds to official oEmbed.
    return null;
  }
}

async function fetchOfficialOEmbed(sourceUrl: string): Promise<ResolvedSource["metadata"] | null> {
  const endpoint = new URL("https://www.tiktok.com/oembed");
  endpoint.searchParams.set("url", sourceUrl);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const data = (await response.json()) as OEmbedData;
    const title = nonEmptyString(data.title);
    if (!title) return null;

    return {
      title: title.slice(0, 200),
      author_name: nonEmptyString(data.author_name)?.slice(0, 200) ?? null,
      provider_name: nonEmptyString(data.provider_name)?.slice(0, 100) ?? "TikTok",
      thumbnail_url: safeThumbnailUrl(data.thumbnail_url),
    };
  } catch {
    return null;
  }
}

export const tiktokConnector: SourceConnector = {
  platform: "tiktok",

  async resolve(sourceUrl: string): Promise<ResolvedSource> {
    const source = parseAllowedHttpsUrl(sourceUrl, PAGE_HOST);
    if (!source) throw new Error("UNSUPPORTED_SOURCE");

    // Primary extraction: TikWM provides the actual playable media URL.
    const extracted = await fetchTikwm(source.toString());
    if (extracted) {
      try {
        await probeExternalMedia({
          mediaUrl: extracted.mediaUrl,
          isAllowedHost: MEDIA_HOST,
          referer: "https://www.tiktok.com/",
        });
        return {
          metadata: extracted.metadata,
          content: { kind: "external_media", mediaUrl: extracted.mediaUrl, mimeType: "video/mp4" },
        };
      } catch {
        // Do not return an unverified video URL; try official public metadata.
      }
    }

    // Official oEmbed is metadata-only. It does not supply a downloadable video.
    const metadata = await fetchOfficialOEmbed(source.toString());
    if (metadata) {
      return {
        metadata,
        content: {
          kind: "transcript_required",
          code: "SOURCE_MEDIA_NOT_AVAILABLE",
          reason: "O oEmbed oficial do TikTok fornece metadados e miniatura, mas não o vídeo. Não foi possível obter uma mídia utilizável pelo TikWM.",
        },
      };
    }

    throw new Error("SOURCE_METADATA_UNAVAILABLE");
  },
};
