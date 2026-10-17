import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    createFunction: (_config: unknown, handler: unknown) => handler,
  },
}));

vi.mock("@/lib/server/supabase-rest", () => ({
  getSourceImport: vi.fn(),
  updateSourceImport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/server/recipe-cache", () => ({
  findCachedRecipeByTitle: vi.fn().mockResolvedValue(null),
  persistRecipeCache: vi.fn().mockResolvedValue(undefined),
  fingerprintRecipe: vi.fn().mockReturnValue("fingerprint"),
  hashSourceUrl: vi.fn().mockReturnValue("url-hash"),
}));

vi.mock("@/lib/providers/sources/registry", () => ({
  getSourceConnector: vi.fn(),
}));

vi.mock("@/lib/providers/media/public-subtitles", () => ({
  fetchPublicSubtitlesText: vi.fn(),
}));

vi.mock("@/lib/providers/ai/gemini-recipe-extractor", () => {
  class GeminiExtractionError extends Error {
    constructor(
      message: string,
      readonly retryable: boolean,
    ) {
      super(message);
      this.name = "GeminiExtractionError";
    }
  }

  return {
    GeminiExtractionError,
    streamRecipeFromMediaUrl: vi.fn(),
    streamRecipeFromTranscript: vi.fn(),
    extractRecipeFromMediaUrl: vi.fn(),
    extractRecipeFromTranscript: vi.fn(),
  };
});

import { processImportRequested } from "./functions";
import { getSourceImport, updateSourceImport } from "@/lib/server/supabase-rest";
import { getSourceConnector } from "@/lib/providers/sources/registry";
import { streamRecipeFromMediaUrl, streamRecipeFromTranscript } from "@/lib/providers/ai/gemini-recipe-extractor";
import { fetchPublicSubtitlesText } from "@/lib/providers/media/public-subtitles";
import type { SourceConnector, ResolvedSource } from "@/lib/providers/sources/source-connector";

const IMPORT_ID = "11111111-2222-4333-8444-555555555555";
const USER_ID = "99999999-8888-4777-8666-555555555555";

type HandlerArgs = {
  event: { data: Record<string, unknown> };
  step: { run: <T>(name: string, callback: () => Promise<T> | T) => Promise<T> };
};

const handler = processImportRequested as unknown as (args: HandlerArgs) => Promise<unknown>;

const immediateStep = {
  run: async <T,>(_name: string, callback: () => Promise<T> | T): Promise<T> => callback(),
};

