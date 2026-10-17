import { describe, expect, it } from "vitest";
import { fingerprintRecipe, hashSourceContent, hashSourceUrl, normalizeRecipeTitle } from "@/lib/recipe/fingerprint";
import type { RecipeExtraction } from "@/lib/schemas/recipe";

const recipe: RecipeExtraction = {
  title: "Bolo de Cenoura",
  description: null,
  source_language: "pt-BR",
  servings: 4,
  timings: { prep_seconds: null, cook_seconds: null, total_seconds: null },
  ingredients: [
    { name: "Cenoura", quantity: 2, unit: "un", notes: null, source_evidence: null, confidence: 0.9 },
    { name: "Farinha", quantity: 200, unit: "g", notes: null, source_evidence: null, confidence: 0.9 },
  ],
  steps: [{ position: 0, instruction: "Misture tudo.", duration_seconds: null, temperature_value: null, temperature_unit: null, source_evidence: null, confidence: 0.9 }],
  uncertainties: [],
  warnings: [],
};
describe("recipe fingerprints", () => {
  it("normalizes YouTube links that identify the same video", () => {
    expect(hashSourceUrl("https://www.youtube.com/watch?v=abc123&utm_source=x")).toBe(hashSourceUrl("https://youtu.be/abc123"));
    expect(hashSourceUrl("https://youtube.com/watch?v=abc123")).toBe(hashSourceUrl("https://youtu.be/abc123"));
    expect(hashSourceUrl("https://m.youtube.com/watch?v=abc123")).toBe(hashSourceUrl("https://youtu.be/abc123"));
  });
  it("normalizes whitespace and casing for source content hashes", () => {
    expect(hashSourceContent("  OVO   e Leite ")).toBe(hashSourceContent("ovo e leite"));
  });
  it("normalizes titles without punctuation differences", () => {
    expect(normalizeRecipeTitle("Bolo-de Cenoura!")).toBe("bolo de cenoura");
  });
  it("creates deterministic recipe fingerprints", () => {
    expect(fingerprintRecipe(recipe)).toBe(fingerprintRecipe({ ...recipe, title: "BOLO DE CENOURA" }));
  });
});
