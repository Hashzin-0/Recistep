import type { SupportedPlatform } from "@/lib/source-url";

// Descreve como exibir o vídeo original da receita sem depender de rede:
// o embed determinístico por plataforma, a miniatura e, quando disponível, a
// URL direta de mídia (best-effort) para um player nativo controlável.
// Módulo puro e client-safe: nunca importa "server-only".

export type VideoPlatform = SupportedPlatform;

export type VideoDisplay = {
  platform: VideoPlatform;
  watch_url: string;
  embed_url: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  title: string | null;
  author_name: string | null;
};

export type VideoDisplayInput = {
  platform: string | null | undefined;
  sourceUrl: string | null | undefined;
  thumbnailUrl?: string | null;
  videoUrl?: string | null;
  title?: string | null;
  authorName?: string | null;
};

const PLATFORMS: VideoPlatform[] = ["youtube", "tiktok", "instagram"];

function normalizePlatform(value: string | null | undefined): VideoPlatform | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return (PLATFORMS as string[]).includes(candidate) ? (candidate as VideoPlatform) : null;
}

export function inferPlatformFromUrl(sourceUrl: string): VideoPlatform | null {
  let host: string;
  try {
    host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") return "youtube";
  if (host === "tiktok.com" || host === "m.tiktok.com" || host === "vm.tiktok.com" || host === "vt.tiktok.com") return "tiktok";
  if (host === "instagram.com" || host === "m.instagram.com") return "instagram";
  return null;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{6,}$/;

export function youtubeVideoId(sourceUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && VIDEO_ID.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com") return null;
  const fromQuery = url.searchParams.get("v");
  if (fromQuery && VIDEO_ID.test(fromQuery)) return fromQuery;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] && ["shorts", "embed", "live", "v"].includes(segments[0]) && segments[1] && VIDEO_ID.test(segments[1])) {
    return segments[1];
  }
  return null;
}

export function tiktokVideoId(sourceUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(sourceUrl).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/\/(?:video|v|embed\/v2)\/(\d{6,})/i);
  return match?.[1] ?? null;
}

export type InstagramEmbed = { shortcode: string; kind: "reel" | "p" | "tv" };

export function instagramShortcode(sourceUrl: string): InstagramEmbed | null {
  const match = sourceUrl.match(/\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  const kind: InstagramEmbed["kind"] = raw === "reels" || raw === "reel" ? "reel" : raw === "tv" ? "tv" : "p";
  return { shortcode: match[2], kind };
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Monta o descritor de exibição do vídeo a partir da plataforma e da URL de
 * origem. O embed é sempre derivado de domínios oficiais e nunca da página
 * bruta; a URL direta de mídia só é usada se o conector já a tiver validado.
 */
export function buildVideoDisplay(input: VideoDisplayInput): VideoDisplay | null {
  const sourceUrl = typeof input.sourceUrl === "string" ? input.sourceUrl.trim() : "";
  const videoUrl = firstNonEmpty(input.videoUrl);
  const platform = normalizePlatform(input.platform) ?? (sourceUrl ? inferPlatformFromUrl(sourceUrl) : null);
  if (!platform || (!sourceUrl && !videoUrl)) return null;

  let embedUrl: string | null = null;
  let thumbnailUrl = firstNonEmpty(input.thumbnailUrl);

  if (platform === "youtube" && sourceUrl) {
    const id = youtubeVideoId(sourceUrl);
    if (id) {
      embedUrl = `https://www.youtube.com/embed/${id}?enablejsapi=1&rel=0`;
      if (!thumbnailUrl) thumbnailUrl = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
  } else if (platform === "tiktok" && sourceUrl) {
    const id = tiktokVideoId(sourceUrl);
    if (id) embedUrl = `https://www.tiktok.com/embed/v2/${id}`;
  } else if (platform === "instagram" && sourceUrl) {
    const parsed = instagramShortcode(sourceUrl);
    if (parsed) embedUrl = `https://www.instagram.com/${parsed.kind}/${parsed.shortcode}/embed/`;
  }

  return {
    platform,
    watch_url: sourceUrl || videoUrl!,
    embed_url: embedUrl,
    thumbnail_url: thumbnailUrl,
    video_url: videoUrl,
    title: firstNonEmpty(input.title),
    author_name: firstNonEmpty(input.authorName),
  };
}
