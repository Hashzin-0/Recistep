import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sdkMocks = vi.hoisted(() => ({
  assetCreate: vi.fn(),
  assetRetrieve: vi.fn(),
  assetDelete: vi.fn(),
  analyze: vi.fn(),
}));

vi.mock("twelvelabs-js", () => ({
  TwelveLabs: vi.fn(function TwelveLabsMock() {
    return {
      assets: {
        create: sdkMocks.assetCreate,
        retrieve: sdkMocks.assetRetrieve,
        delete: sdkMocks.assetDelete,
      },
      analyze: sdkMocks.analyze,
    };
  }),
}));

import { analyzeInstagramRecipeVideo, isTwelveLabsConfigured } from "./twelvelabs-instagram-analyzer";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("TwelveLabs Instagram analyzer", () => {
  it("analyzes the public video and deletes the temporary asset", async () => {
    const analysis = "A receita começa com farinha, ovos e leite. A pessoa mistura tudo e assa por 35 minutos.".padEnd(100, " ");
    vi.stubEnv("TWELVELABS_API_KEY", "test-api-key");
    sdkMocks.assetCreate.mockResolvedValue({ id: "asset-123", status: "ready" });
    sdkMocks.analyze.mockResolvedValue({ data: analysis });
    sdkMocks.assetDelete.mockResolvedValue(undefined);

    await expect(analyzeInstagramRecipeVideo("https://scontent.cdninstagram.com/v/reel.mp4"))
      .resolves.toBe(analysis.trim());

    expect(sdkMocks.assetCreate).toHaveBeenCalledWith({
      method: "url",
      url: "https://scontent.cdninstagram.com/v/reel.mp4",
    });
    expect(sdkMocks.analyze).toHaveBeenCalledWith(expect.objectContaining({
      modelName: "pegasus1.5",
      video: { type: "asset_id", assetId: "asset-123" },
    }));
    expect(sdkMocks.assetDelete).toHaveBeenCalledWith("asset-123");
  });

  it("rejects media URLs outside the Instagram CDN allowlist", async () => {
    vi.stubEnv("TWELVELABS_API_KEY", "test-api-key");

    await expect(analyzeInstagramRecipeVideo("https://attacker.example/reel.mp4"))
      .rejects.toThrow("TWELVELABS_INVALID_MEDIA_URL");
    expect(sdkMocks.assetCreate).not.toHaveBeenCalled();
  });

  it("reports whether the server-side API key is configured", () => {
    vi.stubEnv("TWELVELABS_API_KEY", "test-api-key");
    expect(isTwelveLabsConfigured()).toBe(true);

    vi.stubEnv("TWELVELABS_API_KEY", "");
    expect(isTwelveLabsConfigured()).toBe(false);
  });
});
