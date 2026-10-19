import { NextResponse } from "next/server";
import { checkUserRateLimit } from "@/lib/server/rate-limit";
import { recipeApiData } from "@/lib/recipe/recipe-draft";
import { authenticateRequest, isUuid } from "@/lib/server/route-auth";
import { createManualRecipe, getRecipeForUser } from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_ID" } }, { status: 400 });

  try {
    const rateLimit = await checkUserRateLimit({ userId: auth.user.id, route: "recipes:duplicate", limit: 20, windowSeconds: 600 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Você atingiu o limite de duplicação de receitas. Aguarde antes de tentar novamente.", retryable: true } },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }
  } catch {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Não foi possível verificar o limite de uso. Tente novamente em instantes.", retryable: true } },
      { status: 503 },
    );
  }

  try {
    const detail = await getRecipeForUser(id, auth.user.id);
    if (!detail) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Receita não encontrada." } }, { status: 404 });
    const draft = recipeApiData(detail).recipe;
    const title = `${draft.title} (cópia)`.slice(0, 200);
    const created = await createManualRecipe(auth.user.id, { ...draft, title });
    const copy = await getRecipeForUser(created.recipe_id, auth.user.id);
    if (!copy) {
      return NextResponse.json({ error: { code: "RECIPE_DUPLICATE_FAILED", message: "Não foi possível duplicar a receita.", retryable: true } }, { status: 500 });
    }
    return NextResponse.json({ data: recipeApiData(copy) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: { code: "RECIPE_DUPLICATE_FAILED", message: "Não foi possível duplicar a receita.", retryable: true } }, { status: 500 });
  }
}
