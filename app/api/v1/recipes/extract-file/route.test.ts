import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  checkUserRateLimit: vi.fn(),
  extractRecipeFromUploadedFile: vi.fn(),
  extractLargestPdfImage: vi.fn(),
}));

vi.mock("@/lib/server/route-auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkUserRateLimit: mocks.checkUserRateLimit,
}));
vi.mock("@/lib/providers/ai/gemini-recipe-extractor", () => ({
  extractRecipeFromUploadedFile: mocks.extractRecipeFromUploadedFile,
  GeminiExtractionError: class GeminiExtractionError extends Error {
    retryable: boolean;
    constructor(message: string, retryable: boolean) {
      super(message);
      this.retryable = retryable;
    }
  },
}));
vi.mock("@/lib/recipe/pdf-image", () => ({
  extractLargestPdfImage: mocks.extractLargestPdfImage,
}));

import { POST } from "./route";

const validRecipe = {
  title: "Bolo simples",
  description: null,
  source_language: "pt-BR",
  servings: null,
  timings: { prep_seconds: null, cook_seconds: null, total_seconds: null },
  ingredients: [{ name: "farinha", section: "Ingredientes", quantity: null, quantity_text: null, quantity_min: null, quantity_max: null, unit: null, unit_normalized: null, notes: null, source_evidence: null, confidence: 0.8 }],
  steps: [{ position: 0, instruction: "Misture os ingredientes.", duration_seconds: null, duration_text: null, duration_min_seconds: null, duration_max_seconds: null, temperature_value: null, temperature_unit: null, source_evidence: null, confidence: 0.8 }],
  uncertainties: [],
  warnings: [],
};

function request(file?: File, locale = "pt-BR") {
  const form = new FormData();
  if (file) form.append("file", file);
  form.append("locale", locale);
  return new Request("http://localhost/api/v1/recipes/extract-file", {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ ok: true, user: { id: "user-123" } });
  mocks.checkUserRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.extractRecipeFromUploadedFile.mockResolvedValue(validRecipe);
  mocks.extractLargestPdfImage.mockReturnValue(null);
});

describe("POST /api/v1/recipes/extract-file", () => {
  it("extracts a draft from an authenticated PDF/image/video upload", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "recipe.png", { type: "image/png" });
    const response = await POST(request(file));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.title).toBe("Bolo simples");
    expect(mocks.extractRecipeFromUploadedFile).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "recipe.png",
      mimeType: "image/png",
      locale: "pt-BR",
    }));
  });

  it("returns the extracted PDF cover alongside the draft", async () => {
    mocks.extractLargestPdfImage.mockReturnValue({
      mimeType: "image/png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      width: 400,
      height: 300,
    });
    const file = new File([new Uint8Array([1, 2, 3])], "recipe.pdf", { type: "application/pdf" });
    const response = await POST(request(file));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cover).toEqual({ mime_type: "image/png", base64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64") });
    expect(mocks.extractLargestPdfImage).toHaveBeenCalledTimes(1);
  });

  it("does not attempt cover extraction for image uploads", async () => {
    const file = new File([new Uint8Array([1])], "recipe.png", { type: "image/png" });
    const response = await POST(request(file));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cover).toBeUndefined();
    expect(mocks.extractLargestPdfImage).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types without calling Gemini", async () => {
    const file = new File([new Uint8Array([1])], "script.exe", { type: "application/octet-stream" });
    const response = await POST(request(file));
    expect(response.status).toBe(415);
    expect(mocks.extractRecipeFromUploadedFile).not.toHaveBeenCalled();
  });

  it("rejects empty requests without a file", async () => {
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.extractRecipeFromUploadedFile).not.toHaveBeenCalled();
  });

  it("enforces the user rate limit before invoking Gemini", async () => {
    mocks.checkUserRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const file = new File([new Uint8Array([1])], "recipe.pdf", { type: "application/pdf" });
    const response = await POST(request(file));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("90");
    expect(mocks.extractRecipeFromUploadedFile).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 }),
    });
    const file = new File([new Uint8Array([1])], "recipe.pdf", { type: "application/pdf" });
    const response = await POST(request(file));
    expect(response.status).toBe(401);
    expect(mocks.checkUserRateLimit).not.toHaveBeenCalled();
  });
});
