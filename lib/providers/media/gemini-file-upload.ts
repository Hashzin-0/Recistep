import "server-only";
import { GeminiExtractionError } from "@/lib/providers/ai/gemini-error";

const GEMINI_FILES_BASE = "https://generativelanguage.googleapis.com";
const UPLOAD_ENDPOINT = `${GEMINI_FILES_BASE}/upload/v1beta/files`;

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 300_000;
const REQUEST_TIMEOUT_MS = 60_000;

function apiKey(): string {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) throw new GeminiExtractionError("GEMINI_NOT_CONFIGURED", false);
  return value;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: { message?: unknown } };
    return typeof payload?.error?.message === "string" ? payload.error.message : "";
  } catch {
    return "";
  }
}

async function uploadHttpError(response: Response): Promise<GeminiExtractionError> {
  const detail = await errorDetail(response);
  // The provider message is safe to log (no secrets) and is the only signal for
  // an otherwise opaque upload failure.
  console.error(`[gemini-files] upload rejected (${response.status}): ${detail.slice(0, 500)}`);
  if (response.status === 401 || response.status === 403) {
    return new GeminiExtractionError("GEMINI_AUTHENTICATION_FAILED", false);
  }
  if (response.status === 429 || response.status >= 500) {
    return new GeminiExtractionError("GEMINI_FILE_UPLOAD_FAILED", true);
  }
  return new GeminiExtractionError("GEMINI_FILE_UPLOAD_FAILED", false);
}

type FileResource = {
  name?: unknown;
  uri?: unknown;
  state?: unknown;
  mimeType?: unknown;
};

function parseFileResource(value: unknown): { name: string; uri: string; state: string; mimeType: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as { file?: unknown };
  const raw = (envelope.file && typeof envelope.file === "object" ? envelope.file : value) as FileResource;
  const name = typeof raw.name === "string" && raw.name ? raw.name : null;
  const uri = typeof raw.uri === "string" && raw.uri ? raw.uri : null;
  if (!name || !uri) return null;
  const state = typeof raw.state === "string" ? raw.state : "ACTIVE";
  const mimeType = typeof raw.mimeType === "string" ? raw.mimeType : null;
  return { name, uri, state, mimeType };
}

async function pollFile(name: string, key: string): Promise<{ name: string; uri: string; state: string; mimeType: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${GEMINI_FILES_BASE}/v1beta/${name}`, {
      method: "GET",
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new GeminiExtractionError("GEMINI_FILE_UPLOAD_FAILED", true);
  }
  if (!response.ok) throw await uploadHttpError(response);
  const parsed = parseFileResource(await response.json().catch(() => null));
  if (!parsed) throw new GeminiExtractionError("GEMINI_FILE_UPLOAD_FAILED", true);
  return parsed;
}

/**
 * Uploads media to the Gemini Files API and waits until the file is `ACTIVE`,
 * so the model never has to fetch a signed, short-lived platform CDN URL on its
 * own. The caller must delete the returned file when done.
 */
export async function uploadMediaToGeminiFiles(input: {
  bytes: Uint8Array;
  mimeType: string;
  displayName: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}): Promise<{ fileUri: string; fileName: string; mimeType: string }> {
  const key = apiKey();
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const displayName = input.displayName.replace(/[\r\n\0]/g, "_").slice(0, 120) || "recistep-media";

  // Step 1: start a resumable upload session.
  let startResponse: Response;
  try {
    startResponse = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(input.bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": input.mimeType,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
      body: JSON.stringify({ file: { display_name: displayName } }),
    });
  } catch {
    throw new GeminiExtractionError("GEMINI_FILE_UPLOAD_FAILED", true);
  }
  if (!startResponse.ok) throw await uploadHttpError(startResponse);
  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new GeminiExtractionError("GEMINI_FILE_UPLOAD_FAILED", true);

  // Step 2: send the bytes and finalize.
  let finalizeResponse: Response;
  try {
    finalizeResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": input.mimeType,
        "Content-Length": String(input.bytes.byteLength),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
      body: input.bytes as unknown as BodyInit,
    });
  } catch {
    throw new GeminiExtractionError("GEMINI_FILE_UPLOAD_FAILED", true);
  }
  if (!finalizeResponse.ok) throw await uploadHttpError(finalizeResponse);

  const finalized = parseFileResource(await finalizeResponse.json().catch(() => null));
  if (!finalized) throw new GeminiExtractionError("GEMINI_FILE_UPLOAD_FAILED", true);

  // Step 3: poll while the provider processes the media.
  let file = finalized;
  const deadline = Date.now() + pollTimeoutMs;
  while (file.state === "PROCESSING") {
    if (Date.now() >= deadline) {
      throw new GeminiExtractionError("GEMINI_FILE_PROCESSING_TIMEOUT", true);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    file = await pollFile(file.name, key);
  }

  if (file.state === "FAILED") {
    throw new GeminiExtractionError("GEMINI_FILE_PROCESSING_FAILED", false);
  }

  return { fileUri: file.uri, fileName: file.name, mimeType: file.mimeType ?? input.mimeType };
}

/** Best-effort removal; uploaded files also expire after 48h. */
export async function deleteGeminiFile(fileName: string): Promise<void> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || !fileName) return;
  try {
    await fetch(`${GEMINI_FILES_BASE}/v1beta/${fileName}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Cleanup is optional; the file expires on its own.
  }
}
