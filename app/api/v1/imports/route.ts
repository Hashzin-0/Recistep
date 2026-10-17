import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSourceUrl } from "@/lib/source-url";
import { inngest, isInngestConfigured } from "@/lib/inngest/client";
import {
  authenticateSupabaseAccessToken,
  createSourceImport,
  getSupabaseConfig,
  updateSourceImport,
} from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

const importRequestSchema = z.object({
  source_url: z.string().trim().min(1).max(2048),
  locale: z.string().trim().min(2).max(20).default("pt-BR"),
  servings_target: z.number().positive().max(100).optional(),
  idempotency_key: z.string().trim().min(8).max(200).optional(),
}).strict();

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 20 && token.length <= 4096 ? token : null;
}

export async function POST(request: Request) {
  if (!getSupabaseConfig() || !isInngestConfigured()) {
    return NextResponse.json({
      error: {
        code: "IMPORT_PIPELINE_NOT_CONFIGURED",
        message: "Configure Supabase e Inngest no ambiente de servidor antes de iniciar importações.",
        retryable: false,
      },
    }, { status: 503 });
  }

  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({
      error: { code: "UNAUTHORIZED", message: "Entre na sua conta para iniciar uma importação.", retryable: false },
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
  if (declaredLength > 12_000) {
    return NextResponse.json({
      error: { code: "REQUEST_TOO_LARGE", message: "O corpo ultrapassa o limite permitido.", retryable: false },
    }, { status: 413 });
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 12_000) {
      return NextResponse.json({
        error: { code: "REQUEST_TOO_LARGE", message: "O corpo ultrapassa o limite permitido.", retryable: false },
      }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({
      error: { code: "INVALID_JSON", message: "O corpo da requisição precisa ser um JSON válido.", retryable: false },
    }, { status: 400 });
  }

  const parsed = importRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({
      error: {
        code: "INVALID_REQUEST",
        message: "Confira o link e os parâmetros enviados.",
        retryable: false,
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      },
    }, { status: 400 });
  }

  const headerKey = request.headers.get("idempotency-key")?.trim();
  if (headerKey && parsed.data.idempotency_key && headerKey !== parsed.data.idempotency_key) {
    return NextResponse.json({
      error: { code: "IDEMPOTENCY_KEY_MISMATCH", message: "A chave de idempotência do cabeçalho e do corpo diverge.", retryable: false },
    }, { status: 400 });
  }

  const source = validateSourceUrl(parsed.data.source_url);
  if (!source.ok) {
    return NextResponse.json({
      error: { code: source.code, message: source.message, retryable: false },
    }, { status: 422 });
  }

  if (headerKey && (headerKey.length < 8 || headerKey.length > 200)) {
    return NextResponse.json({
      error: { code: "INVALID_IDEMPOTENCY_KEY", message: "A chave de idempotência deve ter entre 8 e 200 caracteres.", retryable: false },
    }, { status: 400 });
  }

  const idempotencyKey = headerKey || parsed.data.idempotency_key || randomUUID();

  try {
    const result = await createSourceImport({
      user_id: user.id,
      source_url: source.url.toString(),
      platform: source.platform,
      locale: parsed.data.locale,
      servings_target: parsed.data.servings_target ?? null,
      idempotency_key: idempotencyKey,
    });
    const record = result.record;

    if (!result.created && (
      record.source_url !== source.url.toString() ||
      record.locale !== parsed.data.locale ||
      record.servings_target !== (parsed.data.servings_target ?? null)
    )) {
      return NextResponse.json({
        error: { code: "IDEMPOTENCY_KEY_REUSED", message: "A chave já foi usada com parâmetros diferentes.", retryable: false },
      }, { status: 409 });
    }

    if (!result.created && record.status !== "queued" &&
      !(record.status === "failed" && record.error_code === "QUEUE_UNAVAILABLE")) {
      return NextResponse.json({ data: record }, { status: 200 });
    }

    if (record.status === "failed" && record.error_code === "QUEUE_UNAVAILABLE") {
      await updateSourceImport(record.id, {
        status: "queued",
        error_code: null,
        error_message: null,
      });
    }

    try {
      await inngest.send({ name: "recistep/import.requested", data: { id: record.id, user_id: user.id } });
    } catch {
      await updateSourceImport(record.id, {
        status: "failed",
        error_code: "QUEUE_UNAVAILABLE",
        error_message: "Não foi possível agendar o processamento. Tente novamente.",
      });
      return NextResponse.json({
        error: {
          code: "QUEUE_UNAVAILABLE",
          message: "A importação foi registrada, mas a fila não confirmou o agendamento.",
          retryable: true,
          import_id: record.id,
        },
      }, { status: 503 });
    }

    return NextResponse.json({
      data: { id: record.id, status: "queued", created_at: record.created_at },
    }, { status: 202 });
  } catch {
    return NextResponse.json({
      error: { code: "PERSISTENCE_UNAVAILABLE", message: "Não foi possível registrar a importação agora.", retryable: true },
    }, { status: 503 });
  }
}
