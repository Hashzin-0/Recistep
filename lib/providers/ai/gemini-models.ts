/**
 * Ordered list of Gemini model IDs used by the extraction pipeline. The list is
 * tried sequentially until one succeeds; if every model fails the caller falls
 * back to OpenRouter.
 *
 * Built-in defaults are the currently available multimodal `generateContent`
 * models from the official catalog (https://ai.google.dev/gemini-api/docs/models),
 * ordered from highest quality/cost to cheapest: the Flash workhorse, its
 * predecessors, the Flash-Lite tiers and finally the `latest` alias. All accept
 * text plus image/audio/video/PDF input, as required by the extraction pipeline.
 *
 * Configure multiple models with `GEMINI_MODELS` (comma-separated, tried in
 * order). Otherwise a single `GEMINI_MODEL` overrides the whole default list; if
 * neither is set the default list below is used.
 */
export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
] as const;

export function resolveGeminiModels(): string[] {
  const configured = process.env.GEMINI_MODELS?.split(",") ?? [];
  const models = configured
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  if (models.length > 0) return [...new Set(models)];

  const single = process.env.GEMINI_MODEL?.trim();
  if (single) return [single];

  return [...DEFAULT_GEMINI_MODELS];
}
