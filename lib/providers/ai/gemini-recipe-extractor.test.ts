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
  it("sends a platform CDN URL to Gemini with its mime type", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(validRecipe) }] },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractRecipeFromMediaUrl({
      mediaUrl: "https://v16-sign.tiktokcdn.com/video/play/abc.mp4",
      platform: "tiktok",
      mimeType: "video/mp4",
      locale: "pt-BR",
      sourceTitle: "Bolo do TikTok",
    });

    expect(result.title).toBe("Massa simples");
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.contents[0].parts[1].file_data).toEqual({
      file_uri: "https://v16-sign.tiktokcdn.com/video/play/abc.mp4",
      mime_type: "video/mp4",
    });
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
