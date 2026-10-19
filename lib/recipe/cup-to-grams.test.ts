import { describe, expect, it } from "vitest";
import {
  CUPS_TO_GRAMS_FACTOR,
  convertIngredientCupsToGrams,
  convertRecipeCupsToGrams,
  gramsPerCupForIngredient,
  isCupUnit,
} from "./cup-to-grams";

describe("cup to grams", () => {
  it("uses 240g per cup", () => {
    expect(CUPS_TO_GRAMS_FACTOR).toBe(240);
    expect(gramsPerCupForIngredient("chocolate em pó")).toBe(240);
  });

  it("detects cup units", () => {
    expect(isCupUnit("xícara")).toBe(true);
    expect(isCupUnit("cup")).toBe(true);
    expect(isCupUnit("g")).toBe(false);
  });

  it("converts 1 cup of cocoa powder to 240g", () => {
    const ingredient = {
      name: "chocolate em pó",
      section: "Ingredientes",
      quantity: 1,
      quantity_text: "1 xícara",
      quantity_min: null,
      quantity_max: null,
      unit: "xícara",
      unit_normalized: "xícara",
      notes: null,
      source_evidence: null,
      confidence: 1,
    };
    const converted = convertIngredientCupsToGrams(ingredient);
    expect(converted.quantity).toBe(240);
    expect(converted.unit).toBe("g");
    expect(converted.unit_normalized).toBe("g");
    expect(converted.quantity_text).toBe("240 g");
  });

  it("scales fractional cups", () => {
    const ingredient = {
      name: "leite",
      section: "Ingredientes",
      quantity: 0.5,
      quantity_text: "1/2 xícara",
      quantity_min: null,
      quantity_max: null,
      unit: "xícara",
      unit_normalized: "xícara",
      notes: null,
      source_evidence: null,
      confidence: 1,
    };
    const converted = convertIngredientCupsToGrams(ingredient);
    expect(converted.quantity).toBe(120);
  });

  it("leaves non-cup units untouched", () => {
    const ingredient = {
      name: "farinha",
      section: "Ingredientes",
      quantity: 200,
      quantity_text: "200 g",
      quantity_min: null,
      quantity_max: null,
      unit: "g",
      unit_normalized: "g",
      notes: null,
      source_evidence: null,
      confidence: 1,
    };
    expect(convertIngredientCupsToGrams(ingredient)).toBe(ingredient);
  });

  it("converts all cup ingredients in a recipe", () => {
    const recipe = {
      title: "Bolo",
      description: null,
      source_language: null,
      servings: null,
      cover_image_url: null,
      timings: { prep_seconds: null, cook_seconds: null, total_seconds: null },
      ingredients: [
        { name: "chocolate em pó", section: "Ingredientes", quantity: 1, quantity_text: "1 xícara", quantity_min: null, quantity_max: null, unit: "xícara", unit_normalized: "xícara", notes: null, source_evidence: null, confidence: 1 },
        { name: "açúcar", section: "Ingredientes", quantity: 2, quantity_text: "2 xícaras", quantity_min: null, quantity_max: null, unit: "xícara", unit_normalized: "xícara", notes: null, source_evidence: null, confidence: 1 },
      ],
      utensils: [],
      steps: [],
      uncertainties: [],
      warnings: [],
    };
    const converted = convertRecipeCupsToGrams(recipe);
    expect(converted.ingredients[0].quantity).toBe(240);
    expect(converted.ingredients[1].quantity).toBe(480);
  });
});
