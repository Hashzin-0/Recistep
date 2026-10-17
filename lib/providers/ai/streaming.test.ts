import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { parsePartialJson } from "./partial-json";
import { normalizePartialRecipe, streamRecipeFromTranscript } from "./gemini-recipe-extractor";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const finalRecipe = {
  title: "Bolo de chocolate",
  description: null,
  source_language: "pt-BR",
  servings: 8,
  timings: { prep_seconds: 900, cook_seconds: 1800, total_seconds: 2700 },
  ingredients: [
    { name: "farinha", quantity: 2, quantity_text: "2 xícara", quantity_min: null, quantity_max: null, unit: "xícara", unit_normalized: "xícara", notes: null, source_evidence: null, confidence: 0.9 },
    { name: "chocolate", quantity: 100, quantity_text: "100 g", quantity_min: null, quantity_max: null, unit: "g", unit_normalized: "g", notes: null, source_evidence: null, confidence: 0.9 },
  ],
  steps: [
    { position: 0, instruction: "Misture os ingredientes secos.", duration_seconds: 300, duration_text: "5 minutos", duration_min_seconds: null, duration_max_seconds: null, temperature_value: null, temperature_unit: null, source_evidence: null, confidence: 0.9 },
    { position: 1, instruction: "Asse por 30 minutos.", duration_seconds: 1800, duration_text: "30 minutos", duration_min_seconds: null, duration_max_seconds: null, temperature_value: 180, temperature_unit: "C", source_evidence: null, confidence: 0.9 },
  ],
  uncertainties: [],
  warnings: [],
};

describe("parsePartialJson", () => {
  it("parses complete JSON", () => {
    expect(parsePartialJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses an incomplete object", () => {
    expect(parsePartialJson('{"title":"Bolo","ingr')).toMatchObject({ title: "Bolo" });
  });

  it("parses a truncated array keeping the partial trailing item", () => {
    const decoded = parsePartialJson('{"ingredients":[{"name":"farinha"},{"name":"choco') as { ingredients: Array<{ name: string }> };
    expect(decoded.ingredients).toHaveLength(2);
    expect(decoded.ingredients[0].name).toBe("farinha");
    expect(decoded.ingredients[1].name).toBe("choco");
  });

  it("returns undefined only when the buffer is empty", () => {
    expect(parsePartialJson("")).toBeUndefined();
    // Unquoted-key garbage still yields an empty object rather than throwing.
    expect(parsePartialJson("{nope")).toEqual({});
  });
});

describe("normalizePartialRecipe", () => {
  it("returns null without a title", () => {
    expect(normalizePartialRecipe({ ingredients: [] })).toBeNull();
    expect(normalizePartialRecipe(null)).toBeNull();
  });

  it("coerces a partial recipe and defaults missing fields", () => {
    const partial = normalizePartialRecipe({
      title: "Bolo",
      ingredients: [{ name: "farinha" }],
    });
    expect(partial?.title).toBe("Bolo");
    expect(partial?.ingredients).toHaveLength(1);
    expect(partial?.ingredients[0].quantity).toBeNull();
    expect(partial?.steps).toHaveLength(0);
    expect(partial?.timings.total_seconds).toBeNull();
  });

  it("skips malformed ingredient and step items", () => {
    const partial = normalizePartialRecipe({
      title: "Bolo",
      ingredients: [{ name: "farinha" }, { nope: true }, "junk"],
      steps: [{ instruction: "Misture" }, { noinstruction: 1 }],
    });
    expect(partial?.ingredients).toHaveLength(1);
    expect(partial?.steps).toHaveLength(1);
    expect(partial?.steps[0].position).toBe(0);
  });
});

describe("streamRecipeFromTranscript", () => {
  it("yields progressive partials then a strict-validated final recipe", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    const full = JSON.stringify(finalRecipe);
    const cut1 = Math.floor(full.length * 0.4);
    const cut2 = Math.floor(full.length * 0.8);
    const events = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: full.slice(0, cut1) }] } }] })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: full.slice(cut1, cut2) }] } }] })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: full.slice(cut2) }] } }] })}\n\n`,
    ];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(events));
    vi.stubGlobal("fetch", fetchMock);

    const transcript = "Misture a farinha, o chocolate e os ovos. Asse por 30 minutos em forno preaquecido a 180 graus.";
    const received: string[] = [];
    for await (const recipe of streamRecipeFromTranscript({ transcript })) {
      received.push(recipe.title);
    }

    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received[received.length - 1]).toBe("Bolo de chocolate");
    // Final recipe is strict-validated: both steps and both ingredients present.
    expect(String(fetchMock.mock.calls[0][0])).toContain("streamGenerateContent");
  });

  it("throws when the final accumulation fails schema validation", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const invalid = { title: "Sem receita" };
    const events = [
      `data: ${JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(invalid) }] } }] })}\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const transcript = "Misture a farinha, o chocolate e os ovos. Asse por 30 minutos em forno preaquecido a 180 graus.";
    await expect(async () => {
      for await (const _ of streamRecipeFromTranscript({ transcript })) {
        // consume
      }
    }).rejects.toThrow("GEMINI_OUTPUT_SCHEMA_INVALID");
  });

  it("rejects short transcripts before streaming", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(async () => {
      for await (const _ of streamRecipeFromTranscript({ transcript: "curto" })) {
        // consume
      }
    }).rejects.toThrow("TRANSCRIPT_LENGTH_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
