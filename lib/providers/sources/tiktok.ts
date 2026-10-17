import "server-only";
import type { ResolvedSource, SourceConnector } from "@/lib/providers/sources/source-connector";
import { fetchAllowlistedDocument, parseAllowedHttpsUrl } from "@/lib/providers/sources/safe-fetch";
import { isPlatformMediaHost, isPlatformPageHost } from "@/lib/providers/sources/platform-hosts";
import { MIN_PUBLIC_TEXT_LENGTH } from "@/lib/providers/sources/source-connector";
import { probeExternalMedia } from "@/lib/providers/media/remote-video";

const REHYDRATION_SCRIPT =
  /<script[^>]*\bid="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i;

const LEGACY_SIGI_STATE_SCRIPT = /<script[^>]*\\bid="SIGI_STATE"[^>]*>([\\s\\S]*?)<\\/script>/i;

function parseLegacySigiState(html: string, sourcePath: string): Record<string, unknown> | null {
  const match = html.match(LEGACY_SIGI_STATE_SCRIPT);
  if (!match?.[1]) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object") return null;
    const itemModule = (parsed as Record<string, unknown>).ItemModule;
    if (!itemModule || typeof itemModule !== "object") return null;
    const videoId = sourcePath.match(/\\/(?:video|photo)\\/(\\d+)/)?.[1];
    const items = itemModule as Record<string, unknown>;
    const selected = (videoId && items[videoId]) ?? Object.values(items)[0];
    return selected && typeof selected === "object" ? (selected as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const PAGE_HOST = (hostname: string) => isPlatformPageHost("tiktok", hostname);
const MEDIA_HOST = (hostname: string) => isPlatformMediaHost("tiktok", hostname);

function at(source: unknown, path: readonly string[]): unknown {
  let cursor: unknown = source;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor ?? null;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function urlFromPlayAddress(value: unknown): string | null {
  if (typeof value === "string") return value.trim().length > 0 ? value.trim() : null;
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const candidates = [record.UrlList, record.url_list, record.urlList, record.url, record.src];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const entry = candidate.find((item): item is string => typeof item === "string");
      if (entry && entry.trim()) return entry.trim();
    } else if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function highestBitrateUrl(bitrateInfo: unknown): string | null {
  if (!Array.isArray(bitrateInfo)) return null;

  let bestUrl: string | null = null;
  let bestBitrate = -1;

  for (const entry of bitrateInfo) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const url = urlFromPlayAddress(record.PlayAddr ?? record.playAddr);
    if (!url) continue;

    const bitrate =
      typeof record.Bitrate === "number"
        ? record.Bitrate
        : typeof record.bitrate === "number"
          ? record.bitrate
          : 0;

    if (bitrate > bestBitrate) {
      bestBitrate = bitrate;
      bestUrl = url;
    }
  }

  return bestUrl;
}

/** playAddr has no watermark; downloadAddr is the watermarked fallback. */
function pickMediaUrl(video: unknown): string | null {
  if (!video || typeof video !== "object") return null;
  const record = video as Record<string, unknown>;

  return (
    urlFromPlayAddress(record.playAddr) ??
    highestBitrateUrl(record.bitrateInfo) ??
    urlFromPlayAddress(record.downloadAddr)
  );
}

/**
 * Collects the public WebVTT caption track URLs exposed in the rehydration
 * payload. These are the platform's own subtitle renditions and are served
 * without a session cookie, unlike the video CDN.
 */
function subtitleUrls(video: unknown): string[] {
  if (!video || typeof video !== "object") return [];
  const record = video as Record<string, unknown>;
  const urls: string[] = [];

  const push = (value: unknown) => {
    const url = firstNonEmptyString(value);
    if (url) urls.push(url);
  };

  if (Array.isArray(record.subtitleInfos)) {
    for (const entry of record.subtitleInfos) {
      if (entry && typeof entry === "object") {
        const info = entry as Record<string, unknown>;
        push(info.Url ?? info.url);
      }
    }
  }

  const claInfo = record.claInfo;
  if (claInfo && typeof claInfo === "object") {
    const captionInfos = (claInfo as Record<string, unknown>).captionInfos;
    if (Array.isArray(captionInfos)) {
      for (const entry of captionInfos) {
        if (entry && typeof entry === "object") {
          const info = entry as Record<string, unknown>;
          push(info.url ?? info.Url);
        }
      }
    }
  }

  return urls;
}

function parseRehydrationBody(html: string): Record<string, unknown> | null {
  const match = html.match(REHYDRATION_SCRIPT);
  if (!match?.[1]) return null;

  try {
    const parsed: unknown = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const tiktokConnector: SourceConnector = {
  platform: "tiktok",

  async resolve(sourceUrl: string): Promise<ResolvedSource> {
    const source = parseAllowedHttpsUrl(sourceUrl, PAGE_HOST);
    if (!source) throw new Error("UNSUPPORTED_SOURCE");

    const page = await fetchAllowlistedDocument({
      url: source.toString(),
      isAllowedHost: PAGE_HOST,
    });

    const data = parseRehydrationBody(page.body);
    const statusCode = data ? at(data, ["__DEFAULT_SCOPE__", "webapp.video-detail", "statusCode"]) : null;
    if (typeof statusCode === "number" && statusCode !== 0) {
      throw new Error("SOURCE_METADATA_UNAVAILABLE");
    }

    // The upstream drawrowfly scraper supports older SIGI_STATE/ItemModule
    // pages. Reuse that payload shape as a fallback, without its legacy request,
    // proxy, cookie, filesystem or download engine.
    const item = (data && at(data, ["__DEFAULT_SCOPE__", "webapp.video-detail", "itemInfo", "itemStruct"]))
      ?? parseLegacySigiState(page.body, source.pathname);
    if (!item || typeof item !== "object") throw new Error("SOURCE_METADATA_UNAVAILABLE");
    const record = item as Record<string, unknown>;

    const author = (record.author ?? {}) as Record<string, unknown>;
    const authorName = firstNonEmptyString(author.nickname, author.uniqueId, author.secUid);
    const caption = firstNonEmptyString(record.desc) ?? "";

    const video = (record.video ?? null) as Record<string, unknown> | null;
    const cover = typeof video?.cover === "string" ? video.cover : null;
    const thumbnailUrl = cover ? parseAllowedHttpsUrl(cover, MEDIA_HOST) : null;

    const metadata = {
      title: (caption || (authorName ? `TikTok de ${authorName}` : "Post do TikTok")).slice(0, 200),
      author_name: authorName?.slice(0, 200) ?? null,
      provider_name: "TikTok",
      thumbnail_url: thumbnailUrl?.toString() ?? null,
    };

    const mediaUrl = pickMediaUrl(video);

    // The CDN commonly rejects server requests without a session cookie, so the
    // video URL is only a best-effort candidate. The public caption track is the
    // reliable fallback because it is served without cookies.
    let mediaFailureCode: string | null = null;
    if (mediaUrl) {
      try {
        await probeExternalMedia({
          mediaUrl,
          isAllowedHost: MEDIA_HOST,
          referer: "https://www.tiktok.com/",
        });
        return {
          metadata,
          content: { kind: "external_media", mediaUrl, mimeType: "video/mp4" },
        };
      } catch (error) {
        mediaFailureCode = error instanceof Error ? error.message : "SOURCE_MEDIA_UNAVAILABLE";
      }
    }

    for (const url of subtitleUrls(video)) {
      const subtitleUrl = parseAllowedHttpsUrl(url, MEDIA_HOST);
      if (subtitleUrl) {
        return {
          metadata,
          content: { kind: "external_subtitles", url: subtitleUrl.toString(), mimeType: "text/vtt" },
        };
      }
    }

    if (caption.length >= MIN_PUBLIC_TEXT_LENGTH) {
      return { metadata, content: { kind: "public_text", text: caption } };
    }

    return {
      metadata,
      content: {
        kind: "transcript_required",
        code: mediaFailureCode ?? "SOURCE_MEDIA_NOT_AVAILABLE",
        reason:
          "Este post do TikTok não expôs vídeo nem legendas públicas. Envie uma transcrição autorizada para continuar.",
      },
    };
  },
};
