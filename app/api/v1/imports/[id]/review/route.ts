import { NextResponse } from "next/server";
import { recipeExtractionSchema } from "@/lib/schemas/recipe";
import { fingerprintRecipe } from "@/lib/recipe/fingerprint";
import {
  authenticateSupabaseAccessToken,
  getSupabaseConfig,
  getUserSourceImport,
  updateSourceImport,
} from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 20 && token.length <= 4096 ? token : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!getSupabaseConfig()) {
    return NextResponse.json({ error: { code: "PERSISTENCE_NOT_CONFIGURED", message: "A persistência ainda não está configurada.", retryable: false } }, { status: 503 });
  }

  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Entre na sua conta para revisar a receita.", retryable: false } }, { status: 401 });
  }

  let user: { id: string };
  try {
    user = await authenticateSupabaseAccessToken(token);
  } catch {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "A sessão é inválida ou expirou.", retryable: false } }, { status: 401 });
  }

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: { code: "INVALID_IMPORT_ID", message: "Identificador de importação inválido.", retryable: false } }, { status: 400 });
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 100_000) {
      return NextResponse.json({ error: { code: "REQUEST_TOO_LARGE", message: "A revisão ultrapassa o limite permitido.", retryable: false } }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Envie um JSON válido.", retryable: false } }, { status: 400 });
  }

  const parsed = recipeExtractionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({
      error: { code: "INVALID_RECIPE", message: "Revise os campos da receita e tente novamente.", retryable: false, fields: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })) },
    }, { status: 422 });
  }

  try {
    const record = await getUserSourceImport(id, user.id);
    if (!record) {
      return NextResponse.json({ error: { code: "IMPORT_NOT_FOUND", message: "Importação não encontrada.", retryable: false } }, { status: 404 });
    }
    if (record.status !== "review_required") {
      return NextResponse.json({ error: { code: "IMPORT_NOT_READY_FOR_REVIEW", message: "Esta importação não está aguardando revisão.", retryable: false } }, { status: 409 });
    }

    await updateSourceImport(id, { recipe_draft: parsed.data, recipe_fingerprint: fingerprintRecipe(parsed.data) });
    return NextResponse.json({ data: { id, status: "review_required", recipe_draft: parsed.data } });
  } catch {
    return NextResponse.json({ error: { code: "PERSISTENCE_UNAVAILABLE", message: "Não foi possível salvar a revisão agora.", retryable: true } }, { status: 503 });
  }
}
