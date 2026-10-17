import "server-only";
// Thin wrapper around the `partial-json` dependency so callers never touch the
// library directly. Streaming callers get a tolerant parse of an in-progress
// JSON buffer; anything unparseable yields undefined instead of throwing.
import { parse as partialParse, Allow } from "partial-json";

/**
 * Attempts to parse a (possibly incomplete) JSON string. Returns the decoded
 * value, or undefined when the buffer is too malformed to make sense of. This
 * never throws, so streaming loops can call it on every chunk.
 */
export function parsePartialJson(buffer: string): unknown {
  const trimmed = buffer.trim();
  if (!trimmed) return undefined;
  try {
    return partialParse(trimmed, Allow.ALL);
  } catch {
    return undefined;
  }
}
