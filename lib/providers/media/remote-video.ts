import "server-only";
import {
  BROWSER_USER_AGENT,
  parseAllowedHttpsUrl,
  type HostPolicy,
} from "@/lib/providers/sources/safe-fetch";
import type { ResolvedContent } from "@/lib/providers/sources/source-connector";

/** The Gemini external-URL input accepts at most 15 MB per file. */
export const EXTERNAL_MEDIA_MAX_BYTES = 15 * 1024 * 1024;

const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 8_000;

function totalBytesFrom(response: Response): number | null {
  const contentRange = response.headers.get("content-range");
  const fromRange = contentRange?.match(/\/(\d+)\s*$/);
  if (fromRange?.[1]) {
    const parsed = Number(fromRange[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsed = Number(contentLength);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Confirms a platform CDN URL is reachable and small enough for the provider to
 * fetch it directly. Platform headers are required because these CDNs commonly
 * gate playback on a matching Referer.
 */
export async function probeExternalMedia(input: {
  mediaUrl: string;
  isAllowedHost: HostPolicy;
  referer: string;
}): Promise<{ contentLength: number | null }> {
  let current = parseAllowedHttpsUrl(input.mediaUrl, input.isAllowedHost);
  if (!current) throw new Error("SOURCE_MEDIA_URL_INVALID");

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = current;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
        headers: {
          Accept: "video/mp4,video/*;q=0.9,*/*;q=0.5",
          "User-Agent": BROWSER_USER_AGENT,
          Referer: input.referer,
          Range: "bytes=0-0",
        },
      });
    } catch {
      throw new Error("SOURCE_PROVIDER_TEMPORARY_FAILURE");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("SOURCE_MEDIA_URL_INVALID");
      current = parseAllowedHttpsUrl(new URL(location, url).toString(), input.isAllowedHost);
      if (!current) throw new Error("SOURCE_MEDIA_URL_INVALID");
      continue;
    }

    const contentLength = totalBytesFrom(response);
    await response.body?.cancel().catch(() => undefined);

    if (response.status >= 500) throw new Error("SOURCE_PROVIDER_TEMPORARY_FAILURE");
    if (!response.ok) throw new Error("SOURCE_MEDIA_UNAVAILABLE");
    if (contentLength !== null && contentLength > EXTERNAL_MEDIA_MAX_BYTES) {
      throw new Error("SOURCE_MEDIA_TOO_LARGE");
    }

    return { contentLength };
  }

  throw new Error("SOURCE_MEDIA_URL_INVALID");
}

/**
 * Turns a validated platform CDN URL into connector content. Any failure
 * (403 gating, missing Referer, oversize file) degrades to the authorized
 * transcript instead of retrying, because the provider cannot fetch the file.
 */
export async function resolveExternalMediaContent(input: {
  mediaUrl: string;
  isAllowedHost: HostPolicy;
  referer: string;
  platformLabel: string;
}): Promise<ResolvedContent> {
  try {
    await probeExternalMedia({
      mediaUrl: input.mediaUrl,
      isAllowedHost: input.isAllowedHost,
      referer: input.referer,
    });
    return { kind: "external_media", mediaUrl: input.mediaUrl, mimeType: "video/mp4" };
  } catch (error) {
    return {
      kind: "transcript_required",
      code: error instanceof Error ? error.message : "SOURCE_MEDIA_UNAVAILABLE",
      reason: `O vídeo do ${input.platformLabel} não pôde ser disponibilizado para análise automática (link indisponível, privado ou acima do limite permitido). Envie uma transcrição autorizada para continuar.`,
    };
  }
}
