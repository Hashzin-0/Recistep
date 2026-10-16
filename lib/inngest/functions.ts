import "server-only";
import { inngest } from "@/lib/inngest/client";
import {
  getSourceImport,
  saveSourceMetadata,
  updateSourceImport,
} from "@/lib/server/supabase-rest";
import { fetchYouTubePublicMetadata } from "@/lib/providers/sources/youtube-oembed";
import {
  extractRecipeFromTranscript,
  GeminiExtractionError,
} from "@/lib/providers/ai/gemini-recipe-extractor";

export const processImportRequested = inngest.createFunction(
  { id: "recistep-process-source-import", retries: 2, triggers: { event: "recistep/import.requested" } },
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

    try {
      const metadata = await step.run("fetch-public-source-metadata", async () =>
        fetchYouTubePublicMetadata(record.source_url),
      );
      await step.run("persist-public-source-metadata", async () => saveSourceMetadata(id, metadata));
      return { id, status: "source_content_required" };
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
  },
);

export const processTranscriptSubmitted = inngest.createFunction(
  { id: "recistep-extract-recipe-from-transcript", retries: 2, triggers: { event: "recistep/import.transcript-submitted" } },
  async ({ event, step }) => {
    const id = String(event.data.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("INVALID_IMPORT_ID");

    const record = await step.run("load-import-transcript", async () => getSourceImport(id));
    if (!record) throw new Error("IMPORT_NOT_FOUND");
    if (record.status !== "queued" || !record.source_transcript) {
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
