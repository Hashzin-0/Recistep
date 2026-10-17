import "server-only";
import type { ResolvedSource, SourceConnector } from "@/lib/providers/sources/source-connector";
import { MIN_PUBLIC_TEXT_LENGTH } from "@/lib/providers/sources/source-connector";
import {
  fetchAllowlistedDocument,
  parseAllowedHttpsUrl,
  resolveAllowlistedLocation,
} from "@/lib/providers/sources/safe-fetch";
import { isPlatformMediaHost, isPlatformPageHost } from "@/lib/providers/sources/platform-hosts";

const PAGE_HOST = (hostname: string) => isPlatformPageHost("instagram", hostname);
const MEDIA_HOST = (hostname: string) => isPlatformMediaHost("instagram", hostname);

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

/**
 * Instagram gates the post page, its embed and the `i.instagram.com` API behind
 * login for server requests (they return a JS shell or a login redirect), so no
 * media URL is obtainable without credentials. The public oEmbed endpoint still
 * answers with the caption, which recipe reels frequently carry in full.
 */
async function fetchOEmbed(canonicalUrl: string): Promise<OEmbedPayload> {
  const document = await fetchAllowlistedDocument({
    url: `${OEMBED_ENDPOINT}?url=${encodeURIComponent(canonicalUrl)}`,
    isAllowedHost: PAGE_HOST,
  });

  let payload: unknown;
  try {
    payload = JSON.parse(document.body);
  } catch {
    throw new Error("SOURCE_METADATA_UNAVAILABLE");
  }

  if (!payload || typeof payload !== "object") throw new Error("SOURCE_METADATA_UNAVAILABLE");
  return payload as OEmbedPayload;
}

export const instagramConnector: SourceConnector = {
  platform: "instagram",

  async resolve(sourceUrl: string): Promise<ResolvedSource> {
    const source = parseAllowedHttpsUrl(sourceUrl, PAGE_HOST);
    if (!source) throw new Error("UNSUPPORTED_SOURCE");

    // Share and alias links do not carry the canonical post path; follow the
    // allowlisted redirect so oEmbed receives a URL it can resolve.
    const canonical = POST_PATH.test(source.pathname)
      ? source
      : new URL(await resolveAllowlistedLocation({ url: source.toString(), isAllowedHost: PAGE_HOST }));

    if (!POST_PATH.test(canonical.pathname)) throw new Error("UNSUPPORTED_SOURCE");

    const oembed = await fetchOEmbed(canonical.toString());
    const caption = firstString(oembed.title) ?? "";
    const authorName = firstString(oembed.author_name);
    const thumbnail = firstString(oembed.thumbnail_url);

    const metadata = {
      title: (caption || (authorName ? `Instagram de ${authorName}` : "Post do Instagram")).slice(0, 200),
      author_name: authorName?.slice(0, 200) ?? null,
      provider_name: "Instagram",
      thumbnail_url: thumbnail
        ? (parseAllowedHttpsUrl(thumbnail, MEDIA_HOST)?.toString() ?? null)
        : null,
    };

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
