export interface ScalableIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  quantityMin?: number | null;
  quantityMax?: number | null;
}

export interface ScaledIngredient extends ScalableIngredient {
  originalQuantity: number | null;
  scaled: boolean;
}

function scaleValue(value: number | null | undefined, factor: number): number | null {
  if (value === null || value === undefined) return null;
  return value * factor;
}

/**
 * Scales numeric ingredient quantities proportionally, including range bounds
 * when present. It deliberately does not convert units or round values because
 * those operations require ingredient- and unit-specific culinary rules.
 */
export function scaleIngredients(
  ingredients: readonly ScalableIngredient[],
  originalServings: number | null,
  targetServings: number,
): ScaledIngredient[] {
  if (!Number.isFinite(targetServings) || targetServings <= 0) {
    throw new RangeError("As porções desejadas devem ser um número positivo.");
  }

  if (originalServings === null || !Number.isFinite(originalServings) || originalServings <= 0) {
    throw new RangeError("As porções originais devem ser conhecidas e positivas.");
  }

  const factor = targetServings / originalServings;

  return ingredients.map((ingredient) => ({
    ...ingredient,
    originalQuantity: ingredient.quantity,
    quantity: scaleValue(ingredient.quantity, factor),
    quantityMin: scaleValue(ingredient.quantityMin, factor),
    quantityMax: scaleValue(ingredient.quantityMax, factor),
    scaled: ingredient.quantity !== null && ingredient.quantity !== undefined,
  }));
}
