import "server-only";
import type { SupportedPlatform } from "@/lib/source-url";
import { hostMatchesSuffix } from "@/lib/providers/sources/safe-fetch";

/** Exact hosts that may serve the source page itself. */
const PAGE_HOSTS: Record<SupportedPlatform, readonly string[]> = {
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"],
  tiktok: ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  instagram: [
    "instagram.com",
    "www.instagram.com",
    "m.instagram.com",
    "i.instagram.com",
  ],
};

/**
 * CDN host families owned by the platform. A resolved media URL may only come
 * from these families before it is handed to the AI provider.
 */
const MEDIA_HOST_SUFFIXES: Record<SupportedPlatform, readonly string[]> = {
  youtube: ["youtube.com", "googlevideo.com", "ytimg.com", "youtu.be"],
  tiktok: [
    "tiktokcdn.com",
    "tiktokcdn-us.com",
    "tiktokcdn-europe.com",
    "muscdn.com",
    "tiktokv.com",
    "tiktok.com",
    "byteoversea.com",
  ],
  instagram: ["cdninstagram.com", "fbcdn.net", "fbcdn.com", "instagram.com"],
};

export function isPlatformPageHost(platform: SupportedPlatform, hostname: string): boolean {
  return PAGE_HOSTS[platform].includes(hostname.toLowerCase());
}

export function isPlatformMediaHost(platform: SupportedPlatform, hostname: string): boolean {
  return hostMatchesSuffix(hostname, MEDIA_HOST_SUFFIXES[platform]);
}
