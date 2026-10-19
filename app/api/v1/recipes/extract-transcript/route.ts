import { checkUserRateLimit } from "@/lib/server/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { extractRecipeFromTranscript, GeminiExtractionError } from "@/lib/providers/ai/gemini-recipe-extractor";
import { authenticateRequest } from "@/lib/server/route-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  transcript: z.string().trim().min(80).max(80_000),
  locale: z.string().trim().min(2).max(20).default("pt-BR"),
  convert_cups_to_grams: z.boolean().optional().default(false),
}).strict();

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const rateLimit = await checkUserRateLimit({
      userId: auth.user.id,
      route: "recipes:extract-transcript",
      limit: 5,
      windowSeconds: 600,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Você atingiu o limite de transcrições. Aguarde antes de tentar novamente.", retryable: true } },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }
  } catch {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Não foi possível verificar o limite de uso. Tente novamente em instantes.", retryable: true } },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 100_000) {
      return NextResponse.json({ error: { code: "REQUEST_TOO_LARGE", message: "A transcrição ultrapassa o limite permitido.", retryable: false } }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Envie um JSON válido.", retryable: false } }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_TRANSCRIPT", message: "A transcrição deve conter entre 80 e 80.000 caracteres.", retryable: false } },
      { status: 400 },
    );
  }

  try {
    const recipe = await extractRecipeFromTranscript({
      transcript: parsed.data.transcript,
      locale: parsed.data.locale,
      ...(parsed.data.convert_cups_to_grams ? { convertCupsToGrams: true } : {}),
    });
    return NextResponse.json({ data: recipe });
  } catch (error) {
    if (error instanceof GeminiExtractionError) {
      const status = error.message === "GEMINI_NOT_CONFIGURED" ? 503
        : error.message === "TRANSCRIPT_LENGTH_INVALID" ? 400
          : error.retryable ? 502 : 422;
      const message = error.message === "GEMINI_NOT_CONFIGURED"
        ? "A chave Gemini não está configurada no servidor."
        : error.message === "GEMINI_AUTHENTICATION_FAILED"
          ? "A credencial Gemini foi rejeitada; confira a configuração do servidor."
          : error.message === "GEMINI_MODEL_UNAVAILABLE"
            ? "O modelo Gemini configurado não está disponível."
            : "Não foi possível estruturar a receita a partir da transcrição. Revise o texto e tente novamente.";
      return NextResponse.json(
        { error: { code: error.message, message, retryable: error.retryable } },
        { status },
      );
    }
    return NextResponse.json(
      { error: { code: "RECIPE_EXTRACTION_FAILED", message: "Não foi possível gerar o rascunho da receita.", retryable: true } },
      { status: 502 },
    );
  }
}
