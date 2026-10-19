import "server-only";
import { recipeExtractionSchema, type RecipeExtraction } from "@/lib/schemas/recipe";
import { GeminiExtractionError } from "@/lib/providers/ai/gemini-error";
import { recipeResponseSchema, systemInstruction } from "@/lib/providers/ai/extraction-contract";
import { finalizeRecipe, normalizePartialRecipe } from "@/lib/providers/ai/recipe-normalize";
import { parsePartialJson } from "@/lib/providers/ai/partial-json";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
const REQUEST_TIMEOUT_MS = 45_000;
const STREAM_TIMEOUT_MS = 120_000;

/**
 * Content part in the shape the extraction pipeline assembles (mirrors the
 * Gemini part union). Kept structural so callers can pass Gemini parts directly.
 */
export type ProviderPart =
  | { text: string }
  | { file_data: { file_uri: string; mime_type?: string } }
  | { inline_data: { mime_type: string; data: string } };

type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "file"; file: { filename?: string; file_data: string } };

function apiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

export function isOpenRouterConfigured(): boolean {
  return apiKey() !== null;
}

function model(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const AUDIO_FORMAT_BY_MIME: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
};

function audioFormatFor(mimeType: string): string | null {
  return AUDIO_FORMAT_BY_MIME[mimeType.toLowerCase()] ?? null;
}

function dataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}

function isYouTubeUrl(uri: string): boolean {
  try {
    const url = new URL(uri);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

function inlinePartToContent(part: { mime_type: string; data: string }): OpenRouterContentPart | null {
  const mime = part.mime_type.toLowerCase();
  if (mime.startsWith("image/")) return { type: "image_url", image_url: { url: dataUrl(part.mime_type, part.data) } };
  if (mime.startsWith("video/")) return { type: "video_url", video_url: { url: dataUrl(part.mime_type, part.data) } };
  if (mime.startsWith("audio/")) {
    const format = audioFormatFor(part.mime_type);
    if (!format) return null;
    return { type: "input_audio", input_audio: { data: part.data, format } };
  }
  if (mime === "application/pdf") return { type: "file", file: { file_data: dataUrl(part.mime_type, part.data) } };
  return null;
}

/**
 * Converts pipeline parts into OpenRouter chat content. Returns null when a part
 * cannot be represented (e.g. a Gemini Files URI), which signals the caller that
 * this payload must be re-prepared before OpenRouter can serve it.
 */
export function toOpenRouterContent(parts: ProviderPart[]): OpenRouterContentPart[] | null {
  const content: OpenRouterContentPart[] = [];
  for (const part of parts) {
    if ("text" in part) {
      content.push({ type: "text", text: part.text });
      continue;
    }
    if ("inline_data" in part) {
      const converted = inlinePartToContent(part.inline_data);
      if (!converted) return null;
      content.push(converted);
      continue;
    }
    if (!isYouTubeUrl(part.file_data.file_uri)) return null;
    content.push({ type: "video_url", video_url: { url: part.file_data.file_uri } });
  }
  return content;
}

function buildRequestBody(parts: OpenRouterContentPart[], stream: boolean) {
  return {
    model: model(),
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: parts },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "recipe_extraction",
        strict: true,
        schema: recipeResponseSchema,
      },
    },
    temperature: 0.1,
    max_tokens: 16_384,
    ...(stream ? { stream: true } : {}),
  };
}

function requestHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  headers["X-Title"] = "Recistep";
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  if (referer) headers["HTTP-Referer"] = referer;
  return headers;
}

async function providerErrorDetail(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: { message?: unknown } };
    return typeof payload?.error?.message === "string" ? payload.error.message : "";
  } catch {
    return "";
  }
}

async function throwForOpenRouterHttpError(response: Response): Promise<never> {
  const detail = await providerErrorDetail(response);
  // The provider message is safe to log (no secrets) and is the only signal for
  // an otherwise opaque rejection.
  console.error(`[openrouter] request rejected (${response.status}): ${detail.slice(0, 500)}`);
  if (response.status === 401 || response.status === 403) {
    throw new GeminiExtractionError("OPENROUTER_AUTHENTICATION_FAILED", false);
  }
  if (response.status === 404) {
    throw new GeminiExtractionError("OPENROUTER_MODEL_UNAVAILABLE", false);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new GeminiExtractionError("OPENROUTER_TEMPORARY_FAILURE", true);
  }
  throw new GeminiExtractionError("OPENROUTER_REQUEST_REJECTED", false);
}

function responseText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
      .join("");
  }
  return "";
}

function validateRecipeText(recipeText: string): RecipeExtraction {
  let decoded: unknown;
  try {
    decoded = JSON.parse(recipeText);
  } catch {
    throw new GeminiExtractionError("OPENROUTER_INVALID_JSON", true);
  }
  const parsed = recipeExtractionSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new GeminiExtractionError("OPENROUTER_OUTPUT_SCHEMA_INVALID", true);
  }
  return finalizeRecipe(parsed.data);
}

