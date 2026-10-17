import "server-only";
import type { ResolvedSource, SourceConnector } from "@/lib/providers/sources/source-connector";
import { fetchAllowlistedDocument, parseAllowedHttpsUrl } from "@/lib/providers/sources/safe-fetch";
import { isPlatformMediaHost, isPlatformPageHost } from "@/lib/providers/sources/platform-hosts";
import { resolveExternalMediaContent } from "@/lib/providers/media/remote-video";

const PAGE_HOST = (hostname: string) => isPlatformPageHost("instagram", hostname);
const MEDIA_HOST = (hostname: string) => isPlatformMediaHost("instagram", hostname);

const IG_APP_ID = "936619743392459";
const SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const POST_PATH = /^\/(?:[A-Za-z0-9._]+\/)?(?:p|tv|reels?|share\/[a-z]+)\/([A-Za-z0-9_-]+)/i;

type IgVideoVersion = { url?: unknown; width?: unknown; height?: unknown };

type IgItem = {
  video_versions?: IgVideoVersion[];
  carousel_media?: IgItem[];
  caption?: { text?: unknown } | string | null;
  user?: { username?: unknown; full_name?: unknown };
  image_versions2?: { candidates?: Array<{ url?: unknown }> };
};

export function shortcodeToMediaId(shortcode: string): string | null {
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(shortcode)) return null;

  let mediaId = 0n;
  for (const character of shortcode) {
    const index = SHORTCODE_ALPHABET.indexOf(character);
    if (index < 0) return null;
    mediaId = mediaId * 64n + BigInt(index);
  }

  return mediaId > 0n ? mediaId.toString() : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaContent(html: string, keys: readonly string[]): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const attributes: Record<string, string> = {};
    for (const attribute of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const name = (attribute[1] ?? "").toLowerCase();
      const value = attribute[2] ?? attribute[3];
      if (name && value !== undefined) attributes[name] = value;
    }

    if (keys.some((key) => attributes.property === key || attributes.name === key)) {
      const content = firstString(attributes.content);
      if (content) return decodeEntities(content);
    }
  }

  return null;
}

function bestVideoUrl(versions: IgVideoVersion[] | undefined): string | null {
  if (!Array.isArray(versions)) return null;

  let best: { url: string; area: number } | null = null;
  for (const version of versions) {
    const url = firstString(version?.url);
    if (!url) continue;
    const width = typeof version.width === "number" ? version.width : 0;
    const height = typeof version.height === "number" ? version.height : 0;
    const area = width * height;
    if (!best || area > best.area) best = { url, area };
  }

  return best?.url ?? null;
}

function videoFromItem(item: IgItem | null): string | null {
  if (!item) return null;

  const direct = bestVideoUrl(item.video_versions);
  if (direct) return direct;

  if (Array.isArray(item.carousel_media)) {
    for (const entry of item.carousel_media) {
      const url = bestVideoUrl(entry?.video_versions);
      if (url) return url;
    }
  }

  return null;
}

function captionFromItem(item: IgItem | null): string | null {
  if (!item) return null;
  const caption = item.caption;
  if (typeof caption === "string") return firstString(caption);
  if (caption && typeof caption === "object") return firstString(caption.text);
  return null;
}

function authorFromItem(item: IgItem | null): string | null {
  if (!item?.user) return null;
  return firstString(item.user.full_name, item.user.username);
}

function thumbnailFromItem(item: IgItem | null): string | null {
  const candidates = item?.image_versions2?.candidates;
  if (!Array.isArray(candidates)) return null;
  return firstString(candidates[0]?.url);
}

