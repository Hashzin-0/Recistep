import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  EXTERNAL_MEDIA_MAX_BYTES,
  probeExternalMedia,
} from "./remote-video";

afterEach(() => {
  vi.unstubAllGlobals();
});

const CDN_URL = "https://v16-sign.tiktokcdn.com/video.mp4";
const isAllowedHost = (hostname: string) => hostname.endsWith("tiktokcdn.com");

describe("probeExternalMedia", () => {
  it("returns the total size from a range response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 206,
      headers: { "Content-Range": "bytes 0-0/1048576" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      probeExternalMedia({ mediaUrl: CDN_URL, isAllowedHost, referer: "https://www.tiktok.com/" }),
    ).resolves.toEqual({ contentLength: 1_048_576 });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-0");
    expect((init.headers as Record<string, string>).Referer).toBe("https://www.tiktok.com/");
  });

  it("accepts a file exactly at the provider limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 206,
      headers: { "Content-Range": `bytes 0-0/${EXTERNAL_MEDIA_MAX_BYTES}` },
    })));

    await expect(
      probeExternalMedia({ mediaUrl: CDN_URL, isAllowedHost, referer: "https://www.tiktok.com/" }),
    ).resolves.toEqual({ contentLength: EXTERNAL_MEDIA_MAX_BYTES });
  });

  it("rejects files larger than the provider limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 206,
      headers: { "Content-Range": `bytes 0-0/${EXTERNAL_MEDIA_MAX_BYTES + 1}` },
    })));

    await expect(
      probeExternalMedia({ mediaUrl: CDN_URL, isAllowedHost, referer: "https://www.tiktok.com/" }),
    ).rejects.toThrow("SOURCE_MEDIA_TOO_LARGE");
  });

  it("rejects a host outside the allowlist before any network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      probeExternalMedia({
        mediaUrl: "https://attacker.example/video.mp4",
        isAllowedHost,
        referer: "https://www.tiktok.com/",
      }),
    ).rejects.toThrow("SOURCE_MEDIA_URL_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies an unreachable media URL separately from a transient outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 403 })));
    await expect(
      probeExternalMedia({ mediaUrl: CDN_URL, isAllowedHost, referer: "https://www.tiktok.com/" }),
    ).rejects.toThrow("SOURCE_MEDIA_UNAVAILABLE");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 503 })));
    await expect(
      probeExternalMedia({ mediaUrl: CDN_URL, isAllowedHost, referer: "https://www.tiktok.com/" }),
    ).rejects.toThrow("SOURCE_PROVIDER_TEMPORARY_FAILURE");
  });

  it("follows redirects only while the destination stays allowlisted", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: "https://attacker.example/steal" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      probeExternalMedia({ mediaUrl: CDN_URL, isAllowedHost, referer: "https://www.tiktok.com/" }),
    ).rejects.toThrow("SOURCE_MEDIA_URL_INVALID");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a missing size as unknown rather than rejecting the media", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(
      probeExternalMedia({ mediaUrl: CDN_URL, isAllowedHost, referer: "https://www.tiktok.com/" }),
    ).resolves.toEqual({ contentLength: null });
  });
});
