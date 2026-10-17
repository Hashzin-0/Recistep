import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  extractRecipeFromTranscript,
  GeminiExtractionError,
} from "./gemini-recipe-extractor";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const transcript = "Misture a farinha, o leite e os ovos. Mexa até ficar homogêneo e asse por trinta minutos em forno preaquecido.";
const validRecipe = {
  title: "Massa simples",
  description: null,
  source_language: "pt-BR",
  servings: null,
  timings: { prep_seconds: null, cook_seconds: 1800, total_seconds: 1800 },
  ingredients: [{
    name: "farinha",
    quantity: null,
    unit: null,
    notes: null,
    source_evidence: "Misture a farinha",
    confidence: 0.8,
  }],
  steps: [{
    position: 0,
    instruction: "Misture a farinha, o leite e os ovos.",
    duration_seconds: null,
    temperature_value: null,
    temperature_unit: null,
    source_evidence: "Misture a farinha, o leite e os ovos",
    confidence: 0.8,
  }],
  uncertainties: ["As quantidades não foram informadas."],
  warnings: [],
};

describe("extractRecipeFromTranscript", () => {
  it("rejects short transcripts before making a provider request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractRecipeFromTranscript({ transcript: "curto" }))
      .rejects.toBeInstanceOf(GeminiExtractionError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates structured Gemini output with the domain schema", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(validRecipe) }] },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractRecipeFromTranscript({ transcript });
    expect(result.title).toBe("Massa simples");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("test-key");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("test-key");
  });

  it("rejects malformed model output rather than returning an unvalidated recipe", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify({ title: "Sem receita" }) }] },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(extractRecipeFromTranscript({ transcript }))
      .rejects.toThrow("GEMINI_OUTPUT_SCHEMA_INVALID");
  });
});