async function openResponse(content: OpenRouterContentPart[]): Promise<Response> {
  const key = apiKey();
  if (!key) throw new GeminiExtractionError("OPENROUTER_NOT_CONFIGURED", false);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_BASE_URL, {
      method: "POST",
      headers: requestHeaders(key),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
      body: JSON.stringify(buildRequestBody(content, false)),
    });
  } catch {
    throw new GeminiExtractionError("OPENROUTER_NETWORK_FAILURE", true);
  }
  if (!response.ok) await throwForOpenRouterHttpError(response);
  return response;
}

export async function generateStructuredRecipeViaOpenRouter(
  parts: ProviderPart[],
): Promise<RecipeExtraction> {
  const content = toOpenRouterContent(parts);
  if (!content) throw new GeminiExtractionError("OPENROUTER_UNSUPPORTED_INPUT", false);

  const response = await openResponse(content);
  const payload = await response.json() as {
    model?: string;
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
  };
  const choice = payload.choices?.[0];
  const recipeText = responseText(choice?.message?.content).trim();

  if (!recipeText || choice?.finish_reason === "length") {
    throw new GeminiExtractionError("OPENROUTER_EMPTY_RESPONSE", true);
  }
  console.info(`[ai-provider] openrouter served recipe (model=${payload.model ?? model()})`);
  return validateRecipeText(recipeText);
}

/** Streams SSE chunks, ignoring OpenRouter comment frames and `[DONE]`. */
function openStreamingResponse(content: OpenRouterContentPart[]): Promise<Response> {
  const key = apiKey();
  if (!key) return Promise.reject(new GeminiExtractionError("OPENROUTER_NOT_CONFIGURED", false));

  return fetch(OPENROUTER_BASE_URL, {
    method: "POST",
    headers: requestHeaders(key),
    signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    cache: "no-store",
    body: JSON.stringify(buildRequestBody(content, true)),
  }).then(async (response) => {
    if (!response.ok) await throwForOpenRouterHttpError(response);
    return response;
  }).catch((error: unknown) => {
    if (error instanceof GeminiExtractionError) throw error;
    throw new GeminiExtractionError("OPENROUTER_NETWORK_FAILURE", true);
  });
}

/**
 * Streams a structured recipe from OpenRouter. Yields lenient partial snapshots
 * as they become parseable; the accumulated buffer is strict-validated and
 * yielded once more as the final recipe.
 */
export async function* streamStructuredRecipeViaOpenRouter(
  parts: ProviderPart[],
): AsyncGenerator<RecipeExtraction, void, undefined> {
  const content = toOpenRouterContent(parts);
  if (!content) throw new GeminiExtractionError("OPENROUTER_UNSUPPORTED_INPUT", false);

  const response = await openStreamingResponse(content);
  if (!response.body) {
    throw new GeminiExtractionError("OPENROUTER_EMPTY_RESPONSE", true);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let recipeText = "";
  let emittedSignature = "";
  let observedModel = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk: unknown;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    if (!isRecord(chunk)) return;
    if (isRecord(chunk.error)) {
      const message = typeof (chunk.error as Record<string, unknown>).message === "string"
        ? String((chunk.error as Record<string, unknown>).message)
        : "";
      console.error(`[openrouter] stream error: ${message.slice(0, 500)}`);
      throw new GeminiExtractionError("OPENROUTER_TEMPORARY_FAILURE", true);
    }
    if (typeof chunk.model === "string") observedModel = chunk.model;
    const choices = Array.isArray(chunk.choices) ? chunk.choices as Array<Record<string, unknown>> : [];
    const delta = isRecord(choices[0]?.delta) ? choices[0].delta as Record<string, unknown> : null;
    if (!delta) return;
    if (typeof delta.content === "string") recipeText += delta.content;
  };

  const extractFromLines = (isLast: boolean): RecipeExtraction | null => {
    const lines = raw.split(/\r?\n/);
    raw = isLast ? "" : (lines.pop() ?? "");
    for (const line of lines) consumeLine(line);
    const decoded = parsePartialJson(recipeText);
    return decoded === undefined ? null : normalizePartialRecipe(decoded);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) raw += decoder.decode(value, { stream: true });
      const partial = extractFromLines(done);
      if (done) break;
      if (partial) {
        const signature = JSON.stringify({
          title: partial.title,
          ingredients: partial.ingredients.length,
          steps: partial.steps.length,
        });
        if (signature !== emittedSignature) {
          emittedSignature = signature;
          yield partial;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!recipeText.trim()) {
    throw new GeminiExtractionError("OPENROUTER_EMPTY_RESPONSE", true);
  }
  emittedSignature = "";
  const recipe = validateRecipeText(recipeText);
  console.info(`[ai-provider] openrouter served recipe (model=${observedModel || model()})`);
  yield recipe;
}