function sourceImport(overrides: Record<string, unknown> = {}) {
  return {
    id: IMPORT_ID,
    user_id: USER_ID,
    source_url: "https://www.tiktok.com/@cook/video/123",
    platform: "tiktok",
    locale: "pt-BR",
    servings_target: null,
    idempotency_key: "key-1",
    status: "queued",
    source_url_hash: null,
    source_content_hash: null,
    recipe_fingerprint: null,
    source_metadata: null,
    source_transcript: null,
    recipe_draft: null,
    error_code: null,
    error_message: null,
    attempt_count: 0,
    created_at: "2026-10-17T00:00:00.000Z",
    updated_at: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
}

function resolvedSource(content: ResolvedSource["content"]): ResolvedSource {
  return {
    metadata: {
      title: "Bolo de cenoura",
      author_name: "Ana",
      provider_name: "TikTok",
      thumbnail_url: null,
    },
    content,
  };
}

function stubConnector(resolve: () => Promise<ResolvedSource>): SourceConnector {
  const connector: SourceConnector = { platform: "tiktok", resolve: vi.fn(resolve) };
  vi.mocked(getSourceConnector).mockReturnValue(connector);
  return connector;
}

function stubStream(draft: unknown) {
  vi.mocked(streamRecipeFromMediaUrl).mockImplementation(async function* () {
    yield draft as never;
  });
}

function stubTextStream(draft: unknown) {
  vi.mocked(streamRecipeFromTranscript).mockImplementation(async function* () {
    yield draft as never;
  });
}

function persistedPatches(): Array<Record<string, unknown>> {
  return vi.mocked(updateSourceImport).mock.calls.map(([, patch]) => patch as Record<string, unknown>);
}

beforeEach(() => {
  vi.mocked(getSourceImport).mockResolvedValue(sourceImport() as never);
  vi.mocked(updateSourceImport).mockClear();
  vi.mocked(streamRecipeFromMediaUrl).mockReset();
  vi.mocked(streamRecipeFromTranscript).mockReset();
  vi.mocked(fetchPublicSubtitlesText).mockReset();
});

describe("processImportRequested", () => {
  it("streams a recipe from the media resolved by the platform connector", async () => {
    const draft = { title: "Bolo de cenoura" };
    stubConnector(async () => resolvedSource({
      kind: "external_media",
      mediaUrl: "https://v16-sign.tiktokcdn.com/video/play/abc.mp4",
      mimeType: "video/mp4",
    }));
    stubStream(draft);

    const result = await handler({
      event: { data: { id: IMPORT_ID } },
      step: immediateStep,
    });

    expect(result).toMatchObject({ id: IMPORT_ID, status: "review_required" });
    expect(streamRecipeFromMediaUrl).toHaveBeenCalledWith({
      mediaUrl: "https://v16-sign.tiktokcdn.com/video/play/abc.mp4",
      platform: "tiktok",
      mimeType: "video/mp4",
      locale: "pt-BR",
      sourceTitle: "Bolo de cenoura",
    });

    const review = persistedPatches().find((patch) => patch.status === "review_required");
    expect(review).toMatchObject({ recipe_draft: draft });
  });

  it("asks for an authorized transcript instead of pretending to succeed without media", async () => {
    stubConnector(async () => resolvedSource({
      kind: "transcript_required",
      code: "SOURCE_MEDIA_TOO_LARGE",
      reason: "Vídeo acima do limite permitido. Envie uma transcrição autorizada para continuar.",
    }));

    const result = await handler({
      event: { data: { id: IMPORT_ID } },
      step: immediateStep,
    });

    expect(result).toMatchObject({ id: IMPORT_ID, status: "source_content_required" });
    expect(streamRecipeFromMediaUrl).not.toHaveBeenCalled();

    const last = persistedPatches().at(-1);
    expect(last).toMatchObject({
      status: "source_content_required",
      error_code: "SOURCE_MEDIA_TOO_LARGE",
    });
    expect(last?.error_message).toContain("transcrição autorizada");
  });

  it("keeps the public metadata when the content cannot be acquired", async () => {
    stubConnector(async () => resolvedSource({
      kind: "transcript_required",
      code: "SOURCE_MEDIA_NOT_AVAILABLE",
      reason: "Este post não é um vídeo.",
    }));

    await handler({ event: { data: { id: IMPORT_ID } }, step: immediateStep });

    expect(persistedPatches().some((patch) =>
      (patch.source_metadata as { title?: string } | null)?.title === "Bolo de cenoura",
    )).toBe(true);
    expect(streamRecipeFromMediaUrl).not.toHaveBeenCalled();
  });

  it("reports a metadata failure as an explicit content requirement", async () => {
    stubConnector(async () => {
      throw new Error("SOURCE_METADATA_UNAVAILABLE");
    });

    const result = await handler({ event: { data: { id: IMPORT_ID } }, step: immediateStep });

    expect(result).toMatchObject({ id: IMPORT_ID, status: "source_content_required" });
    expect(persistedPatches().at(-1)).toMatchObject({ error_code: "SOURCE_METADATA_UNAVAILABLE" });
  });

  it("rethrows transient connector failures so the workflow retries", async () => {
    stubConnector(async () => {
      throw new Error("SOURCE_PROVIDER_TEMPORARY_FAILURE");
    });

    await expect(
      handler({ event: { data: { id: IMPORT_ID } }, step: immediateStep }),
    ).rejects.toThrow("SOURCE_PROVIDER_TEMPORARY_FAILURE");
    expect(persistedPatches().some((patch) => patch.status === "failed")).toBe(false);
  });

  it("extracts from the public caption exposed by the connector", async () => {
    const draft = { title: "Bolo de cenoura" };
    const caption = "Bolo de cenoura: 3 cenouras, 4 ovos, óleo, açúcar e farinha. Bata, asse e sirva.".padEnd(90, " ");
    stubConnector(async () => resolvedSource({ kind: "public_text", text: caption }));
    stubTextStream(draft);

    const result = await handler({ event: { data: { id: IMPORT_ID } }, step: immediateStep });

    expect(result).toMatchObject({ id: IMPORT_ID, status: "review_required" });
    expect(streamRecipeFromTranscript).toHaveBeenCalledWith({
      transcript: caption,
      locale: "pt-BR",
      sourceTitle: "Bolo de cenoura",
    });
    expect(streamRecipeFromMediaUrl).not.toHaveBeenCalled();
    expect(persistedPatches().find((patch) => patch.status === "review_required")).toMatchObject({ recipe_draft: draft });
  });

  it("downloads the public subtitle track outside the steps and extracts from it", async () => {
    const draft = { title: "Bolo de chocolate" };
    stubConnector(async () => resolvedSource({
      kind: "external_subtitles",
      url: "https://v16m-webapp.tiktokcdn-us.com/sub.vtt",
      mimeType: "text/vtt",
    }));
    vi.mocked(fetchPublicSubtitlesText).mockResolvedValue("Adicione a farinha e mexa bem até ficar homogêneo.".padEnd(90, " "));
    stubTextStream(draft);

    const result = await handler({ event: { data: { id: IMPORT_ID } }, step: immediateStep });

    expect(result).toMatchObject({ id: IMPORT_ID, status: "review_required" });
    expect(fetchPublicSubtitlesText).toHaveBeenCalledWith({
      url: "https://v16m-webapp.tiktokcdn-us.com/sub.vtt",
      platform: "tiktok",
    });
    expect(streamRecipeFromTranscript).toHaveBeenCalled();
  });

  it("asks for a transcript when the public subtitle track is unavailable", async () => {
    stubConnector(async () => resolvedSource({
      kind: "external_subtitles",
      url: "https://v16m-webapp.tiktokcdn-us.com/sub.vtt",
      mimeType: "text/vtt",
    }));
    vi.mocked(fetchPublicSubtitlesText).mockRejectedValue(new Error("SOURCE_PROVIDER_TEMPORARY_FAILURE"));

    const result = await handler({ event: { data: { id: IMPORT_ID } }, step: immediateStep });

    expect(result).toMatchObject({ id: IMPORT_ID, status: "source_content_required" });
    expect(streamRecipeFromTranscript).not.toHaveBeenCalled();
    expect(persistedPatches().at(-1)).toMatchObject({
      status: "source_content_required",
      error_code: "SOURCE_MEDIA_UNAVAILABLE",
    });
  });

  it("fails with an explicit code when the source cannot be analyzed at all", async () => {
    stubConnector(async () => resolvedSource({
      kind: "unsupported_content",
      code: "SOURCE_NOT_ANALYZABLE",
      reason: "Não foi possível analisar este link do Instagram.",
    }));

    const result = await handler({ event: { data: { id: IMPORT_ID } }, step: immediateStep });

    expect(result).toMatchObject({ id: IMPORT_ID, status: "failed" });
    expect(streamRecipeFromTranscript).not.toHaveBeenCalled();
    expect(streamRecipeFromMediaUrl).not.toHaveBeenCalled();
    expect(persistedPatches().at(-1)).toMatchObject({
      status: "failed",
      error_code: "SOURCE_NOT_ANALYZABLE",
      error_message: "Não foi possível analisar este link do Instagram.",
    });
  });

  it("does not run any work when the import is no longer queued", async () => {
    vi.mocked(getSourceImport).mockResolvedValue(sourceImport({ status: "completed" }) as never);
    const connector = stubConnector(async () =>
      resolvedSource({ kind: "youtube_url", mediaUrl: "https://youtu.be/x" }));

    const result = await handler({ event: { data: { id: IMPORT_ID } }, step: immediateStep });

    expect(result).toMatchObject({ status: "completed", skipped: true });
    expect(connector.resolve).not.toHaveBeenCalled();
  });
});
