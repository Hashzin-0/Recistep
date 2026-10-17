import "server-only";

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

export type HostPolicy = (hostname: string) => boolean;

/**
 * Suffix matching is used only for CDN host families owned by the platform.
 * Exact page hosts keep being compared as exact names.
 */
export function hostMatchesSuffix(hostname: string, suffixes: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Returns a validated absolute HTTPS URL, or null when any check fails. */
export function parseAllowedHttpsUrl(raw: string, isAllowedHost: HostPolicy): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!isAllowedHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("SOURCE_PAGE_TOO_LARGE");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

export async function fetchAllowlistedDocument(input: {
  url: string;
  isAllowedHost: HostPolicy;
  headers?: Record<string, string>;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<{ finalUrl: string; body: string }> {
  const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let current = input.url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = parseAllowedHttpsUrl(current, input.isAllowedHost);
    if (!url) throw new Error("SOURCE_LOCATION_NOT_ALLOWED");

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": BROWSER_USER_AGENT,
          ...input.headers,
        },
      });
    } catch {
      throw new Error("SOURCE_PROVIDER_TEMPORARY_FAILURE");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error("SOURCE_REDIRECT_INVALID");
      current = new URL(location, url).toString();
      continue;
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("SOURCE_METADATA_UNAVAILABLE");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("SOURCE_PROVIDER_TEMPORARY_FAILURE");
    }

    const body = await readBoundedBody(response, maxBytes);
    return { finalUrl: url.toString(), body };
  }

  throw new Error("SOURCE_REDIRECT_LIMIT_EXCEEDED");
}
