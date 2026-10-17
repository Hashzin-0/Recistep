import { describe, expect, it } from "vitest";
import { recipeExtractionSchema } from "@/lib/schemas/recipe";
import { draftFromDbRecipe, recipeSummary, type DbIngredientRow, type DbRecipeRow, type DbStepRow } from "@/lib/recipe/recipe-draft";

const recipe: DbRecipeRow = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "22222222-2222-2222-2222-222222222222",
  source_import_id: null,
  title: "Bolo simples",
  description: null,
  source_url: null,
  source_language: "pt-BR",
  servings: 8,
  prep_seconds: 600,
  cook_seconds: null,
  total_seconds: null,
  uncertainties: ["tempo de forno"],
  warnings: ["forno varia", 42],
  is_confirmed: true,
  created_at: "2026-10-17T00:00:00.000Z",
  updated_at: "2026-10-17T00:00:00.000Z",
};

function ingredient(overrides: Partial<DbIngredientRow>): DbIngredientRow {
  return {
    id: "a", name: "Farinha", quantity: 2, quantity_text: "2 xícaras",
    quantity_min: null, quantity_max: null, unit: "xícara", unit_normalized: "cup",
    notes: null, source_evidence: null, confidence: 0.9, position: 0,
    ...overrides,
  };
}

function step(overrides: Partial<DbStepRow>): DbStepRow {
  return {
    id: "s", position: 0, instruction: "Misture tudo", duration_seconds: 120,
    duration_text: null, duration_min_seconds: null, duration_max_seconds: null,
    temperature_value: null, temperature_unit: null, source_evidence: null,
    confidence: 0.8, ...overrides,
  };
}

describe("draftFromDbRecipe", () => {
  it("maps rich measurement columns and filters non-string list entries", () => {
    const draft = draftFromDbRecipe(
      recipe,
      [ingredient({ position: 1, name: "Açúcar" }), ingredient({ position: 0 })],
      [step({ position: 1, instruction: "Asse" }), step({ position: 0 })],
    );

    expect(recipeExtractionSchema.safeParse(draft).success).toBe(true);
    expect(draft.description).toBeNull();
    expect(draft.timings).toEqual({ prep_seconds: 600, cook_seconds: null, total_seconds: null });
    expect(draft.ingredients.map((item) => item.name)).toEqual(["Farinha", "Açúcar"]);
    expect(draft.ingredients[0]).toMatchObject({ quantity_text: "2 xícaras", unit_normalized: "cup" });
    expect(draft.steps.map((item) => item.instruction)).toEqual(["Misture tudo", "Asse"]);
    expect(draft.warnings).toEqual(["forno varia"]);
    expect(draft.uncertainties).toEqual(["tempo de forno"]);
  });

  it("preserves unknown quantities as null", () => {
    const draft = draftFromDbRecipe(recipe, [ingredient({ quantity: null, quantity_text: null })], [step({})]);
    expect(draft.ingredients[0].quantity).toBeNull();
    expect(draft.ingredients[0].quantity_text).toBeNull();
  });
});

describe("recipeSummary", () => {
  it("carries counts and omits internal fields", () => {
    const summary = recipeSummary(recipe, 3, 5);
    expect(summary).toMatchObject({ id: recipe.id, title: "Bolo simples", ingredients_count: 3, steps_count: 5 });
    expect(Object.keys(summary)).not.toContain("user_id");
    expect(Object.keys(summary)).not.toContain("uncertainties");
  });
});
