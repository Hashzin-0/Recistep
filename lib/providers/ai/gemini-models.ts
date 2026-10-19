/**
 * Ordered list of Gemini model IDs used by the extraction pipeline. The list is
 * tried sequentially until one succeeds; if every model fails the caller falls
 * back to OpenRouter.
 *
 * Configure multiple models with `GEMINI_MODELS` (comma-separated). When it is
 * absent, a single model is used: `GEMINI_MODEL` or the built-in default.
 */
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export function resolveGeminiModels(): string[] {
  const configured = process.env.GEMINI_MODELS?.split(",") ?? [];
  const models = configured
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  if (models.length > 0) return [...new Set(models)];

  const single = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  return [single];
}
