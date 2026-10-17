import { NextResponse } from "next/server";
import { recipeExtractionSchema } from "@/lib/schemas/recipe";
import {
  authenticateSupabaseAccessToken,
  confirmRecipeFromImport,
  getSupabaseConfig,
  getUserSourceImport,
} from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

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
  if (!getSupabaseConfig()) {
    return NextResponse.json({ error: { code: "PERSISTENCE_NOT_CONFIGURED", message: "A persistência ainda não está configurada.", retryable: false } }, { status: 503 });
  }

  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Entre na sua conta para confirmar a receita.", retryable: false } }, { status: 401 });
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
      return NextResponse.json({ error: { code: "REQUEST_TOO_LARGE", message: "A receita ultrapassa o limite permitido.", retryable: false } }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Envie um JSON válido.", retryable: false } }, { status: 400 });
  }

  const parsed = recipeExtractionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_RECIPE", message: "Revise os campos obrigatórios da receita.", retryable: false } }, { status: 422 });
  }

  try {
    const record = await getUserSourceImport(id, user.id);
    if (!record) {
      return NextResponse.json({ error: { code: "IMPORT_NOT_FOUND", message: "Importação não encontrada.", retryable: false } }, { status: 404 });
    }
    if (record.status !== "review_required" && record.status !== "completed") {
      return NextResponse.json({ error: { code: "IMPORT_NOT_READY_FOR_REVIEW", message: "A importação ainda não tem um rascunho pronto para confirmar.", retryable: false } }, { status: 409 });
    }

    const result = await confirmRecipeFromImport({ import_id: id, user_id: user.id, recipe: parsed.data });
    return NextResponse.json({ data: { ...result, status: "completed" } }, { status: result.already_confirmed ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("IMPORT_NOT_FOUND")) {
      return NextResponse.json({ error: { code: "IMPORT_NOT_FOUND", message: "Importação não encontrada.", retryable: false } }, { status: 404 });
    }
    if (message.includes("IMPORT_NOT_READY_FOR_REVIEW")) {
      return NextResponse.json({ error: { code: "IMPORT_NOT_READY_FOR_REVIEW", message: "A importação não está pronta para confirmação.", retryable: false } }, { status: 409 });
    }
    return NextResponse.json({ error: { code: "RECIPE_CONFIRMATION_FAILED", message: "Não foi possível confirmar e salvar a receita. Tente novamente.", retryable: true } }, { status: 503 });
  }
}
