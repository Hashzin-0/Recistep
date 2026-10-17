import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inngest, isInngestConfigured } from "@/lib/inngest/client";
import {
  authenticateSupabaseAccessToken,
  getSupabaseConfig,
  getUserSourceImport,
  updateSourceImport,
} from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

const transcriptSchema = z.object({
  transcript: z.string().trim().min(80).max(80_000),
}).strict();

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 20 && token.length <= 4096 ? token : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!getSupabaseConfig() || !isInngestConfigured()) {
    return NextResponse.json({
      error: { code: "IMPORT_PIPELINE_NOT_CONFIGURED", message: "A persistência e a fila precisam estar configuradas para processar transcrições.", retryable: false },
    }, { status: 503 });
  }

  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({
      error: { code: "UNAUTHORIZED", message: "Entre na sua conta para continuar.", retryable: false },
    }, { status: 401 });
  }

  let user: { id: string };
  try {
    user = await authenticateSupabaseAccessToken(token);
  } catch {
    return NextResponse.json({
      error: { code: "UNAUTHORIZED", message: "A sessão é inválida ou expirou.", retryable: false },
    }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > 120_000) {
    return NextResponse.json({
      error: { code: "REQUEST_TOO_LARGE", message: "A transcrição ultrapassa o limite permitido.", retryable: false },
    }, { status: 413 });
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 120_000) {
      return NextResponse.json({
        error: { code: "REQUEST_TOO_LARGE", message: "A transcrição ultrapassa o limite permitido.", retryable: false },
      }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({
      error: { code: "INVALID_JSON", message: "Envie um JSON válido.", retryable: false },
    }, { status: 400 });
  }

  const parsed = transcriptSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({
      error: { code: "INVALID_TRANSCRIPT", message: "A transcrição deve conter entre 80 e 80.000 caracteres.", retryable: false },
    }, { status: 400 });
  }

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({
      error: { code: "INVALID_IMPORT_ID", message: "Identificador de importação inválido.", retryable: false },
    }, { status: 400 });
  }

  try {
    const record = await getUserSourceImport(id, user.id);
    if (!record) {
      return NextResponse.json({
        error: { code: "IMPORT_NOT_FOUND", message: "Importação não encontrada.", retryable: false },
      }, { status: 404 });
    }
    if (!["source_content_required", "failed"].includes(record.status)) {
      return NextResponse.json({
        error: { code: "IMPORT_NOT_READY_FOR_TRANSCRIPT", message: "A importação não está aguardando uma transcrição.", retryable: false },
      }, { status: 409 });
    }

    await updateSourceImport(id, {
      status: "queued",
      source_transcript: parsed.data.transcript,
      error_code: null,
      error_message: null,
    });

    try {
      await inngest.send({ name: "recistep/import.transcript-submitted", data: { id, submission_id: randomUUID() } });
    } catch {
      await updateSourceImport(id, {
        status: "failed",
        source_transcript: null,
        error_code: "QUEUE_UNAVAILABLE",
        error_message: "Não foi possível agendar o processamento. Tente novamente.",
      });
      return NextResponse.json({
        error: { code: "QUEUE_UNAVAILABLE", message: "Não foi possível agendar o processamento. Tente novamente.", retryable: true },
      }, { status: 503 });
    }

    return NextResponse.json({ data: { id, status: "queued" } }, { status: 202 });
  } catch {
    return NextResponse.json({
      error: { code: "PERSISTENCE_UNAVAILABLE", message: "Não foi possível salvar a transcrição agora.", retryable: true },
    }, { status: 503 });
  }
}
