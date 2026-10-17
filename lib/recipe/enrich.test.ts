import { describe, expect, it } from "vitest";
import type { RecipeExtraction } from "@/lib/schemas/recipe";
import { collectCoverageWarnings, enrichRecipeDraft } from "./enrich";

function baseDraft(overrides: Partial<RecipeExtraction> = {}): RecipeExtraction {
  return {
    title: "Bolo simples",
    description: null,
    source_language: "pt-BR",
    servings: 8,
    timings: { prep_seconds: null, cook_seconds: null, total_seconds: null },
    ingredients: [
      {
        name: "farinha",
        quantity: null,
        quantity_text: "1 1/2 xícara",
        quantity_min: null,
        quantity_max: null,
        unit: "xícara",
        unit_normalized: null,
        notes: null,
        source_evidence: null,
        confidence: 0.8,
      },
    ],
    steps: [
      {
        position: 0,
        instruction: "Asse em forno preaquecido por 30 minutos.",
        duration_seconds: null,
        duration_text: null,
        duration_min_seconds: null,
        duration_max_seconds: null,
        temperature_value: null,
        temperature_unit: null,
        source_evidence: null,
        confidence: 0.8,
      },
    ],
    uncertainties: [],
    warnings: [],
    ...overrides,
  };
}

describe("enrichRecipeDraft", () => {
  it("fills quantity from quantity_text without overriding existing values", () => {
    const enriched = enrichRecipeDraft(baseDraft());
    expect(enriched.ingredients[0].quantity).toBeCloseTo(1.5);
    expect(enriched.ingredients[0].quantity_min).toBeNull();
  });

  it("normalizes unit when missing", () => {
    const enriched = enrichRecipeDraft(baseDraft());
    expect(enriched.ingredients[0].unit_normalized).toBe("xícara");
  });

  it("fills step duration from the instruction time phrase", () => {
    const enriched = enrichRecipeDraft(baseDraft());
    expect(enriched.steps[0].duration_seconds).toBe(1800);
    expect(enriched.steps[0].duration_text).toContain("30");
  });

  it("does not override a model-provided duration", () => {
    const draft = baseDraft();
    draft.steps[0].duration_seconds = 1200;
    draft.steps[0].duration_text = "20 minutos";
    const enriched = enrichRecipeDraft(draft);
    expect(enriched.steps[0].duration_seconds).toBe(1200);
  });

  it("leaves unknown quantities as null", () => {
    const draft = baseDraft();
    draft.ingredients[0].quantity_text = null;
    draft.ingredients[0].quantity = null;
    const enriched = enrichRecipeDraft(draft);
    expect(enriched.ingredients[0].quantity).toBeNull();
    expect(enriched.ingredients[0].quantity_min).toBeNull();
  });
});

describe("collectCoverageWarnings", () => {
  it("warns when a step mentions time but has no duration", () => {
    const warnings = collectCoverageWarnings(baseDraft());
    expect(warnings.some((w) => w.includes("tempo"))).toBe(true);
  });

  it("does not warn when duration is captured", () => {
    const draft = baseDraft();
    draft.steps[0].duration_seconds = 1800;
    const warnings = collectCoverageWarnings(draft);
    expect(warnings.some((w) => w.includes("tempo"))).toBe(false);
  });

  it("warns about uninterpretable ingredient quantities", () => {
    const draft = baseDraft();
    draft.ingredients[0].quantity_text = "um tanto";
    const warnings = collectCoverageWarnings(draft);
    expect(warnings.some((w) => w.includes("quantidade"))).toBe(true);
  });
});
