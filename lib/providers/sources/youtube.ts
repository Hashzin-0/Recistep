import "server-only";
import type { SourceConnector, ResolvedSource } from "@/lib/providers/sources/source-connector";
import { fetchYouTubePublicMetadata } from "@/lib/providers/sources/youtube-oembed";

export const youtubeConnector: SourceConnector = {
  platform: "youtube",

  async resolve(sourceUrl: string): Promise<ResolvedSource> {
    const metadata = await fetchYouTubePublicMetadata(sourceUrl);

    return {
      metadata,
      content: { kind: "youtube_url", mediaUrl: sourceUrl },
    };
  },
};
