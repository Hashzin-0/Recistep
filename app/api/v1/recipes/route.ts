import { checkUserRateLimit } from "@/lib/server/rate-limit";
import { NextResponse } from "next/server";
import { recipeExtractionSchema } from "@/lib/schemas/recipe";
import { recipeApiData } from "@/lib/recipe/recipe-draft";
import { authenticateRequest } from "@/lib/server/route-auth";
import {
  createManualRecipe,
  getRecipeForUser,
  listRecipesForUser,
  searchRecipesByIngredient,
} from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const ingredient = new URL(request.url).searchParams.get("ingredient")?.trim();
  try {
    const data = ingredient
      ? await searchRecipesByIngredient(auth.user.id, ingredient)
      : await listRecipesForUser(auth.user.id);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: { code: "RECIPES_READ_FAILED", message: "Não foi possível carregar suas receitas.", retryable: true } }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const rateLimit = await checkUserRateLimit({ userId: auth.user.id, route: "recipes:create", limit: 20, windowSeconds: 600 });
    if (!rateLimit.allowed) return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Você atingiu o limite de criação de receitas. Aguarde antes de tentar novamente.", retryable: true } },
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
    const created = await createManualRecipe(auth.user.id, parsed.data);
    const detail = await getRecipeForUser(created.recipe_id, auth.user.id);
    if (!detail) {
      return NextResponse.json({ error: { code: "RECIPE_CREATE_FAILED", message: "Não foi possível salvar a receita. Tente novamente.", retryable: true } }, { status: 503 });
    }
    return NextResponse.json({ data: recipeApiData(detail) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("INVALID_RECIPE_SHAPE")) {
      return NextResponse.json({ error: { code: "INVALID_RECIPE", message: "A receita precisa de nome, ao menos um ingrediente e uma etapa.", retryable: false } }, { status: 422 });
    }
    return NextResponse.json({ error: { code: "RECIPE_CREATE_FAILED", message: "Não foi possível salvar a receita. Tente novamente.", retryable: true } }, { status: 503 });
  }
}
