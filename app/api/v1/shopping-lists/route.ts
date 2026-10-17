import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateSupabaseAccessToken, createShoppingListFromRecipes, getShoppingListForUser, getSupabaseConfig } from "@/lib/server/supabase-rest";

export const runtime = "nodejs";
const schema = z.object({ recipe_ids: z.array(z.string().uuid()).min(1).max(50) }).strict();

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !getSupabaseConfig()) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  let user: { id: string };
  try { user = await authenticateSupabaseAccessToken(token); }
  catch { return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }); }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_JSON" } }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Informe uma ou mais receitas confirmadas." } }, { status: 400 });
  try {
    const list = await createShoppingListFromRecipes(user.id, parsed.data.recipe_ids);
    const data = await getShoppingListForUser(list.id, user.id);
    if (!data) return NextResponse.json({ error: { code: "SHOPPING_LIST_NOT_FOUND" } }, { status: 500 });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const forbidden = message.includes("RECIPE_NOT_FOUND_OR_FORBIDDEN") || message.includes("42501");
    return NextResponse.json({ error: { code: forbidden ? "RECIPE_NOT_FOUND_OR_FORBIDDEN" : "SHOPPING_LIST_CREATE_FAILED", message: forbidden ? "Uma ou mais receitas não existem, não estão confirmadas ou não pertencem à sua conta." : "Não foi possível criar a lista de compras." } }, { status: forbidden ? 404 : 500 });
  }
}
