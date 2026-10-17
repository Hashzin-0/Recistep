import "server-only";
import { inngest } from "@/lib/inngest/client";
import { findCachedRecipeByTitle, fingerprintRecipe, hashSourceUrl, persistRecipeCache } from "@/lib/server/recipe-cache";
import {
  getSourceImport,
  updateSourceImport,
} from "@/lib/server/supabase-rest";
import { getSourceConnector } from "@/lib/providers/sources/registry";
import {
  isMediaContent,
  isUnsupportedContent,
  MIN_PUBLIC_TEXT_LENGTH,
  type MediaContent,
  type ResolvedSource,
} from "@/lib/providers/sources/source-connector";
import { fetchPublicSubtitlesText } from "@/lib/providers/media/public-subtitles";
import {
  streamRecipeFromTranscript,
  streamRecipeFromMediaUrl,
  GeminiExtractionError,
} from "@/lib/providers/ai/gemini-recipe-extractor";
import { streamExtractToImport } from "@/lib/providers/ai/stream-extractor";

export const processImportRequested = inngest.createFunction(
  {
    id: "recistep-process-source-import",
    idempotency: "event.data.id",
    retries: 2,
    concurrency: { limit: 3 },
    throttle: { limit: 2, period: "1m", burst: 1, key: "event.data.user_id" },
    triggers: { event: "recistep/import.requested" },
    onFailure: async ({ event, step }) => {
      const original = event.data.event as { data?: { id?: unknown } };
      const failedId = String(original.data?.id ?? "");
      if (/^[0-9a-f-]{36}$/i.test(failedId)) {
        await step.run("mark-import-failed-after-retries", () => updateSourceImport(failedId, {
          status: "failed",
          error_code: "PROCESSING_FAILED",
          error_message: "O processamento falhou após as tentativas automáticas. Envie uma transcrição autorizada ou tente novamente.",
        }));
      }
    },
  },
  async ({ event, step }) => {
    const id = String(event.data.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("INVALID_IMPORT_ID");

    const record = await step.run("load-import", async () => getSourceImport(id));
    if (!record) throw new Error("IMPORT_NOT_FOUND");
    if (record.status !== "queued") return { id, status: record.status, skipped: true };

    await step.run("mark-processing", async () => updateSourceImport(id, {
      status: "processing",
      error_code: null,
      error_message: null,
      attempt_count: record.attempt_count + 1,
    }));

    const connector = getSourceConnector(record.platform);

    let resolved: ResolvedSource;
    try {
      resolved = await step.run("resolve-public-source-content", async () =>
        connector.resolve(record.source_url),
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "SOURCE_CONNECTOR_FAILURE";
      if (code === "SOURCE_PROVIDER_TEMPORARY_FAILURE") throw error;
      await step.run("persist-source-metadata-error", async () => updateSourceImport(id, {
        status: "source_content_required",
        error_code: code,
        error_message:
          "Não foi possível obter metadados públicos. Você ainda pode continuar fornecendo uma transcrição autorizada.",
      }));
      return { id, status: "source_content_required", metadataUnavailable: true };
    }

    const metadata = resolved.metadata;
    await step.run("persist-public-source-metadata", async () => updateSourceImport(id, {
      status: "processing",
      source_metadata: metadata,
      error_code: null,
      error_message: null,
    }));

    // Recognizing a URL never guarantees the media can be acquired. The content
    // is analyzed as a public video URL when the provider can fetch it, then as
    // public caption/subtitle text, and only then an authorized transcript is
    // requested instead of reporting a false success.
    const content = resolved.content;

    if (isUnsupportedContent(content)) {
      await step.run("persist-unanalyzable-source", async () => updateSourceImport(id, {
        status: "failed",
        error_code: content.code,
        error_message: content.reason,
      }));
      return { id, status: "failed" };
    }

    // Public captions and subtitle tracks are read outside any durable step so
    // the spoken text never lands in the workflow's step history.
    let publicText: string | null = null;
    if (content.kind === "public_text") {
      publicText = content.text;
    } else if (content.kind === "external_subtitles") {
      try {
        publicText = await fetchPublicSubtitlesText({ url: content.url, platform: record.platform });
      } catch {
        publicText = null;
      }
    }

    const extraction: { kind: "media"; content: MediaContent } | { kind: "text"; transcript: string } | null =
      publicText && publicText.length >= MIN_PUBLIC_TEXT_LENGTH
        ? { kind: "text", transcript: publicText }
        : isMediaContent(content)
          ? { kind: "media", content }
          : null;

    if (!extraction) {
      const requestable = content.kind === "transcript_required" ? content : null;
      await step.run("request-transcript-for-unavailable-media", async () => updateSourceImport(id, {
        status: "source_content_required",
        error_code: requestable?.code ?? "SOURCE_MEDIA_UNAVAILABLE",
        error_message:
          requestable?.reason ??
          "Não foi possível analisar o conteúdo público desta fonte. Envie uma transcrição autorizada para continuar.",
      }));
      return { id, status: "source_content_required", contentUnavailable: true };
    }

    try {
      const titleCache = await step.run("lookup-recipe-by-normalized-title", async () => {
        try { return await findCachedRecipeByTitle(metadata.title); }
        catch { return null; }
      });
      const draft = titleCache?.recipe_draft ?? await step.run("extract-recipe-from-public-source", async () =>
        streamExtractToImport({
          importId: id,
          stream: extraction.kind === "media"
            ? streamRecipeFromMediaUrl({
              mediaUrl: extraction.content.mediaUrl,
              platform: record.platform,
              mimeType: extraction.content.kind === "external_media" ? extraction.content.mimeType : undefined,
              locale: record.locale,
              sourceTitle: metadata.title,
            })
            : streamRecipeFromTranscript({
              transcript: extraction.transcript,
              locale: record.locale,
              sourceTitle: metadata.title,
            }),
        }),
      );
      await step.run("persist-recipe-draft-for-review", async () => updateSourceImport(id, {
        status: "review_required",
        recipe_draft: draft,
        source_url_hash: hashSourceUrl(record.source_url),
        recipe_fingerprint: fingerprintRecipe(draft),
        error_code: null,
        error_message: null,
      }));
      await step.run("cache-public-recipe-draft", async () => {
        try { await persistRecipeCache({ sourceUrl: record.source_url, recipe: draft, sourceMetadata: metadata as unknown as Record<string, unknown> }); }
        catch { /* Cache is an optimization; successful extraction remains valid without it. */ }
      });
      return { id, status: "review_required" };
    } catch (error) {
      const code = error instanceof Error ? error.message : "GEMINI_EXTRACTION_FAILURE";
      if (error instanceof GeminiExtractionError && error.retryable) throw error;

      if (["GEMINI_VIDEO_UNAVAILABLE", "UNSUPPORTED_SOURCE"].includes(code)) {
        await step.run("request-transcript-fallback", async () => updateSourceImport(id, {
          status: "source_content_required",
          error_code: code,
          error_message:
            "O vídeo não pôde ser processado diretamente. Envie uma transcrição autorizada para continuar.",
        }));
        return { id, status: "source_content_required" };
      }

      await step.run("persist-extraction-error", async () => updateSourceImport(id, {
        status: "failed",
        error_code: code,
        error_message: code === "GEMINI_NOT_CONFIGURED"
          ? "A chave Gemini não está configurada no servidor."
          : code === "GEMINI_AUTHENTICATION_FAILED"
            ? "A credencial Gemini foi rejeitada; confira a configuração do servidor."
            : code === "GEMINI_MODEL_UNAVAILABLE"
              ? "O modelo Gemini configurado não está disponível."
              : "Não foi possível extrair a receita. Você pode tentar novamente fornecendo uma transcrição autorizada.",
      }));
      return { id, status: "failed" };
    }
  },
);

export const processTranscriptSubmitted = inngest.createFunction(
  {
    id: "recistep-extract-recipe-from-transcript",
    idempotency: "event.data.submission_id",
    retries: 2,
    concurrency: { limit: 3 },
    throttle: { limit: 2, period: "1m", burst: 1, key: "event.data.user_id" },
    triggers: { event: "recistep/import.transcript-submitted" },
    onFailure: async ({ event, step }) => {
      const original = event.data.event as { data?: { id?: unknown } };
      const failedId = String(original.data?.id ?? "");
      if (/^[0-9a-f-]{36}$/i.test(failedId)) {
        await step.run("clear-transcript-after-final-failure", () => updateSourceImport(failedId, {
          status: "failed",
          source_transcript: null,
          error_code: "GEMINI_PROCESSING_FAILED",
          error_message: "A extração falhou após as tentativas automáticas. Envie a transcrição novamente para tentar de novo.",
        }));
      }
    },
  },
  async ({ event, step }) => {
    const id = String(event.data.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("INVALID_IMPORT_ID");

    // Read outside a durable step so the raw transcript is not persisted in Inngest step history.
    const record = await getSourceImport(id);
    if (!record) throw new Error("IMPORT_NOT_FOUND");
    if (!["queued", "processing"].includes(record.status) || !record.source_transcript) {
      return { id, status: record.status, skipped: true };
    }

    await step.run("mark-transcript-processing", async () => updateSourceImport(id, {
      status: "processing",
      error_code: null,
      error_message: null,
      attempt_count: record.attempt_count + 1,
    }));

    try {
      const draft = await step.run("extract-structured-recipe-with-gemini", async () =>
        streamExtractToImport({
          importId: id,
          stream: streamRecipeFromTranscript({
            transcript: record.source_transcript!,
            locale: record.locale,
            sourceTitle:
              typeof record.source_metadata?.title === "string"
                ? record.source_metadata.title
                : undefined,
          }),
        }),
      );

      await step.run("persist-recipe-draft-and-clear-transcript", async () =>
        updateSourceImport(id, {
          status: "review_required",
          recipe_draft: draft,
          source_transcript: null,
          error_code: null,
          error_message: null,
        }),
      );
      return { id, status: "review_required" };
    } catch (error) {
      if (error instanceof GeminiExtractionError && !error.retryable) {
        await step.run("persist-terminal-extraction-error", async () => updateSourceImport(id, {
          status: "failed",
          source_transcript: null,
          error_code: error.message,
          error_message: "Não foi possível processar a transcrição. Envie uma transcrição válida e tente novamente.",
        }));
        return { id, status: "failed" };
      }
      throw error;
    }
  },
);
