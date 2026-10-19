import "server-only";
import {
  BROWSER_USER_AGENT,
  parseAllowedHttpsUrl,
  type HostPolicy,
} from "@/lib/providers/sources/safe-fetch";

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

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error("SOURCE_MEDIA_TOO_LARGE");
    return new Uint8Array(buffer);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("SOURCE_MEDIA_TOO_LARGE");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Downloads a platform CDN video into memory so it can be handed to the AI
 * provider without relying on the provider to fetch a signed URL itself. The
 * allowlist, redirect handling and byte cap mirror `probeExternalMedia`.
 */
export async function downloadExternalMedia(input: {
  mediaUrl: string;
  isAllowedHost: HostPolicy;
  referer: string;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<{ bytes: Uint8Array; mimeType: string | null }> {
  const maxBytes = input.maxBytes ?? EXTERNAL_MEDIA_MAX_BYTES;
  const timeoutMs = input.timeoutMs ?? TIMEOUT_MS;

  let current = parseAllowedHttpsUrl(input.mediaUrl, input.isAllowedHost);
  if (!current) throw new Error("SOURCE_MEDIA_URL_INVALID");

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = current;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        headers: {
          Accept: "video/mp4,video/*;q=0.9,*/*;q=0.5",
          "User-Agent": BROWSER_USER_AGENT,
          Referer: input.referer,
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

    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("SOURCE_PROVIDER_TEMPORARY_FAILURE");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("SOURCE_MEDIA_UNAVAILABLE");
    }

    const declared = totalBytesFrom(response);
    if (declared !== null && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("SOURCE_MEDIA_TOO_LARGE");
    }

    const bytes = await readBoundedBytes(response, maxBytes);
    if (bytes.byteLength === 0) throw new Error("SOURCE_MEDIA_UNAVAILABLE");

    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || null;
    return { bytes, mimeType };
  }

  throw new Error("SOURCE_MEDIA_URL_INVALID");
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
