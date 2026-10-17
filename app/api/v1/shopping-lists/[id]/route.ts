import { NextResponse } from "next/server";
import { authenticateSupabaseAccessToken, deleteShoppingListForUser, getShoppingListForUser, getSupabaseConfig } from "@/lib/server/supabase-rest";
import { authenticateRequest, isUuid } from "@/lib/server/route-auth";

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

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_ID" } }, { status: 400 });
  try {
    const deleted = await deleteShoppingListForUser(id, auth.user.id);
    return deleted
      ? NextResponse.json({ data: { id, deleted: true } })
      : NextResponse.json({ error: { code: "NOT_FOUND", message: "Lista não encontrada." } }, { status: 404 });
  } catch {
    return NextResponse.json({ error: { code: "SHOPPING_LIST_DELETE_FAILED", message: "Não foi possível excluir a lista." } }, { status: 500 });
  }
}
