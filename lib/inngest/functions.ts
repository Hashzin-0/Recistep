import "server-only";
import { inngest } from "@/lib/inngest/client";
import {
  getSourceImport,
  updateSourceImport,
  type SourceMetadata,
} from "@/lib/server/supabase-rest";
import { fetchYouTubePublicMetadata } from "@/lib/providers/sources/youtube-oembed";
import {
  extractRecipeFromTranscript,
  extractRecipeFromYouTubeUrl,
  GeminiExtractionError,
} from "@/lib/providers/ai/gemini-recipe-extractor";

export const processImportRequested = inngest.createFunction(
  {
    id: "recistep-process-source-import",
    idempotency: "event.data.id",
    retries: 2,
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

    if (record.platform !== "youtube") {
      await step.run("request-authorized-transcript", async () => updateSourceImport(id, {
        status: "source_content_required",
        error_code: "PLATFORM_CONNECTOR_NOT_CONFIGURED",
        error_message:
          "Não há conector de conteúdo autorizado habilitado para esta plataforma. Envie uma transcrição que você tenha direito de usar para continuar.",
      }));
      return { id, status: "source_content_required" };
    }

    let metadata: SourceMetadata;
    try {
      metadata = await step.run("fetch-public-source-metadata", async () =>
        fetchYouTubePublicMetadata(record.source_url),
      );
      await step.run("persist-public-source-metadata", async () => updateSourceImport(id, {
        status: "processing",
        source_metadata: metadata,
        error_code: null,
        error_message: null,
      }));
    } catch (error) {
      const code = error instanceof Error ? error.message : "SOURCE_METADATA_FAILURE";
      if (code === "SOURCE_PROVIDER_TEMPORARY_FAILURE") throw error;
      await step.run("persist-source-metadata-error", async () => updateSourceImport(id, {
        status: "source_content_required",
        error_code: code,
        error_message:
          "Não foi possível obter metadados públicos. Você ainda pode continuar fornecendo uma transcrição autorizada.",
      }));
      return { id, status: "source_content_required", metadataUnavailable: true };
    }

    try {
      const draft = await step.run("extract-recipe-from-public-youtube-video", async () =>
        extractRecipeFromYouTubeUrl({
          sourceUrl: record.source_url,
          locale: record.locale,
          sourceTitle: metadata.title,
        }),
      );
      await step.run("persist-recipe-draft-for-review", async () => updateSourceImport(id, {
        status: "review_required",
        recipe_draft: draft,
        error_code: null,
        error_message: null,
      }));
      return { id, status: "review_required" };
    } catch (error) {
      const code = error instanceof Error ? error.message : "GEMINI_EXTRACTION_FAILURE";
      if (error instanceof GeminiExtractionError && error.retryable) throw error;

      if (["GEMINI_REQUEST_REJECTED_400", "UNSUPPORTED_SOURCE"].includes(code)) {
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
        extractRecipeFromTranscript({
          transcript: record.source_transcript!,
          locale: record.locale,
          sourceTitle:
            typeof record.source_metadata?.title === "string"
              ? record.source_metadata.title
              : undefined,
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
