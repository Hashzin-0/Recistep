import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { deleteGeminiFile, uploadMediaToGeminiFiles } from "./gemini-file-upload";
import { GeminiExtractionError } from "@/lib/providers/ai/gemini-error";

const BYTES = new Uint8Array([1, 2, 3, 4]);

function startResponse(uploadUrl: string | null = "https://upload.example/session"): Response {
  const headers = new Headers();
  if (uploadUrl) headers.set("x-goog-upload-url", uploadUrl);
  return new Response(JSON.stringify({ file: { name: "files/abc" } }), { status: 200, headers });
}

function fileResponse(state: string, overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    file: { name: "files/abc", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", state, ...overrides },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("uploadMediaToGeminiFiles", () => {
  it("uploads the bytes and polls until the file is ACTIVE", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(startResponse())
      .mockResolvedValueOnce(fileResponse("PROCESSING"))
      .mockResolvedValueOnce(fileResponse("ACTIVE", { mimeType: "video/mp4" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadMediaToGeminiFiles({
      bytes: BYTES,
      mimeType: "video/mp4",
      displayName: "tiktok-source.mp4",
      pollIntervalMs: 1,
    })).resolves.toEqual({
      fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      fileName: "files/abc",
      mimeType: "video/mp4",
    });

    const finalizeInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((finalizeInit.headers as Record<string, string>)["X-Goog-Upload-Command"]).toBe("upload, finalize");
    expect(fetchMock.mock.calls[2][0]).toBe("https://generativelanguage.googleapis.com/v1beta/files/abc");
  });

  it("rejects a FAILED file as a non-retryable processing failure", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(startResponse())
      .mockResolvedValueOnce(fileResponse("FAILED")));

    try {
      await uploadMediaToGeminiFiles({ bytes: BYTES, mimeType: "video/mp4", displayName: "x" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GeminiExtractionError);
      expect((error as GeminiExtractionError).message).toBe("GEMINI_FILE_PROCESSING_FAILED");
      expect((error as GeminiExtractionError).retryable).toBe(false);
    }
  });

  it("maps an authorization failure on upload to a non-retryable error", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403 })));

    try {
      await uploadMediaToGeminiFiles({ bytes: BYTES, mimeType: "video/mp4", displayName: "x" });
      expect.unreachable();
    } catch (error) {
      expect((error as GeminiExtractionError).message).toBe("GEMINI_AUTHENTICATION_FAILED");
      expect((error as GeminiExtractionError).retryable).toBe(false);
    }
  });

  it("treats a transient upload failure as retryable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(startResponse())
      .mockResolvedValueOnce(new Response("boom", { status: 503 })));

    try {
      await uploadMediaToGeminiFiles({ bytes: BYTES, mimeType: "video/mp4", displayName: "x" });
      expect.unreachable();
    } catch (error) {
      expect((error as GeminiExtractionError).message).toBe("GEMINI_FILE_UPLOAD_FAILED");
      expect((error as GeminiExtractionError).retryable).toBe(true);
    }
  });

  it("requires the API key before contacting the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadMediaToGeminiFiles({ bytes: BYTES, mimeType: "video/mp4", displayName: "x" }))
      .rejects.toThrow("GEMINI_NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deleteGeminiFile", () => {
  it("does nothing without an API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await deleteGeminiFile("files/abc");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("issues a best-effort DELETE request", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteGeminiFile("files/abc");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/files/abc",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