async function resolveFromGraphql(
  mediaId: string,
): Promise<{ item: IgItem | null; videoUrl: string | null }> {
  try {
    const response = await fetchAllowlistedDocument({
      url: `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
      isAllowedHost: PAGE_HOST,
      headers: {
        "X-IG-App-ID": IG_APP_ID,
        "X-ASBD-ID": "198387",
        "X-IG-WWW-Claim": "0",
        Origin: "https://www.instagram.com",
        Accept: "*/*",
      },
    });

    const payload = JSON.parse(response.body) as { items?: unknown; status?: unknown };
    if (payload.status === "fail" || !Array.isArray(payload.items)) return { item: null, videoUrl: null };

    const item = (payload.items[0] ?? null) as IgItem | null;
    return { item, videoUrl: videoFromItem(item) };
  } catch {
    return { item: null, videoUrl: null };
  }
}

function parseOpenGraphPage(body: string): {
  caption: string | null;
  videoUrl: string | null;
  coverUrl: string | null;
} {
  return {
    caption: metaContent(body, ["og:title", "og:description", "twitter:title"]),
    videoUrl: metaContent(body, ["og:video:url", "og:video", "video:url", "og:contentUrl"]),
    coverUrl: metaContent(body, ["og:image", "og:image:url", "twitter:image"]),
  };
}

async function fetchPageDocument(url: string): Promise<{ finalUrl: string; body: string }> {
  return fetchAllowlistedDocument({ url, isAllowedHost: PAGE_HOST });
}

export const instagramConnector: SourceConnector = {
  platform: "instagram",

  async resolve(sourceUrl: string): Promise<ResolvedSource> {
    const source = parseAllowedHttpsUrl(sourceUrl, PAGE_HOST);
    if (!source) throw new Error("UNSUPPORTED_SOURCE");

    let target = source;
    let pageBody: string | null = null;
    let pageUnavailable = false;
    let shortcode = target.pathname.match(POST_PATH)?.[1] ?? null;

    // Share and alias URLs are resolved by following allowlisted redirects to
    // the canonical post path; the fetched page is reused for Open Graph data.
    if (!shortcode) {
      let failureCode = "UNSUPPORTED_SOURCE";
      try {
        const document = await fetchPageDocument(target.toString());
        pageBody = document.body;
        target = new URL(document.finalUrl);
        shortcode = target.pathname.match(POST_PATH)?.[1] ?? null;
      } catch (error) {
        failureCode = error instanceof Error ? error.message : "SOURCE_METADATA_UNAVAILABLE";
        pageUnavailable = true;
      }

      if (!shortcode) {
        if (pageUnavailable && failureCode !== "UNSUPPORTED_SOURCE") throw new Error(failureCode);
        throw new Error("UNSUPPORTED_SOURCE");
      }
    }

    const mediaId = shortcodeToMediaId(shortcode);
    const graphql = mediaId ? await resolveFromGraphql(mediaId) : { item: null, videoUrl: null };
    const graphCaption = captionFromItem(graphql.item);

    // The public page is only requested when the GraphQL response is missing
    // media or a caption, keeping the normal path at a single network round trip.
    if ((!graphql.videoUrl || !graphCaption) && pageBody === null && !pageUnavailable) {
      try {
        pageBody = (await fetchPageDocument(target.toString())).body;
      } catch (error) {
        const code = error instanceof Error ? error.message : "SOURCE_METADATA_UNAVAILABLE";
        if (!graphql.videoUrl && code === "SOURCE_PROVIDER_TEMPORARY_FAILURE") throw error;
        pageUnavailable = true;
      }
    }

    const page = pageBody === null ? null : parseOpenGraphPage(pageBody);
    const mediaUrl = graphql.videoUrl ?? page?.videoUrl ?? null;
    const caption = graphCaption ?? page?.caption ?? "";
    const authorName = authorFromItem(graphql.item);
    const thumbnail = thumbnailFromItem(graphql.item) ?? page?.coverUrl ?? null;

    const metadata = {
      title: (caption || (authorName ? `Instagram de ${authorName}` : "Post do Instagram")).slice(0, 200),
      author_name: authorName?.slice(0, 200) ?? null,
      provider_name: "Instagram",
      thumbnail_url: thumbnail ? (parseAllowedHttpsUrl(thumbnail, MEDIA_HOST)?.toString() ?? null) : null,
    };

    if (!mediaUrl) {
      if (pageUnavailable && !graphql.item) throw new Error("SOURCE_METADATA_UNAVAILABLE");

      return {
        metadata,
        content: {
          kind: "transcript_required",
          code: "SOURCE_MEDIA_NOT_AVAILABLE",
          reason:
            "Este post do Instagram não é um vídeo (foto ou carrossel sem vídeo) ou não expôs uma URL de mídia pública. Envie uma transcrição autorizada para continuar.",
        },
      };
    }

    return {
      metadata,
      content: await resolveExternalMediaContent({
        mediaUrl,
        isAllowedHost: MEDIA_HOST,
        referer: "https://www.instagram.com/",
        platformLabel: "Instagram",
      }),
    };
  },
};
