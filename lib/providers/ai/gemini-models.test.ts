import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GEMINI_MODELS, resolveGeminiModels } from "./gemini-models";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveGeminiModels", () => {
  it("uses GEMINI_MODEL when no list is configured", () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-custom");
    vi.stubEnv("GEMINI_MODELS", "");
    expect(resolveGeminiModels()).toEqual(["gemini-custom"]);
  });

  it("falls back to the built-in default model list", () => {
    vi.stubEnv("GEMINI_MODEL", "");
    vi.stubEnv("GEMINI_MODELS", "");
    expect(resolveGeminiModels()).toEqual([...DEFAULT_GEMINI_MODELS]);
  });

  it("parses, trims, and deduplicates the ordered list", () => {
    vi.stubEnv("GEMINI_MODELS", " gemini-a , gemini-b,gemini-a, ");
    expect(resolveGeminiModels()).toEqual(["gemini-a", "gemini-b"]);
  });

  it("ignores an empty configured list", () => {
    vi.stubEnv("GEMINI_MODELS", " , ");
    vi.stubEnv("GEMINI_MODEL", "gemini-single");
    expect(resolveGeminiModels()).toEqual(["gemini-single"]);
  });
});
