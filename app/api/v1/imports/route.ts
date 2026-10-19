import { checkUserRateLimit } from "@/lib/server/rate-limit";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSourceUrl } from "@/lib/source-url";
import { inngest, isInngestConfigured } from "@/lib/inngest/client";
import {
  authenticateSupabaseAccessToken,
  createSourceImport,
  getSupabaseConfig,
  listUserSourceImports,
  updateSourceImport,
  type ImportStatus,
} from "@/lib/server/supabase-rest";
import { findCachedRecipeByUrl, fingerprintRecipe, hashSourceUrl } from "@/lib/server/recipe-cache";

export const runtime = "nodejs";

const importRequestSchema = z.object({
  source_url: z.string().trim().min(1).max(2048),
  locale: z.string().trim().min(2).max(20).default("pt-BR"),
  servings_target: z.number().positive().max(100).optional(),
  idempotency_key: z.string().trim().min(8).max(200).optional(),
  convert_cups_to_grams: z.boolean().optional().default(false),
}).strict();

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 20 && token.length <= 4096 ? token : null;
}

const ACTIVE_IMPORT_STATUSES: ImportStatus[] = [
  "queued",
  "processing",
  "source_content_required",
  "review_required",
];

const ALL_IMPORT_STATUSES: ImportStatus[] = [
  ...ACTIVE_IMPORT_STATUSES,
  "completed",
  "failed",
  "cancelled",
];

export async function GET(request: Request) {
  if (!getSupabaseConfig()) {
    return NextResponse.json({
      error: { code: "PERSISTENCE_NOT_CONFIGURED", message: "A persistência ainda não está configurada.", retryable: false },
    }, { status: 503 });
  }

  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({
      error: { code: "UNAUTHORIZED", message: "Entre na sua conta para listar suas importações.", retryable: false },
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

  const url = new URL(request.url);
  const requestedStatuses = url.searchParams.get("status");
  let statuses = ACTIVE_IMPORT_STATUSES;
  if (requestedStatuses) {
    const parsedStatuses = requestedStatuses
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (parsedStatuses.length === 0 || !parsedStatuses.every((value): value is ImportStatus => ALL_IMPORT_STATUSES.includes(value as ImportStatus))) {
      return NextResponse.json({
        error: { code: "INVALID_STATUS_FILTER", message: "Filtro de status inválido.", retryable: false },
      }, { status: 400 });
    }
    statuses = parsedStatuses;
  }

  const rawLimit = Number(url.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 20) : 5;

  try {
    const records = await listUserSourceImports(user.id, { statuses, limit });
    return NextResponse.json({ data: records });
  } catch {
    return NextResponse.json({
      error: { code: "PERSISTENCE_UNAVAILABLE", message: "Não foi possível listar suas importações agora.", retryable: true },
    }, { status: 503 });
  }
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

  try {
    const rateLimit = await checkUserRateLimit({ userId: user.id, route: "imports:create", limit: 5, windowSeconds: 600 });
    if (!rateLimit.allowed) return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Você atingiu o limite de novas importações. Aguarde antes de tentar novamente.", retryable: true } },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  } catch {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Não foi possível verificar o limite de uso. Tente novamente em instantes.", retryable: true } },
      { status: 503 },
    );
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
    const canonicalSourceUrl = source.url.toString();
    const sourceUrlHash = hashSourceUrl(canonicalSourceUrl);
    let cacheHit = null;
    try { cacheHit = await findCachedRecipeByUrl(canonicalSourceUrl); } catch { /* Cache failure must not block a valid import. */ }
    const cachedRecipe = cacheHit?.recipe_draft ?? null;
    const cachedFingerprint = cacheHit?.recipe_fingerprint ?? (cachedRecipe ? fingerprintRecipe(cachedRecipe as import("@/lib/schemas/recipe").RecipeExtraction) : null);
    const result = await createSourceImport({
      user_id: user.id,
      source_url: canonicalSourceUrl,
      platform: source.platform,
      locale: parsed.data.locale,
      servings_target: parsed.data.servings_target ?? null,
      idempotency_key: idempotencyKey,
      source_url_hash: sourceUrlHash,
      ...(cacheHit ? { status: "review_required" as const, recipe_draft: cachedRecipe, source_metadata: cacheHit.source_metadata, recipe_fingerprint: cachedFingerprint } : {}),
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

    if (result.created && cacheHit) {
      return NextResponse.json({ data: record, cache_hit: true }, { status: 200 });
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
      await inngest.send({ name: "recistep/import.requested", data: { id: record.id, user_id: user.id, convert_cups_to_grams: parsed.data.convert_cups_to_grams } });
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
