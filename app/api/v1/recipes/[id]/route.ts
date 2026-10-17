import { checkUserRateLimit } from "@/lib/server/rate-limit";
import { NextResponse } from "next/server";
import { recipeExtractionSchema } from "@/lib/schemas/recipe";
import { recipeApiData } from "@/lib/recipe/recipe-draft";
import { authenticateRequest, isUuid } from "@/lib/server/route-auth";
import {
  deleteRecipeForUser,
  getRecipeForUser,
  updateRecipeForUser,
} from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ error: { code: "RECIPE_NOT_FOUND", message: "Receita não encontrada.", retryable: false } }, { status: 404 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_RECIPE_ID", message: "Identificador de receita inválido.", retryable: false } }, { status: 400 });
  try {
    const detail = await getRecipeForUser(id, auth.user.id);
    return detail ? NextResponse.json({ data: recipeApiData(detail) }) : notFound();
  } catch {
    return NextResponse.json({ error: { code: "RECIPE_READ_FAILED", message: "Não foi possível carregar a receita.", retryable: true } }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_RECIPE_ID", message: "Identificador de receita inválido.", retryable: false } }, { status: 400 });

  try {
    const rateLimit = await checkUserRateLimit({ userId: auth.user.id, route: "recipes:update", limit: 40, windowSeconds: 600 });
    if (!rateLimit.allowed) return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Você atingiu o limite de edições. Aguarde antes de tentar novamente.", retryable: true } },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
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
    const existing = await getRecipeForUser(id, auth.user.id);
    if (!existing) return notFound();
    await updateRecipeForUser(id, auth.user.id, parsed.data);
    const detail = await getRecipeForUser(id, auth.user.id);
    if (!detail) return notFound();
    return NextResponse.json({ data: recipeApiData(detail) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("RECIPE_NOT_FOUND")) return notFound();
    if (message.includes("INVALID_RECIPE_SHAPE")) {
      return NextResponse.json({ error: { code: "INVALID_RECIPE", message: "A receita precisa de nome, ao menos um ingrediente e uma etapa.", retryable: false } }, { status: 422 });
    }
    return NextResponse.json({ error: { code: "RECIPE_UPDATE_FAILED", message: "Não foi possível atualizar a receita.", retryable: true } }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_RECIPE_ID", message: "Identificador de receita inválido.", retryable: false } }, { status: 400 });

  try {
    const rateLimit = await checkUserRateLimit({ userId: auth.user.id, route: "recipes:delete", limit: 40, windowSeconds: 600 });
    if (!rateLimit.allowed) return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Você atingiu o limite de exclusões. Aguarde antes de tentar novamente.", retryable: true } },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  } catch {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Não foi possível verificar o limite de uso. Tente novamente em instantes.", retryable: true } },
      { status: 503 },
    );
  }

  try {
    const deleted = await deleteRecipeForUser(id, auth.user.id);
    if (!deleted) return notFound();
    return NextResponse.json({ data: { id, deleted: true } });
  } catch {
    return NextResponse.json({ error: { code: "RECIPE_DELETE_FAILED", message: "Não foi possível excluir a receita.", retryable: true } }, { status: 503 });
  }
}
