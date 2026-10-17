import "server-only";
import type { SupportedPlatform } from "@/lib/source-url";
import type { SourceConnector } from "@/lib/providers/sources/source-connector";
import { youtubeConnector } from "@/lib/providers/sources/youtube";
import { tiktokConnector } from "@/lib/providers/sources/tiktok";
import { instagramConnector } from "@/lib/providers/sources/instagram";

const connectors: Record<SupportedPlatform, SourceConnector> = {
  youtube: youtubeConnector,
  tiktok: tiktokConnector,
  instagram: instagramConnector,
};

export function getSourceConnector(platform: SupportedPlatform): SourceConnector {
  const connector = connectors[platform];
  if (!connector) throw new Error("PLATFORM_CONNECTOR_NOT_CONFIGURED");
  return connector;
}
