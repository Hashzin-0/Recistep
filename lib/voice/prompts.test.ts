import { describe, expect, it } from "vitest";
import type { RecipeExtraction } from "@/lib/schemas/recipe";
import {
  buildKitchenSystemInstruction,
  buildReviewSystemInstruction,
  type KitchenPromptContext,
} from "./prompts";

function makeContext(): KitchenPromptContext {
  return {
    title: "Bolo de fubá",
    description: "Receita da vovó",
    servings: 4,
    ingredients: [
      { name: "Fubá", quantity: 200, unit: "g", notes: null },
      { name: "Leite", quantity: 500, unit: "ml", notes: null },
      { name: "Sal", quantity: null, unit: null, notes: "a gosto" },
    ],
    steps: [
      { position: 3, instruction: "Asse em forno médio", duration_seconds: 1_800, temperature_value: 180, temperature_unit: "C" },
      { position: 1, instruction: "Misture os secos", duration_seconds: 300, temperature_value: null, temperature_unit: null },
      { position: 2, instruction: "Bata a massa", duration_seconds: null, temperature_value: null, temperature_unit: null },
    ],
  };
}

function makeDraft(): RecipeExtraction {
  return {
    title: "Bolo de fubá",
    description: "Receita da vovó",
    source_language: "pt",
    servings: 4,
    cover_image_url: null,
    utensils: [],
    timings: { prep_seconds: null, cook_seconds: null, total_seconds: null },
    ingredients: [
      { name: "Fubá", quantity: 200, unit: "g", notes: null, source_evidence: null, confidence: 1 },
      { name: "Leite", quantity: null, unit: null, notes: null, source_evidence: null, confidence: 1 },
    ],
    steps: [
      { position: 0, instruction: "Misture os secos", duration_seconds: 300, temperature_value: null, temperature_unit: null, source_evidence: null, confidence: 1 },
      { position: 1, instruction: "Asse em forno médio", duration_seconds: 1_800, temperature_value: 180, temperature_unit: "C", source_evidence: null, confidence: 1 },
    ],
    uncertainties: ["Tempo do forno não informado"],
    warnings: [],
  };
}

describe("buildKitchenSystemInstruction", () => {
  it("describes the assistant role and the cooking rules", () => {
    const text = buildKitchenSystemInstruction(makeContext());

    expect(text).toContain("Recistep");
    expect(text).toContain("assistente de voz");
    expect(text).toContain("Nunca invente quantidades");
    expect(text).toContain("Não avance para a próxima etapa");
    expect(text).toContain("português do Brasil");
  });

  it("embeds the recipe so short questions do not need a tool call", () => {
    const text = buildKitchenSystemInstruction(makeContext());

    expect(text).toContain("Receita: Bolo de fubá");
    expect(text).toContain("Descrição: Receita da vovó");
    expect(text).toContain("Porções: 4");
    expect(text).toContain("- Fubá: 200 g");
    expect(text).toContain("- Sal: quantidade não informada (a gosto)");
  });

  it("lists the steps in recipe order with time and temperature", () => {
    const text = buildKitchenSystemInstruction(makeContext());

    const first = text.indexOf("1. Misture os secos [5 min]");
    const second = text.indexOf("2. Bata a massa");
    const third = text.indexOf("3. Asse em forno médio [30 min, 180°C]");

    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("falls back to the tools when the recipe is too large for the prompt", () => {
    const context = makeContext();
    context.ingredients = Array.from({ length: 400 }, (_, index) => ({
      name: `Ingrediente ${index} da lista longa`,
      quantity: index + 1,
      unit: "g",
      notes: "observação repetida para ocupar espaço no aviso do sistema",
    }));

    const text = buildKitchenSystemInstruction(context);

    expect(text).toContain("Receita: Bolo de fubá");
    expect(text).toContain("400 ingredientes");
    expect(text).toContain("Use getRecipeOverview, listIngredients, listSteps e getStep");
    expect(text.length).toBeLessThan(3_000);
  });
});

describe("buildReviewSystemInstruction", () => {
  it("explains that the draft only saves after the user confirms", () => {
    const text = buildReviewSystemInstruction(makeDraft());

    expect(text).toContain("assistente de revisão do Recistep");
    expect(text).toContain("Confirmar receita");
    expect(text).toContain("Nunca invente ingredientes");
    expect(text).toContain("confirmRecipe");
  });

  it("includes the draft content, uncertainties and warnings", () => {
    const text = buildReviewSystemInstruction(makeDraft());

    expect(text).toContain("Rascunho atual: Bolo de fubá");
    expect(text).toContain("Porções: 4");
    expect(text).toContain("Fubá: 200 g");
    expect(text).toContain("Leite: quantidade não informada");
    expect(text).toContain("Incertezas apontadas pela extração: Tempo do forno não informado");
  });

  it("falls back to the tools for very large drafts", () => {
    const draft = makeDraft();
    draft.ingredients = Array.from({ length: 200 }, (_, index) => ({
      name: `Ingrediente ${index} ` + "x".repeat(160),
      quantity: index + 1,
      unit: "g",
      notes: null,
      source_evidence: null,
      confidence: 1,
    }));
    draft.steps = Array.from({ length: 120 }, (_, index) => ({
      position: index,
      instruction: `Etapa ${index}: ` + "uma instrução longa ".repeat(8),
      duration_seconds: null,
      temperature_value: null,
      temperature_unit: null,
      source_evidence: null,
      confidence: 1,
    }));

    const text = buildReviewSystemInstruction(draft);

    expect(text).toContain("Use getRecipeDraft, listDraftIngredients e listDraftSteps");
    expect(text).toContain("200 ingredientes");
    expect(text.length).toBeLessThan(3_000);
  });
});
