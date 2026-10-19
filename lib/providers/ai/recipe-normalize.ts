import {
  utensilExtractionSchema,
  type RecipeExtraction,
  type IngredientExtraction,
  type PreparationStepExtraction,
} from "@/lib/schemas/recipe";
import { collectCoverageWarnings, enrichRecipeDraft } from "@/lib/recipe/enrich";

// Applies deterministic reconciliation and appends coverage warnings so that
// measurements and step times stated in the source are never dropped.
export function finalizeRecipe(draft: RecipeExtraction): RecipeExtraction {
  const enriched = enrichRecipeDraft(draft);
  const coverage = collectCoverageWarnings(enriched);
  if (coverage.length === 0) return enriched;
  const merged = [...enriched.warnings];
  for (const warning of coverage) {
    if (!merged.includes(warning)) merged.push(warning);
  }
  return { ...enriched, warnings: merged.slice(0, 100) };
}

// --- Lenient normalization of (possibly partial) decoded JSON -----------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function intOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n === null ? null : Math.round(n);
}

function coerceIngredient(value: unknown): IngredientExtraction | null {
  if (!isRecord(value)) return null;
  const name = stringOrNull(value.name)?.trim();
  if (!name) return null;
  const confidence = numberOrNull(value.confidence);
  return {
    name,
    section: stringOrNull(value.section)?.trim() || "Ingredientes",
    quantity: numberOrNull(value.quantity),
    quantity_text: stringOrNull(value.quantity_text)?.trim() || null,
    quantity_min: numberOrNull(value.quantity_min),
    quantity_max: numberOrNull(value.quantity_max),
    unit: stringOrNull(value.unit)?.trim() || null,
    unit_normalized: stringOrNull(value.unit_normalized)?.trim() || null,
    notes: stringOrNull(value.notes)?.trim() || null,
    source_evidence: stringOrNull(value.source_evidence)?.trim() || null,
    confidence: confidence === null ? 0 : Math.min(1, Math.max(0, confidence)),
  };
}

function coerceStep(value: unknown, index: number): PreparationStepExtraction | null {
  if (!isRecord(value)) return null;
  const instruction = stringOrNull(value.instruction)?.trim();
  if (!instruction) return null;
  const confidence = numberOrNull(value.confidence);
  const unit = stringOrNull(value.temperature_unit);
  return {
    position: intOrNull(value.position) ?? index,
    instruction,
    duration_seconds: intOrNull(value.duration_seconds),
    duration_text: stringOrNull(value.duration_text)?.trim() || null,
    duration_min_seconds: intOrNull(value.duration_min_seconds),
    duration_max_seconds: intOrNull(value.duration_max_seconds),
    temperature_value: numberOrNull(value.temperature_value),
    temperature_unit: unit === "C" || unit === "F" ? unit : null,
    video_start_seconds: intOrNull(value.video_start_seconds),
    video_end_seconds: intOrNull(value.video_end_seconds),
    source_evidence: stringOrNull(value.source_evidence)?.trim() || null,
    confidence: confidence === null ? 0 : Math.min(1, Math.max(0, confidence)),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
}

/**
 * Best-effort coercion of an in-progress decode into a RecipeExtraction. Used
 * only for intermediate streaming snapshots; the final result is always
 * re-validated against the strict schema. Returns null when there is no title
 * yet (nothing worth showing).
 */
export function normalizePartialRecipe(decoded: unknown): RecipeExtraction | null {
  if (!isRecord(decoded)) return null;
  const title = stringOrNull(decoded.title)?.trim();
  if (!title) return null;

  const rawTimings = isRecord(decoded.timings) ? decoded.timings : {};
  const ingredients = Array.isArray(decoded.ingredients)
    ? decoded.ingredients.map(coerceIngredient).filter((item): item is IngredientExtraction => item !== null)
    : [];
  const steps = Array.isArray(decoded.steps)
    ? decoded.steps.map((item, index) => coerceStep(item, index)).filter((item): item is PreparationStepExtraction => item !== null)
    : [];

  return {
    title,
    description: stringOrNull(decoded.description)?.trim() || null,
    source_language: stringOrNull(decoded.source_language)?.trim() || null,
    servings: numberOrNull(decoded.servings),
    cover_image_url: null,
    utensils: Array.isArray(decoded.utensils)
      ? decoded.utensils.flatMap((item) => {
          const parsed = utensilExtractionSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        })
      : [],
    timings: {
      prep_seconds: intOrNull(rawTimings.prep_seconds),
      cook_seconds: intOrNull(rawTimings.cook_seconds),
      total_seconds: intOrNull(rawTimings.total_seconds),
    },
    ingredients,
    steps,
    uncertainties: stringArray(decoded.uncertainties),
    warnings: stringArray(decoded.warnings),
  };
}
