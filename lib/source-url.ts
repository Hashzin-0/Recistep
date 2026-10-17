export const SUPPORTED_SOURCE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "instagram.com",
  "www.instagram.com",
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

  if (["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(hostname)) {
    return "tiktok";
  }

  if (["instagram.com", "www.instagram.com"].includes(hostname)) {
    return "instagram";
  }

  return null;
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

  return { ok: true, url, platform };
}
