import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateSupabaseAccessToken, getSupabaseConfig, setShoppingItemPurchased } from "@/lib/server/supabase-rest";

export const runtime = "nodejs";
const schema = z.object({ is_purchased: z.boolean() }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string; itemId: string }> }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !getSupabaseConfig()) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  let user: { id: string };
  try { user = await authenticateSupabaseAccessToken(token); }
  catch { return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }); }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_JSON" } }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  const { id, itemId } = await context.params;
  if (![id, itemId].every((value) => /^[0-9a-f-]{36}$/i.test(value))) return NextResponse.json({ error: { code: "INVALID_ID" } }, { status: 400 });
  try {
    const data = await setShoppingItemPurchased({ listId: id, itemId, userId: user.id, isPurchased: parsed.data.is_purchased });
    return data ? NextResponse.json({ data }) : NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  } catch { return NextResponse.json({ error: { code: "SHOPPING_ITEM_UPDATE_FAILED" } }, { status: 500 }); }
}
