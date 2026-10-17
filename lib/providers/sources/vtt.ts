/**
 * Converts a WebVTT caption track into plain, readable text. The spoken words
 * are the only content the extractor may rely on; timestamps, cue numbering,
 * inline karaoke tags and styling blocks are dropped.
 */
const INLINE_TIMESTAMP = /<\d{2}:\d{2}:\d{2}\.\d{1,3}>/g;
const INLINE_TAG = /<[^>]+>/g;
const CUE_TIMING = /^\d{2}:\d{2}:\d{2}\.\d{1,3}\s+-->/;
const CUE_COUNTER = /^\d+$/;

export function vttToText(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const cues: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(INLINE_TIMESTAMP, "").replace(INLINE_TAG, "").trim();
    if (!line) continue;
    if (line === "WEBVTT" || line.startsWith("WEBVTT ")) continue;
    if (line.startsWith("NOTE") || line.startsWith("STYLE") || line.startsWith("REGION")) continue;
    if (CUE_TIMING.test(line) || CUE_COUNTER.test(line)) continue;
    if (cues[cues.length - 1] === line) continue;
    cues.push(line);
  }

  return cues.join(" ").replace(/\s+/g, " ").trim();
}
