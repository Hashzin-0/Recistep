import type { IngredientExtraction, RecipeExtraction } from "@/lib/schemas/recipe";

export const CUPS_TO_GRAMS_FACTOR = 240;

export function gramsPerCupForIngredient(_name?: string | null): number {
  return CUPS_TO_GRAMS_FACTOR;
}

export function isCupUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  const folded = unit
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return folded === "xicara" || folded === "cup" || folded === "xicaras" || folded === "cups" || folded === "xicara(s)" || folded === "cup(s)";
}

export function convertIngredientCupsToGrams<T extends IngredientExtraction>(ingredient: T): T {
  const unit = ingredient.unit ?? ingredient.unit_normalized ?? null;
  if (!isCupUnit(unit)) return ingredient;

  const convertNumber = (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) return value ?? null;
    const converted = value * CUPS_TO_GRAMS_FACTOR;
    return Number.isFinite(converted) ? Math.round(converted * 100) / 100 : value;
  };

  const quantity = convertNumber(ingredient.quantity);
  const quantity_min = convertNumber(ingredient.quantity_min);
  const quantity_max = convertNumber(ingredient.quantity_max);

  let quantity_text = ingredient.quantity_text;
  if (quantity !== null || quantity_min !== null || quantity_max !== null) {
    if (quantity_min !== null && quantity_max !== null && quantity_min !== quantity_max) {
      quantity_text = `${quantity_min} a ${quantity_max} g`;
    } else if (quantity !== null) {
      quantity_text = `${quantity} g`;
    }
  }

  return {
    ...ingredient,
    quantity,
    quantity_min,
    quantity_max,
    unit: "g",
    unit_normalized: "g",
    quantity_text,
  };
}

export function convertRecipeCupsToGrams(recipe: RecipeExtraction): RecipeExtraction {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => convertIngredientCupsToGrams(ingredient)),
  };
}

export const convertCupsToGrams = convertRecipeCupsToGrams;
export const convertCupToGrams = convertIngredientCupsToGrams;
export const cupToGrams = convertRecipeCupsToGrams;
export const cupsToGrams = convertRecipeCupsToGrams;
export const convertCupsToGramsInRecipe = convertRecipeCupsToGrams;
export const convertCupToGramsIngredient = convertIngredientCupsToGrams;

export type ConvertCupsToGramsOptions = { enabled?: boolean; convertCupsToGrams?: boolean };
export function applyCupToGramsConversion(
  recipe: RecipeExtraction,
  enabled: boolean | ConvertCupsToGramsOptions = false,
): RecipeExtraction {
  const shouldConvert =
    typeof enabled === "boolean"
      ? enabled
      : Boolean(enabled?.enabled || enabled?.convertCupsToGrams);
  return shouldConvert ? convertRecipeCupsToGrams(recipe) : recipe;
}
