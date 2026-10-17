import "server-only";
import type { SourceMetadata } from "@/lib/server/supabase-rest";
import type { SupportedPlatform } from "@/lib/source-url";

export type ResolvedContent =
  | { kind: "youtube_url"; mediaUrl: string }
  | { kind: "external_media"; mediaUrl: string; mimeType: "video/mp4" }
  | { kind: "transcript_required"; code: string; reason: string };

export type MediaContent = Exclude<ResolvedContent, { kind: "transcript_required" }>;

export function isMediaContent(content: ResolvedContent): content is MediaContent {
  return content.kind !== "transcript_required";
}

export type ResolvedSource = {
  metadata: SourceMetadata;
  content: ResolvedContent;
};

/**
 * A connector may only be enabled when the platform permits the access method
 * it implements. Recognizing a URL never implies the media can be acquired.
 */
export interface SourceConnector {
  readonly platform: SupportedPlatform;
  resolve(sourceUrl: string): Promise<ResolvedSource>;
}
