import "server-only";
import type { SupportedPlatform } from "@/lib/source-url";
import type { SourceConnector, ResolvedSource } from "@/lib/providers/sources/source-connector";
import { youtubeConnector } from "@/lib/providers/sources/youtube";
import { tiktokConnector } from "@/lib/providers/sources/tiktok";
import { instagramConnector } from "@/lib/providers/sources/instagram";
import { resolveExternalMedia } from "@/lib/providers/sources/external-media-extractor";

async function resolveSocialSource(
  connector: SourceConnector,
  sourceUrl: string,
): Promise<ResolvedSource> {
  // The external extractor is opt-in. Without its URL and server-only key,
  // resolveExternalMedia returns null and the existing connector behaves as before.
  if (connector.platform === "instagram" || connector.platform === "tiktok") {
    const extracted = await resolveExternalMedia(sourceUrl, connector.platform);
    if (extracted) return extracted;
  }

  return connector.resolve(sourceUrl);
}

const connectors: Record<SupportedPlatform, SourceConnector> = {
  youtube: youtubeConnector,
  tiktok: {
    platform: "tiktok",
    resolve: (sourceUrl) => resolveSocialSource(tiktokConnector, sourceUrl),
  },
  instagram: {
    platform: "instagram",
    resolve: (sourceUrl) => resolveSocialSource(instagramConnector, sourceUrl),
  },
};

export function getSourceConnector(platform: SupportedPlatform): SourceConnector {
  const connector = connectors[platform];
  if (!connector) throw new Error("PLATFORM_CONNECTOR_NOT_CONFIGURED");
  return connector;
}
