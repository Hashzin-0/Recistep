import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  checkUserRateLimit: vi.fn(),
  extractRecipeFromTranscript: vi.fn(),
}));

vi.mock("@/lib/server/route-auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkUserRateLimit: mocks.checkUserRateLimit,
}));
vi.mock("@/lib/providers/ai/gemini-recipe-extractor", () => ({
  extractRecipeFromTranscript: mocks.extractRecipeFromTranscript,
  GeminiExtractionError: class GeminiExtractionError extends Error {
    retryable: boolean;
    constructor(message: string, retryable: boolean) {
      super(message);
      this.retryable = retryable;
    }
  },
}));

import { POST } from "./route";

const validRecipe = {
  title: "Bolo simples",
  description: null,
  source_language: "pt-BR",
  servings: null,
  timings: { prep_seconds: null, cook_seconds: null, total_seconds: null },
  ingredients: [{ name: "farinha", quantity: null, quantity_text: null, quantity_min: null, quantity_max: null, unit: null, unit_normalized: null, notes: null, source_evidence: null, confidence: 0.8 }],
  steps: [{ position: 0, instruction: "Misture os ingredientes.", duration_seconds: null, duration_text: null, duration_min_seconds: null, duration_max_seconds: null, temperature_value: null, temperature_unit: null, source_evidence: null, confidence: 0.8 }],
  uncertainties: ["Quantidade não informada."],
  warnings: [],
};

function request(payload: unknown) {
  return new Request("http://localhost/api/v1/recipes/extract-transcript", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ ok: true, user: { id: "user-123" } });
  mocks.checkUserRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.extractRecipeFromTranscript.mockResolvedValue(validRecipe);
});

describe("POST /api/v1/recipes/extract-transcript", () => {
  it("rejects short transcripts without calling Gemini", async () => {
    const response = await POST(request({ transcript: "Texto curto" }));
    expect(response.status).toBe(400);
    expect(mocks.extractRecipeFromTranscript).not.toHaveBeenCalled();
  });

  it("returns a validated recipe draft for an authenticated user", async () => {
    const transcript = "Prepare uma massa com farinha, leite e ovos. Misture tudo até ficar homogêneo e cozinhe até terminar.";
    const response = await POST(request({ transcript }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.title).toBe("Bolo simples");
    expect(mocks.extractRecipeFromTranscript).toHaveBeenCalledWith({ transcript, locale: "pt-BR" });
  });

  it("enforces the user rate limit before invoking Gemini", async () => {
    mocks.checkUserRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
    const response = await POST(request({ transcript: "Prepare uma massa com farinha, leite e ovos. Misture tudo até ficar homogêneo e cozinhe até terminar." }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(mocks.extractRecipeFromTranscript).not.toHaveBeenCalled();
  });

  it("does not process requests without authentication", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 }),
    });
    const response = await POST(request({ transcript: "Prepare uma massa com farinha, leite e ovos. Misture tudo até ficar homogêneo e cozinhe até terminar." }));
    expect(response.status).toBe(401);
    expect(mocks.checkUserRateLimit).not.toHaveBeenCalled();
  });
});
