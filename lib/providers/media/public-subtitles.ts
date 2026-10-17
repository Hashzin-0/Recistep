import "server-only";
import type { SupportedPlatform } from "@/lib/source-url";
import { isPlatformMediaHost } from "@/lib/providers/sources/platform-hosts";
import { fetchAllowlistedDocument } from "@/lib/providers/sources/safe-fetch";
import { vttToText } from "@/lib/providers/sources/vtt";

const MAX_SUBTITLE_BYTES = 512 * 1024;

const PLATFORM_REFERER: Record<SupportedPlatform, string> = {
  youtube: "https://www.youtube.com/",
  tiktok: "https://www.tiktok.com/",
  instagram: "https://www.instagram.com/",
};

/**
 * Downloads a public caption track from the platform CDN and returns its
 * spoken text. Even though the track is public, the caller keeps the result
 * out of any durable step so no transcript is persisted in step history.
 */
export async function fetchPublicSubtitlesText(input: {
  url: string;
  platform: SupportedPlatform;
}): Promise<string> {
  const document = await fetchAllowlistedDocument({
    url: input.url,
    isAllowedHost: (hostname) => isPlatformMediaHost(input.platform, hostname),
    maxBytes: MAX_SUBTITLE_BYTES,
    headers: {
      Accept: "text/vtt,text/plain;q=0.9,*/*;q=0.5",
      Referer: PLATFORM_REFERER[input.platform],
    },
  });

  return vttToText(document.body);
}
