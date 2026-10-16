import "server-only";
import type { SourceMetadata } from "@/lib/server/supabase-rest";

type OEmbedResponse = {
  title?: unknown;
  author_name?: unknown;
  provider_name?: unknown;
  thumbnail_url?: unknown;
};

export async function fetchYouTubePublicMetadata(sourceUrl: string): Promise<SourceMetadata> {
  const source = new URL(sourceUrl);
  const allowedHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
  if (source.protocol !== "https:" || !allowedHosts.has(source.hostname.toLowerCase())) {
    throw new Error("UNSUPPORTED_SOURCE");
  }

  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", source.toString());
  endpoint.searchParams.set("format", "json");

  const response = await fetch(endpoint, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (response.status === 404 || response.status === 401 || response.status === 403) {
    throw new Error("SOURCE_METADATA_UNAVAILABLE");
  }
  if (!response.ok) throw new Error("SOURCE_PROVIDER_TEMPORARY_FAILURE");

  const data = (await response.json()) as OEmbedResponse;
  if (typeof data.title !== "string" || !data.title.trim()) {
    throw new Error("SOURCE_METADATA_INVALID");
  }

  const thumbnailUrl =
    typeof data.thumbnail_url === "string" ? new URL(data.thumbnail_url) : null;
  if (thumbnailUrl && (
    thumbnailUrl.protocol !== "https:" ||
    !["i.ytimg.com", "img.youtube.com"].includes(thumbnailUrl.hostname.toLowerCase())
  )) {
    throw new Error("SOURCE_METADATA_INVALID");
  }

  return {
    title: data.title.slice(0, 200),
    author_name: typeof data.author_name === "string" ? data.author_name.slice(0, 200) : null,
    provider_name: typeof data.provider_name === "string" ? data.provider_name.slice(0, 100) : null,
    thumbnail_url: thumbnailUrl?.toString() ?? null,
  };
}
