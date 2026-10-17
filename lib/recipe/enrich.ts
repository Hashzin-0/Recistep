import type {
  RecipeExtraction,
  IngredientExtraction,
  PreparationStepExtraction,
} from "@/lib/schemas/recipe";
import {
  extractTimePhrase,
  normalizeUnit,
  parseDurationText,
  parseQuantityText,
} from "@/lib/recipe/measurement";

function composeQuantityText(ingredient: IngredientExtraction): string | null {
  if (ingredient.quantity_text) return ingredient.quantity_text;
  if (ingredient.quantity === null) return null;
  const unit = ingredient.unit ? ` ${ingredient.unit}` : "";
  return `${ingredient.quantity}${unit}`.trim();
}

function fillIngredientMeasure(ingredient: IngredientExtraction): IngredientExtraction {
  let { quantity, quantity_min, quantity_max, unit_normalized } = ingredient;
  const quantity_text = composeQuantityText(ingredient);

  if (quantity_text) {
    const parsed = parseQuantityText(quantity_text);
    if (quantity === null) quantity = parsed.representative;
    if (quantity_min === null) quantity_min = parsed.min;
    if (quantity_max === null) quantity_max = parsed.max;
  }

  if (unit_normalized === null && ingredient.unit) {
    unit_normalized = normalizeUnit(ingredient.unit).canonical;
  }

  return { ...ingredient, quantity_text, quantity, quantity_min, quantity_max, unit_normalized };
}

function fillStepDuration(step: PreparationStepExtraction): PreparationStepExtraction {
  let { duration_seconds, duration_min_seconds, duration_max_seconds, duration_text } = step;

  if (duration_text === null && duration_seconds !== null) {
    duration_text = `${duration_seconds} segundos`;
  }

  if (duration_text === null) {
    const phrase = extractTimePhrase(step.instruction);
    if (phrase) duration_text = phrase;
  }

  if (duration_text !== null) {
    const parsed = parseDurationText(duration_text);
    if (parsed) {
      if (duration_seconds === null) duration_seconds = parsed.representativeSeconds;
      if (duration_min_seconds === null) duration_min_seconds = parsed.minSeconds;
      if (duration_max_seconds === null) duration_max_seconds = parsed.maxSeconds;
    }
  }

  return { ...step, duration_seconds, duration_min_seconds, duration_max_seconds, duration_text };
}

/**
 * Fills gaps in an extracted recipe using deterministic parsers, without
 * overriding values the model already produced and without inventing data.
 * Steps whose instruction contains an explicit time get their duration filled;
 * ingredients get parsed quantities and normalized units.
 */
export function enrichRecipeDraft(draft: RecipeExtraction): RecipeExtraction {
  return {
    ...draft,
    ingredients: draft.ingredients.map(fillIngredientMeasure),
    steps: draft.steps.map(fillStepDuration),
  };
}

/**
 * Returns warnings for extraction gaps that a human should double-check: steps
 * whose instruction states a time but no duration was captured, and ingredients
 * whose quantity could not be represented numerically.
 */
export function collectCoverageWarnings(draft: RecipeExtraction): string[] {
  const warnings: string[] = [];

  for (const step of draft.steps) {
    if (step.duration_seconds === null && extractTimePhrase(step.instruction)) {
      warnings.push(`A etapa ${step.position + 1} menciona um tempo que não pôde ser confirmado automaticamente.`);
    }
  }

  for (const ingredient of draft.ingredients) {
    if (ingredient.quantity === null && ingredient.quantity_text &&
      !/a gosto|q\.b\.|quanto baste/i.test(ingredient.quantity_text)) {
      warnings.push(`A quantidade de "${ingredient.name}" não foi interpretada numericamente; confira na revisão.`);
    }
  }

  return warnings.slice(0, 100);
}
