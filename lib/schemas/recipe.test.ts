import { describe, expect, it } from "vitest";
import { recipeExtractionSchema } from "./recipe";

const validRecipe = {
  title: "Pão caseiro",
  description: null,
  source_language: "pt-BR",
  servings: 4,
  timings: {
    prep_seconds: null,
    cook_seconds: 1800,
    total_seconds: 1800,
  },
  ingredients: [
    {
      name: "farinha",
      quantity: 500,
      unit: "g",
      notes: null,
      source_evidence: null,
      confidence: 0.8,
    },
  ],
  steps: [
    {
      position: 0,
      instruction: "Misture os ingredientes.",
      duration_seconds: null,
      temperature_value: null,
      temperature_unit: null,
      source_evidence: null,
      confidence: 0.7,
    },
  ],
  uncertainties: ["O tempo de descanso não foi informado."],
  warnings: [],
};

describe("recipeExtractionSchema", () => {
  it("accepts a structured recipe with unknown fields represented as null", () => {
    expect(recipeExtractionSchema.safeParse(validRecipe).success).toBe(true);
  });

  it("rejects extra fields rather than silently accepting provider output", () => {
    expect(
      recipeExtractionSchema.safeParse({ ...validRecipe, owner_id: "user-123" }).success,
    ).toBe(false);
  });

  it("rejects duplicate step positions", () => {
    const duplicateSteps = {
      ...validRecipe,
      steps: [
        validRecipe.steps[0],
        { ...validRecipe.steps[0], instruction: "Outra etapa." },
      ],
    };

    expect(recipeExtractionSchema.safeParse(duplicateSteps).success).toBe(false);
  });

  it("rejects a total time shorter than known prep or cooking time", () => {
    const invalidTimings = {
      ...validRecipe,
      timings: {
        prep_seconds: 1200,
        cook_seconds: 1800,
        total_seconds: 900,
      },
    };

    expect(recipeExtractionSchema.safeParse(invalidTimings).success).toBe(false);
  });

  it("rejects non-positive ingredient quantities", () => {
    const invalidQuantity = {
      ...validRecipe,
      ingredients: [{ ...validRecipe.ingredients[0], quantity: 0 }],
    };

    expect(recipeExtractionSchema.safeParse(invalidQuantity).success).toBe(false);
  });
});
