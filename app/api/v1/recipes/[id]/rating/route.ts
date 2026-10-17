import { NextResponse } from "next/server";
import { authenticateRequest, isUuid } from "@/lib/server/route-auth";
import { getRecipeForUser, getSupabaseConfig } from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_RECIPE_ID" } }, { status: 400 });
  try {
    if (!await getRecipeForUser(id, auth.user.id)) return NextResponse.json({ error: { code: "RECIPE_NOT_FOUND" } }, { status: 404 });
    const config = getSupabaseConfig();
    if (!config) throw new Error("SUPABASE_NOT_CONFIGURED");
    const response = await fetch(`${config.url}/rest/v1/recipe_ratings?select=rating,user_id&recipe_id=eq.${id}`, {
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("RATINGS_READ_FAILED");
    const rows = await response.json() as { rating: number; user_id: string }[];
    const average = rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : null;
    return NextResponse.json({ data: { average, count: rows.length, userRating: rows.find((row) => row.user_id === auth.user.id)?.rating ?? null } });
  } catch {
    return NextResponse.json({ error: { code: "RATINGS_UNAVAILABLE", message: "Não foi possível carregar as avaliações." } }, { status: 503 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_RECIPE_ID" } }, { status: 400 });
  const body = await request.json().catch(() => null) as { rating?: unknown } | null;
  if (!body || !Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5) {
    return NextResponse.json({ error: { code: "INVALID_RATING", message: "Escolha de 1 a 5 estrelas." } }, { status: 400 });
  }
  try {
    if (!await getRecipeForUser(id, auth.user.id)) return NextResponse.json({ error: { code: "RECIPE_NOT_FOUND" } }, { status: 404 });
    const config = getSupabaseConfig();
    if (!config) throw new Error("SUPABASE_NOT_CONFIGURED");
    const response = await fetch(`${config.url}/rest/v1/recipe_ratings?on_conflict=recipe_id,user_id`, {
      method: "POST",
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ recipe_id: id, user_id: auth.user.id, rating: body.rating, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("RATING_SAVE_FAILED");
    return GET(new Request(request.url, { headers: request.headers }), context);
  } catch {
    return NextResponse.json({ error: { code: "RATING_SAVE_FAILED", message: "Não foi possível salvar sua avaliação." } }, { status: 503 });
  }
}
