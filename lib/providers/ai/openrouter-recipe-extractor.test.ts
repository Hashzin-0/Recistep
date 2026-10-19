import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  generateStructuredRecipeViaOpenRouter,
  streamStructuredRecipeViaOpenRouter,
  toOpenRouterContent,
} from "./openrouter-recipe-extractor";
import { GeminiExtractionError } from "./gemini-error";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const validRecipe = {
  title: "Bolo de chocolate",
  description: null,
  source_language: "pt-BR",
  servings: 8,
  timings: { prep_seconds: 900, cook_seconds: 1800, total_seconds: 2700 },
  ingredients: [
    { name: "farinha", quantity: 2, quantity_text: "2 xícaras", quantity_min: null, quantity_max: null, unit: "xícara", unit_normalized: "xícara", notes: null, source_evidence: null, confidence: 0.9 },
  ],
  steps: [
    { position: 0, instruction: "Misture tudo e asse.", duration_seconds: 1800, duration_text: "30 minutos", duration_min_seconds: null, duration_max_seconds: null, temperature_value: 180, temperature_unit: "C", source_evidence: null, confidence: 0.9 },
  ],
  uncertainties: [],
  warnings: [],
};

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

describe("toOpenRouterContent", () => {
  it("maps text and every inline modality", () => {
    const content = toOpenRouterContent([
      { text: "extraia" },
      { inline_data: { mime_type: "image/png", data: "aW1n" } },
      { inline_data: { mime_type: "video/mp4", data: "dmlk" } },
      { inline_data: { mime_type: "audio/mpeg", data: "YXVk" } },
      { inline_data: { mime_type: "application/pdf", data: "cGRm" } },
    ]);

    expect(content).toEqual([
      { type: "text", text: "extraia" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1n" } },
      { type: "video_url", video_url: { url: "data:video/mp4;base64,dmlk" } },
      { type: "input_audio", input_audio: { data: "YXVk", format: "mp3" } },
      { type: "file", file: { file_data: "data:application/pdf;base64,cGRm" } },
    ]);
  });

  it("maps a public YouTube URL to a video part", () => {
    expect(toOpenRouterContent([
      { text: "extraia" },
      { file_data: { file_uri: "https://www.youtube.com/watch?v=abc" } },
    ])).toEqual([
      { type: "text", text: "extraia" },
      { type: "video_url", video_url: { url: "https://www.youtube.com/watch?v=abc" } },
    ]);
  });

  it("returns null for a Gemini Files URI that cannot be reused", () => {
    expect(toOpenRouterContent([
      { file_data: { file_uri: "https://generativelanguage.googleapis.com/v1beta/files/abc" } },
    ])).toBeNull();
  });

  it("returns null for an unsupported inline MIME type", () => {
    expect(toOpenRouterContent([
      { inline_data: { mime_type: "application/zip", data: "emlw" } },
    ])).toBeNull();
  });
});

describe("generateStructuredRecipeViaOpenRouter", () => {
  it("sends a json_schema request and validates the recipe", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "meta-llama/llama-free",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validRecipe) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const recipe = await generateStructuredRecipeViaOpenRouter([{ text: "extraia" }]);

    expect(recipe.title).toBe("Bolo de chocolate");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer or-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("openrouter/free");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toEqual([{ type: "text", text: "extraia" }]);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("meta-llama/llama-free"));
  });

  it("classifies authentication failures as non-retryable", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "bad-key");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "invalid key" },
    }), { status: 401, headers: { "Content-Type": "application/json" } })));

    await expect(generateStructuredRecipeViaOpenRouter([{ text: "extraia" }]))
      .rejects.toMatchObject({ message: "OPENROUTER_AUTHENTICATION_FAILED", retryable: false });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("throws when no key is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(generateStructuredRecipeViaOpenRouter([{ text: "extraia" }]))
      .rejects.toBeInstanceOf(GeminiExtractionError);
  });

  it("rejects an unmappable payload before calling the provider", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateStructuredRecipeViaOpenRouter([
      { file_data: { file_uri: "https://generativelanguage.googleapis.com/v1beta/files/abc" } },
    ])).rejects.toThrow("OPENROUTER_UNSUPPORTED_INPUT");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("streamStructuredRecipeViaOpenRouter", () => {
  it("yields partials then the strict-validated recipe, skipping SSE comments", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const full = JSON.stringify(validRecipe);
    const cut = Math.floor(full.length * 0.6);
    const events = [
      ": OPENROUTER PROCESSING\n\n",
      `data: ${JSON.stringify({ model: "free-model", choices: [{ delta: { content: full.slice(0, cut) } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: full.slice(cut) } }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(events));
    vi.stubGlobal("fetch", fetchMock);

    const received: string[] = [];
    for await (const recipe of streamStructuredRecipeViaOpenRouter([{ text: "extraia" }])) {
      received.push(recipe.title);
    }

    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received[received.length - 1]).toBe("Bolo de chocolate");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("free-model"));
  });

  it("throws an empty-response error when the stream has no content", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n\n"])));

    await expect(async () => {
      for await (const _ of streamStructuredRecipeViaOpenRouter([{ text: "extraia" }])) {
        // consume
      }
    }).rejects.toThrow("OPENROUTER_EMPTY_RESPONSE");
  });

  it("surfaces a mid-stream provider error", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
      `data: ${JSON.stringify({ error: { message: "upstream overloaded" } })}\n\n`,
    ])));

    await expect(async () => {
      for await (const _ of streamStructuredRecipeViaOpenRouter([{ text: "extraia" }])) {
        // consume
      }
    }).rejects.toThrow("OPENROUTER_TEMPORARY_FAILURE");
    expect(errorSpy).toHaveBeenCalled();
  });
});
