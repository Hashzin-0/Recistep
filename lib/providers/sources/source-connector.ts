import "server-only";
import type { SourceMetadata } from "@/lib/server/supabase-rest";
import type { SupportedPlatform } from "@/lib/source-url";

/** Public text shorter than this cannot sustain a recipe extraction. */
export const MIN_PUBLIC_TEXT_LENGTH = 80;

export type ResolvedContent =
  | { kind: "youtube_url"; mediaUrl: string }
  | { kind: "external_media"; mediaUrl: string; mimeType: "video/mp4" }
  | { kind: "external_subtitles"; url: string; mimeType: "text/vtt" }
  | { kind: "public_text"; text: string }
  | { kind: "unsupported_content"; code: string; reason: string }
  | { kind: "transcript_required"; code: string; reason: string };

/** Content the provider can fetch directly as a video file. */
export type MediaContent = Extract<ResolvedContent, { kind: "youtube_url" | "external_media" }>;

/** Public text the connector obtained without downloading any media. */
export type TextContent = Extract<ResolvedContent, { kind: "external_subtitles" | "public_text" }>;

export function isMediaContent(content: ResolvedContent): content is MediaContent {
  return content.kind === "youtube_url" || content.kind === "external_media";
}

export function isTextContent(content: ResolvedContent): content is TextContent {
  return content.kind === "external_subtitles" || content.kind === "public_text";
}

/**
 * The source is recognized but its content cannot be analyzed at all (for
 * example an Instagram post whose video is gated behind login and whose
 * caption has no usable text). This is terminal, not a transcript request.
 */
export function isUnsupportedContent(
  content: ResolvedContent,
): content is Extract<ResolvedContent, { kind: "unsupported_content" }> {
  return content.kind === "unsupported_content";
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
