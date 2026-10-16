export interface ScalableIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface ScaledIngredient extends ScalableIngredient {
  originalQuantity: number | null;
  scaled: boolean;
}

/**
 * Scales numeric ingredient quantities proportionally. It deliberately does
 * not convert units or round values because those operations require
 * ingredient- and unit-specific culinary rules.
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
    quantity:
      ingredient.quantity === null
        ? null
        : ingredient.quantity * factor,
    scaled: ingredient.quantity !== null,
  }));
}
