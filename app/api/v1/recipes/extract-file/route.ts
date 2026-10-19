import { checkUserRateLimit } from "@/lib/server/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { extractRecipeFromUploadedFile, GeminiExtractionError } from "@/lib/providers/ai/gemini-recipe-extractor";
import { authenticateRequest } from "@/lib/server/route-auth";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4_500_000;
const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const extensionMimeTypes: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};
const localeSchema = z.string().trim().min(2).max(20).default("pt-BR");

function mimeForFile(file: File): string | null {
  const declared = file.type.trim().toLowerCase();
  if (allowedMimeTypes.has(declared)) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferred = extensionMimeTypes[extension];
  if ((!declared || declared === "application/octet-stream") && inferred) return inferred;
  return null;
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const rateLimit = await checkUserRateLimit({
      userId: auth.user.id,
      route: "recipes:extract-file",
      limit: 5,
      windowSeconds: 600,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Você atingiu o limite de arquivos analisados. Aguarde antes de tentar novamente.", retryable: true } },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }
  } catch {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Não foi possível verificar o limite de uso. Tente novamente em instantes.", retryable: true } },
      { status: 503 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: { code: "REQUEST_TOO_LARGE", message: "O arquivo deve ter no máximo 4 MB.", retryable: false } },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_MULTIPART", message: "Não foi possível ler o arquivo enviado.", retryable: false } },
      { status: 400 },
    );
  }

  const candidate = form.get("file");
  if (!(candidate instanceof File)) {
    return NextResponse.json(
      { error: { code: "FILE_REQUIRED", message: "Selecione um arquivo PDF, imagem ou vídeo.", retryable: false } },
      { status: 400 },
    );
  }
  if (candidate.size === 0) {
    return NextResponse.json(
      { error: { code: "EMPTY_FILE", message: "O arquivo está vazio.", retryable: false } },
      { status: 400 },
    );
  }
  if (candidate.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: { code: "FILE_TOO_LARGE", message: "O arquivo deve ter no máximo 4 MB.", retryable: false } },
      { status: 413 },
    );
  }

  const mimeType = mimeForFile(candidate);
  if (!mimeType) {
    return NextResponse.json(
      { error: { code: "UNSUPPORTED_FILE_TYPE", message: "Formato não suportado. Use PDF, JPG, PNG, WebP, MP4, WebM ou MOV.", retryable: false } },
      { status: 415 },
    );
  }

  const localeResult = localeSchema.safeParse(form.get("locale") || "pt-BR");
  if (!localeResult.success) {
    return NextResponse.json(
      { error: { code: "INVALID_LOCALE", message: "O idioma informado é inválido.", retryable: false } },
      { status: 400 },
    );
  }
  const convertCupsToGrams = form.get("convert_cups_to_grams") === "true" || form.get("convert_cups_to_grams") === "1";

  try {
    const bytes = new Uint8Array(await candidate.arrayBuffer());
    const recipe = await extractRecipeFromUploadedFile({
      fileName: candidate.name,
      mimeType,
      bytes,
      locale: localeResult.data,
      ...(convertCupsToGrams ? { convertCupsToGrams: true } : {}),
    });
    return NextResponse.json({ data: recipe });
  } catch (error) {
    if (error instanceof GeminiExtractionError) {
      const status = error.message === "GEMINI_NOT_CONFIGURED" ? 503
        : error.message === "UNSUPPORTED_UPLOAD" ? 415
          : error.retryable ? 502 : 422;
      const message = error.message === "GEMINI_NOT_CONFIGURED"
        ? "A chave Gemini não está configurada no servidor."
        : error.message === "GEMINI_AUTHENTICATION_FAILED"
          ? "A credencial Gemini foi rejeitada; confira a configuração do servidor."
          : error.message === "GEMINI_MODEL_UNAVAILABLE"
            ? "O modelo Gemini configurado não está disponível."
            : error.message === "UNSUPPORTED_UPLOAD"
              ? "Este formato de arquivo não é suportado."
              : "Não foi possível estruturar a receita a partir do arquivo. Tente um arquivo mais nítido ou revise o conteúdo.";
      return NextResponse.json(
        { error: { code: error.message, message, retryable: error.retryable } },
        { status },
      );
    }
    return NextResponse.json(
      { error: { code: "FILE_EXTRACTION_FAILED", message: "Não foi possível gerar um rascunho a partir do arquivo.", retryable: true } },
      { status: 502 },
    );
  }
}
