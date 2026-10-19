import { checkUserRateLimit } from "@/lib/server/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateSupabaseAccessToken, createShoppingListFromRecipes, getShoppingListForUser, getSupabaseConfig, listShoppingListsForUser } from "@/lib/server/supabase-rest";
import { authenticateRequest } from "@/lib/server/route-auth";

export const runtime = "nodejs";
const schema = z.object({
  recipe_ids: z.array(z.string().uuid()).min(1).max(50),
  servings: z.array(z.number().positive().max(1000)).optional(),
}).strict().refine((data) => !data.servings || data.servings.length === data.recipe_ids.length, {
  message: "A lista de porções deve ter o mesmo tamanho da lista de receitas.",
});

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const data = await listShoppingListsForUser(auth.user.id);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: { code: "SHOPPING_LISTS_READ_FAILED", message: "Não foi possível carregar suas listas de compras.", retryable: true } }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !getSupabaseConfig()) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  let user: { id: string };
  try { user = await authenticateSupabaseAccessToken(token); }
  catch { return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }); }
  try {
    const rateLimit = await checkUserRateLimit({ userId: user.id, route: "shopping-lists:create", limit: 10, windowSeconds: 600 });
    if (!rateLimit.allowed) return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Você atingiu o limite de criação de listas. Aguarde antes de tentar novamente.", retryable: true } },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  } catch {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Não foi possível verificar o limite de uso. Tente novamente em instantes.", retryable: true } },
      { status: 503 },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_JSON" } }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Informe uma ou mais receitas confirmadas." } }, { status: 400 });
  try {
    const list = await createShoppingListFromRecipes(user.id, parsed.data.recipe_ids, parsed.data.servings);
    const data = await getShoppingListForUser(list.id, user.id);
    if (!data) return NextResponse.json({ error: { code: "SHOPPING_LIST_NOT_FOUND" } }, { status: 500 });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const forbidden = message.includes("RECIPE_NOT_FOUND_OR_FORBIDDEN") || message.includes("42501");
    return NextResponse.json({ error: { code: forbidden ? "RECIPE_NOT_FOUND_OR_FORBIDDEN" : "SHOPPING_LIST_CREATE_FAILED", message: forbidden ? "Uma ou mais receitas não existem, não estão confirmadas ou não pertencem à sua conta." : "Não foi possível criar a lista de compras." } }, { status: forbidden ? 404 : 500 });
  }
}
