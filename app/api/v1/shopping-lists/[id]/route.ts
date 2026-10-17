import { NextResponse } from "next/server";
import { authenticateSupabaseAccessToken, getShoppingListForUser, getSupabaseConfig } from "@/lib/server/supabase-rest";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !getSupabaseConfig()) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  let user: { id: string };
  try { user = await authenticateSupabaseAccessToken(token); }
  catch { return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }); }
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: { code: "INVALID_ID" } }, { status: 400 });
  try {
    const data = await getShoppingListForUser(id, user.id);
    return data ? NextResponse.json({ data }) : NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  } catch { return NextResponse.json({ error: { code: "SHOPPING_LIST_READ_FAILED" } }, { status: 500 }); }
}
