import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { fetchPublicSubtitlesText } from "./public-subtitles";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SUBTITLE_URL = "https://v16m-webapp.tiktokcdn-us.com/sub/play.vtt";

describe("fetchPublicSubtitlesText", () => {
  it("downloads and converts an allowlisted caption track", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nAdicione a farinha e mexa bem",
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPublicSubtitlesText({ url: SUBTITLE_URL, platform: "tiktok" }))
      .resolves.toBe("Adicione a farinha e mexa bem");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Referer).toBe("https://www.tiktok.com/");
  });

  it("refuses a caption track outside the platform media hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPublicSubtitlesText({ url: "https://attacker.example/sub.vtt", platform: "tiktok" }))
      .rejects.toThrow("SOURCE_LOCATION_NOT_ALLOWED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
