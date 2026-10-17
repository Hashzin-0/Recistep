import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { fingerprintRecipe, hashSourceContent, hashSourceUrl, normalizeRecipeTitle } from "@/lib/recipe/fingerprint";
import { findRecipeCacheEntry } from "@/lib/server/supabase-rest";
import { recipeExtractionSchema, type RecipeExtraction } from "@/lib/schemas/recipe";

export { fingerprintRecipe, hashSourceContent, hashSourceUrl, normalizeRecipeTitle };
export type RecipeCacheEntry = {
  source_url_hash: string | null; source_content_hash: string | null; recipe_fingerprint: string;
  normalized_title: string; recipe_draft: RecipeExtraction; source_metadata: Record<string, unknown> | null;
};
type CacheValue = RecipeCacheEntry | null;
const MEMORY_TTL_MS = 5 * 60 * 1000;
const MEMORY_MAX_ENTRIES = 500;
const memoryCache = new Map<string, { expiresAt: number; value: CacheValue }>();
const cachedDatabaseLookup = unstable_cache(
  async (kind: "url" | "content" | "title", hash: string) => findRecipeCacheEntry(kind, hash),
  ["recistep-recipe-cache-v1"], { revalidate: 3600, tags: ["recistep-recipe-cache"] },
);
function remember(key: string, value: CacheValue): void {
  if (memoryCache.size >= MEMORY_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + MEMORY_TTL_MS });
}
async function lookup(kind: "url" | "content" | "title", hash: string): Promise<CacheValue> {
  const key = kind + ":" + hash;
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) memoryCache.delete(key);
  const rawValue = await cachedDatabaseLookup(kind, hash);
  const parsed = rawValue ? recipeExtractionSchema.safeParse(rawValue.recipe_draft) : null;
  const value: CacheValue = rawValue && parsed?.success ? { ...rawValue, recipe_draft: parsed.data } as RecipeCacheEntry : null;
  remember(key, value);
  return value;
}
export function findCachedRecipeByUrl(sourceUrl: string): Promise<CacheValue> { return lookup("url", hashSourceUrl(sourceUrl)); }
export function findCachedRecipeByContent(content: string): Promise<CacheValue> { return lookup("content", hashSourceContent(content)); }
export async function findCachedRecipeByTitle(title: string): Promise<CacheValue> {
  const normalized = normalizeRecipeTitle(title);
  if (normalized.length < 10 || ["receita", "recipe", "food", "shorts", "comida", "culinaria"].includes(normalized)) return Promise.resolve(null);
  const cached = await lookup("title", normalized);
  // Avoid treating two different recipes with a reused/generic video title as identical.
  if (!cached || normalizeRecipeTitle(cached.recipe_draft.title) !== normalized) return null;
  return cached;
}
export async function persistRecipeCache(input: {
  sourceUrl?: string | null; sourceContent?: string | null; recipe: RecipeExtraction; sourceMetadata?: Record<string, unknown> | null;
}): Promise<void> {
  const sourceUrlHash = input.sourceUrl ? hashSourceUrl(input.sourceUrl) : null;
  const sourceContentHash = input.sourceContent ? hashSourceContent(input.sourceContent) : null;
  const publicSourceContentHash = sourceUrlHash && input.sourceContent ? sourceContentHash : null;
  const recipeFingerprint = fingerprintRecipe(input.recipe);
  const metadataTitle = typeof input.sourceMetadata?.title === "string" ? input.sourceMetadata.title : input.recipe.title;
  const normalizedTitle = normalizeRecipeTitle(metadataTitle);
  await findRecipeCacheEntry("write", JSON.stringify({
    source_url_hash: sourceUrlHash, source_content_hash: publicSourceContentHash,
    recipe_fingerprint: recipeFingerprint, normalized_title: normalizedTitle,
    recipe_draft: input.recipe, source_metadata: input.sourceMetadata ?? null,
  }));
  const entry: RecipeCacheEntry = {
    source_url_hash: sourceUrlHash, source_content_hash: publicSourceContentHash,
    recipe_fingerprint: recipeFingerprint, normalized_title: normalizedTitle,
    recipe_draft: input.recipe, source_metadata: input.sourceMetadata ?? null,
  };
  if (sourceUrlHash) remember("url:" + sourceUrlHash, entry);
  if (publicSourceContentHash) remember("content:" + publicSourceContentHash, entry);
  remember("title:" + normalizedTitle, entry);
  revalidateTag("recistep-recipe-cache", { expire: 0 });
}
