import "server-only";
import type { RecipeExtraction } from "@/lib/schemas/recipe";
import { getSourceImport, updateSourceImport } from "@/lib/server/supabase-rest";

/**
 * Consumes a streaming extraction, persisting each progressive snapshot to the
 * import so an SSE reader can render the recipe as it is deciphered. Returns
 * the final strict-validated recipe, or `null` when the import was cancelled.
 * Partial persistence is best-effort: a failed snapshot write never fails the
 * extraction, because the authoritative draft is persisted separately by the
 * caller.
 */
export async function streamExtractToImport(input: {
  importId: string;
  stream: AsyncGenerator<RecipeExtraction, void, undefined>;
}): Promise<RecipeExtraction | null> {
  let seq = 0;
  let last: RecipeExtraction | null = null;

  for await (const partial of input.stream) {
    const current = await getSourceImport(input.importId).catch(() => null);
    if (current?.status === "cancelled") {
      try { await updateSourceImport(input.importId, { recipe_partial: null }); } catch { /* best-effort */ }
      return null;
    }

    last = partial;
    seq += 1;
    try {
      await updateSourceImport(input.importId, {
        recipe_partial: partial,
        recipe_stream_seq: seq,
      });
    } catch {
      // Best-effort: keep streaming even if a snapshot write fails.
    }
  }

  if (!last) throw new Error("EXTRACTION_STREAM_EMPTY");

  const finalRecord = await getSourceImport(input.importId).catch(() => null);
  if (finalRecord?.status === "cancelled") {
    try { await updateSourceImport(input.importId, { recipe_partial: null }); } catch { /* best-effort */ }
    return null;
  }

  try {
    await updateSourceImport(input.importId, { recipe_partial: null });
  } catch {
    // Clearing the partial is cosmetic; the final draft is authoritative.
  }

  return last;
}
