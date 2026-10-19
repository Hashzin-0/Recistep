import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  extractRecipeFromTranscript,
  extractRecipeFromYouTubeUrl,
  extractRecipeFromMediaUrl,
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

  it("passes a public YouTube URL to Gemini as video input", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(validRecipe) }] },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractRecipeFromYouTubeUrl({
      sourceUrl: "https://www.youtube.com/watch?v=public123",
      locale: "pt-BR",
      sourceTitle: "Receita pública",
    });

    expect(result.title).toBe("Massa simples");
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.contents[0].parts[1].file_data.file_uri)
      .toBe("https://www.youtube.com/watch?v=public123");
  });

  it("rejects non-YouTube URLs before sending them to Gemini", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractRecipeFromYouTubeUrl({
      sourceUrl: "https://attacker.example/video",
    })).rejects.toThrow("UNSUPPORTED_SOURCE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed model output rather than returning an unvalidated recipe", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODELS", "gemini-test");
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

describe("extractRecipeFromMediaUrl", () => {
  it("downloads and uploads the media, then points Gemini at the uploaded file", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("https://v16-sign.tiktokcdn.com")) {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "video/mp4" } });
      }
      if (url.includes("/upload/v1beta/files")) {
        return new Response(JSON.stringify({ file: { name: "files/abc" } }), {
          status: 200,
          headers: { "x-goog-upload-url": "https://upload.example/session" },
        });
      }
      if (url === "https://upload.example/session") {
        return new Response(JSON.stringify({
          file: {
            name: "files/abc",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
            state: "ACTIVE",
            mimeType: "video/mp4",
          },
        }), { status: 200 });
      }
      if (url.includes(":generateContent")) {
        return new Response(JSON.stringify({
          candidates: [{
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(validRecipe) }] },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractRecipeFromMediaUrl({
      mediaUrl: "https://v16-sign.tiktokcdn.com/video/play/abc.mp4",
      platform: "tiktok",
      mimeType: "video/mp4",
      locale: "pt-BR",
      sourceTitle: "Bolo do TikTok",
    });

    expect(result.title).toBe("Massa simples");
    const generateCall = fetchMock.mock.calls.find((call) => String(call[0]).includes(":generateContent"));
    expect(generateCall).toBeDefined();
    const requestBody = JSON.parse((generateCall?.[1] as RequestInit).body as string);
    expect(requestBody.contents[0].parts[1].file_data).toEqual({
      file_uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      mime_type: "video/mp4",
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://v16-sign.tiktokcdn.com/video/play/abc.mp4");
  });

  it("rejects a media URL that does not belong to the platform", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractRecipeFromMediaUrl({
      mediaUrl: "https://scontent.cdninstagram.com/v/reel.mp4",
      platform: "tiktok",
      mimeType: "video/mp4",
    })).rejects.toThrow("UNSUPPORTED_SOURCE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-HTTPS media URL before any provider request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractRecipeFromMediaUrl({
      mediaUrl: "http://v16-sign.tiktokcdn.com/video.mp4",
      platform: "tiktok",
      mimeType: "video/mp4",
    })).rejects.toBeInstanceOf(GeminiExtractionError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Gemini model fallback", () => {
  function geminiOk() {
    return new Response(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(validRecipe) }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  function openRouterOk() {
    return new Response(JSON.stringify({
      model: "free-model",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validRecipe) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  it("tries the next Gemini model when the first one is unavailable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODELS", "gemini-a,gemini-b");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      if (String(input).includes("gemini-a")) {
        return new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 });
      }
      return geminiOk();
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractRecipeFromTranscript({ transcript });

    expect(result.title).toBe("Massa simples");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-a");
    expect(String(fetchMock.mock.calls[1][0])).toContain("gemini-b");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to OpenRouter when every Gemini model fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODELS", "gemini-a");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      if (String(input).includes("openrouter.ai")) return openRouterOk();
      return new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractRecipeFromTranscript({ transcript });

    expect(result.title).toBe("Massa simples");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer or-key" });
  });

  it("rethrows the last Gemini error when OpenRouter is not configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODELS", "gemini-a,gemini-b");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractRecipeFromTranscript({ transcript }))
      .rejects.toMatchObject({ message: "GEMINI_TEMPORARY_FAILURE", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
