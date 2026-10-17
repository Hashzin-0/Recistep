import "server-only";
import { z } from "zod";
import type { ResolvedSource } from "@/lib/providers/sources/source-connector";
import { probeExternalMedia, EXTERNAL_MEDIA_MAX_BYTES } from "@/lib/providers/media/remote-video";
import { isPlatformMediaHost } from "@/lib/providers/sources/platform-hosts";
import { parseAllowedHttpsUrl } from "@/lib/providers/sources/safe-fetch";

const EXTRACTOR_TIMEOUT_MS = 12_000;

const ExtractorResponseSchema = z.object({
  platform: z.enum(["instagram", "tiktok"]),
  title: z.string().trim().min(1).max(200),
  author_name: z.string().max(200).nullable(),
  media_url: z.string().url(),
  mime_type: z.literal("video/mp4"),
  duration_seconds: z.number().finite().nonnegative().nullable(),
  filesize_bytes: z.number().int().nonnegative().nullable(),
}).strict();

type SocialPlatform = "instagram" | "tiktok";

function getExtractorConfig(): { endpoint: URL; apiKey: string } | null {
  const rawUrl = process.env.MEDIA_EXTRACTOR_URL?.trim();
  const apiKey = process.env.MEDIA_EXTRACTOR_API_KEY?.trim();
  if (!rawUrl || !apiKey) return null;

  try {
    const endpoint = new URL(rawUrl);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      return null;
    }
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") + "/v1/extract";
    return { endpoint, apiKey };
  } catch {
    return null;
  }
}

/**
 * Optional self-hosted yt-dlp adapter. It only resolves public videos; the
 * returned CDN URL is revalidated and size-probed before Gemini receives it.
 * If the service is absent or unavailable, existing connectors remain fallback.
 */
export async function resolveExternalMedia(
  sourceUrl: string,
  platform: SocialPlatform,
): Promise<ResolvedSource | null> {
  const config = getExtractorConfig();
  if (!config) return null;

  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ platform, url: sourceUrl }),
      cache: "no-store",
      signal: AbortSignal.timeout(EXTRACTOR_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const parsed = ExtractorResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.platform !== platform) return null;

  const mediaUrl = parseAllowedHttpsUrl(
    parsed.data.media_url,
    (hostname) => isPlatformMediaHost(platform, hostname),
  );
  if (!mediaUrl) return null;

  if (parsed.data.filesize_bytes !== null && parsed.data.filesize_bytes > EXTERNAL_MEDIA_MAX_BYTES) {
    return null;
  }

  try {
    await probeExternalMedia({
      mediaUrl: mediaUrl.toString(),
      isAllowedHost: (hostname) => isPlatformMediaHost(platform, hostname),
      referer: platform === "instagram" ? "https://www.instagram.com/" : "https://www.tiktok.com/",
    });
  } catch {
    return null;
  }

  return {
    metadata: {
      title: parsed.data.title,
      author_name: parsed.data.author_name,
      provider_name: platform === "instagram" ? "Instagram" : "TikTok",
      thumbnail_url: null,
    },
    content: {
      kind: "external_media",
      mediaUrl: mediaUrl.toString(),
      mimeType: "video/mp4",
    },
  };
}
