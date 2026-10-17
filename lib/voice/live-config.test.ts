import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIVE_MODEL_ID,
  DEFAULT_LIVE_TOKEN_TTL_MINUTES,
  DEFAULT_LIVE_VOICE_NAME,
  LIVE_WS_BASE_URL,
  isLiveConfigured,
  liveModelId,
  liveTokenTtlMinutes,
  liveVoiceName,
  toLiveModelResource,
} from "./live-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("live model configuration", () => {
  it("defaults to the extended-thinking live model", () => {
    vi.stubEnv("GEMINI_LIVE_MODEL", "");
    expect(DEFAULT_LIVE_MODEL_ID).toBe("gemini-3.8-live-extended-thinking");
    expect(liveModelId()).toBe("gemini-3.8-live-extended-thinking");
  });

  it("reads the model from the environment when set", () => {
    vi.stubEnv("GEMINI_LIVE_MODEL", "  gemini-3.8-live  ");
    expect(liveModelId()).toBe("gemini-3.8-live");
  });

  it("keeps a default voice and accepts an override", () => {
    vi.stubEnv("GEMINI_LIVE_VOICE", "");
    expect(liveVoiceName()).toBe(DEFAULT_LIVE_VOICE_NAME);
    vi.stubEnv("GEMINI_LIVE_VOICE", "Kore");
    expect(liveVoiceName()).toBe("Kore");
  });

  it("always exposes a secure websocket endpoint", () => {
    expect(LIVE_WS_BASE_URL.startsWith("wss://")).toBe(true);
  });

  it("adds the models/ resource prefix exactly once", () => {
    expect(toLiveModelResource("gemini-3.8-live-extended-thinking")).toBe("models/gemini-3.8-live-extended-thinking");
    expect(toLiveModelResource(" models/gemini-3.8-live ")).toBe("models/gemini-3.8-live");
  });
});

describe("live token configuration", () => {
  it("falls back to 30 minutes for missing or invalid ttl", () => {
    vi.stubEnv("GEMINI_LIVE_TOKEN_TTL_MINUTES", "");
    expect(liveTokenTtlMinutes()).toBe(DEFAULT_LIVE_TOKEN_TTL_MINUTES);

    vi.stubEnv("GEMINI_LIVE_TOKEN_TTL_MINUTES", "abc");
    expect(liveTokenTtlMinutes()).toBe(DEFAULT_LIVE_TOKEN_TTL_MINUTES);

    vi.stubEnv("GEMINI_LIVE_TOKEN_TTL_MINUTES", "-5");
    expect(liveTokenTtlMinutes()).toBe(DEFAULT_LIVE_TOKEN_TTL_MINUTES);
  });

  it("clamps the ttl between one and thirty minutes", () => {
    vi.stubEnv("GEMINI_LIVE_TOKEN_TTL_MINUTES", "5");
    expect(liveTokenTtlMinutes()).toBe(5);

    vi.stubEnv("GEMINI_LIVE_TOKEN_TTL_MINUTES", "120");
    expect(liveTokenTtlMinutes()).toBe(30);

    vi.stubEnv("GEMINI_LIVE_TOKEN_TTL_MINUTES", "0.4");
    expect(liveTokenTtlMinutes()).toBe(1);
  });

  it("reports whether the Gemini API key is available", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(isLiveConfigured()).toBe(false);
    vi.stubEnv("GEMINI_API_KEY", "  key  ");
    expect(isLiveConfigured()).toBe(true);
  });
});
