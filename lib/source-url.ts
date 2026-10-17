export const SUPPORTED_SOURCE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
] as const;

export type SupportedPlatform = "youtube" | "tiktok" | "instagram";

export type SourceUrlResult =
  | { ok: true; url: URL; platform: SupportedPlatform }
  | {
      ok: false;
      code: "INVALID_URL" | "UNSUPPORTED_SOURCE";
      message: string;
    };

function platformForHost(hostname: string): SupportedPlatform | null {
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(hostname)) {
    return "youtube";
  }

  if (["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(hostname)) {
    return "tiktok";
  }

  if (["instagram.com", "www.instagram.com", "m.instagram.com"].includes(hostname)) {
    return "instagram";
  }

  return null;
}

/**
 * Only the presence of a content path is required; profiles, feeds and pages
 * cannot be extracted, so rejecting them here fails faster than a queued job.
 */
function hasContentPath(platform: SupportedPlatform, url: URL): boolean {
  const segments = url.pathname.split("/").filter(Boolean);

  if (platform === "instagram") {
    return segments.length >= 2 || (segments[0] === "share" && segments.length >= 1);
  }

  if (platform === "tiktok") {
    const isShortLink = url.hostname === "vm.tiktok.com" || url.hostname === "vt.tiktok.com";
    if (isShortLink) return segments.length === 1;
    return segments.length >= 2;
  }

  return true;
}

/**
 * Validates a source URL without fetching it. Network access must happen only
 * in a separate connector with redirect and destination validation (SSRF defense).
 */
export function validateSourceUrl(raw: string): SourceUrlResult {
  if (raw.length > 2048) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "O link ultrapassa o tamanho permitido.",
    };
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Informe um link completo e válido.",
    };
  }

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0
  ) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Use um link HTTPS público, sem credenciais ou porta personalizada.",
    };
  }

  const platform = platformForHost(url.hostname.toLowerCase());

  if (!platform) {
    return {
      ok: false,
      code: "UNSUPPORTED_SOURCE",
      message: "Esta plataforma ainda não está na lista de fontes reconhecidas.",
    };
  }

  if (!hasContentPath(platform, url)) {
    return {
      ok: false,
      code: "UNSUPPORTED_SOURCE",
      message: "Informe o link direto de um vídeo ou de um post, não um perfil ou uma página geral.",
    };
  }

  return { ok: true, url, platform };
}
