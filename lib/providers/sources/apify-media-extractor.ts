import "server-only";
import { z } from "zod";
import type { SupportedPlatform } from "@/lib/source-url";
import type { ResolvedSource } from "@/lib/providers/sources/source-connector";
import { probeExternalMedia, EXTERNAL_MEDIA_MAX_BYTES } from "@/lib/providers/media/remote-video";
import { isPlatformMediaHost, isPlatformPageHost } from "@/lib/providers/sources/platform-hosts";
import { parseAllowedHttpsUrl } from "@/lib/providers/sources/safe-fetch";

const APIFY_ACTOR_URL = "https://api.apify.com/v2/acts/coder2077~social-media-downloader/run-sync-get-dataset-items";
const EXTRACTOR_TIMEOUT_MS = 45_000;

const ApifyItemSchema = z.object({
  inputUrl: z.string().optional(),
  platform: z.string(),
  ok: z.boolean(),
  type: z.string().optional(),
  download_url: z.string().url().optional(),
  thumbnail_url: z.string().url().nullable().optional(),
  caption: z.string().nullable().optional(),
  duration: z.number().finite().nonnegative().nullable().optional(),
}).passthrough();

type SocialPlatform = Extract<SupportedPlatform, "instagram" | "tiktok">;

/** Hosted Apify adapter; no separate Python/yt-dlp hosting is required. */
export async function resolveExternalMedia(sourceUrl: string, platform: SocialPlatform): Promise<ResolvedSource | null> {
  const token = process.env.APIFY_API_TOKEN?.trim();
  if (!token) return null;

  const source = parseAllowedHttpsUrl(sourceUrl, (hostname) => isPlatformPageHost(platform, hostname));
  if (!source) return null;

  let response: Response;
  try {
    response = await fetch(APIFY_ACTOR_URL + "?clean=true&format=json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ urls: [source.toString()] }),
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

  const items = z.array(ApifyItemSchema).safeParse(payload);
  if (!items.success) return null;
  const item = items.data.find((candidate) => candidate.ok && candidate.platform.toLowerCase() === platform);
  if (!item || item.type !== "video" || !item.download_url) return null;

  const mediaUrl = parseAllowedHttpsUrl(item.download_url, (hostname) => isPlatformMediaHost(platform, hostname));
  if (!mediaUrl) return null;

  try {
    const probe = await probeExternalMedia({
      mediaUrl: mediaUrl.toString(),
      isAllowedHost: (hostname) => isPlatformMediaHost(platform, hostname),
      referer: platform === "instagram" ? "https://www.instagram.com/" : "https://www.tiktok.com/",
    });
    if (probe.contentLength !== null && probe.contentLength > EXTERNAL_MEDIA_MAX_BYTES) return null;
  } catch {
    return null;
  }

  return {
    metadata: {
      title: item.caption?.trim().slice(0, 200) || `Vídeo de ${platform === "instagram" ? "Instagram" : "TikTok"}`,
      author_name: null,
      provider_name: platform === "instagram" ? "Instagram" : "TikTok",
      thumbnail_url: item.thumbnail_url ?? null,
    },
    content: { kind: "external_media", mediaUrl: mediaUrl.toString(), mimeType: "video/mp4" },
  };
}
