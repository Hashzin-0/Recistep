import { NextResponse } from "next/server";
import { authenticateRequest, isUuid } from "@/lib/server/route-auth";
import { getRecipeForUser, getSupabaseConfig } from "@/lib/server/supabase-rest";
import { checkUserRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_RECIPE_ID" } }, { status: 400 });
  const limit = await checkUserRateLimit({ userId: auth.user.id, route: "recipe-cover-upload", limit: 20, windowSeconds: 86400 });
  if (!limit.allowed) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Limite de envio de capas atingido." } }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const recipe = await getRecipeForUser(id, auth.user.id).catch(() => null);
  if (!recipe) return NextResponse.json({ error: { code: "RECIPE_NOT_FOUND" } }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !MIME_EXT[file.type] || file.size < 1 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: { code: "INVALID_IMAGE", message: "Envie JPG, PNG ou WebP de até 8 MB." } }, { status: 400 });
  }
  const config = getSupabaseConfig();
  if (!config) return NextResponse.json({ error: { code: "SUPABASE_NOT_CONFIGURED" } }, { status: 503 });
  try {
    const path = `${auth.user.id}/${id}/cover-${crypto.randomUUID()}.${MIME_EXT[file.type]}`;
    const bytes = await file.arrayBuffer();
    const upload = await fetch(`${config.url}/storage/v1/object/recipe-media/${path}`, {
      method: "POST",
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, "Content-Type": file.type, "x-upsert": "false" },
      body: bytes,
      signal: AbortSignal.timeout(20000),
    });
    if (!upload.ok) return NextResponse.json({ error: { code: "IMAGE_UPLOAD_FAILED", message: "Não foi possível enviar a imagem." } }, { status: 502 });
    const url = `${config.url}/storage/v1/object/public/recipe-media/${path}`;
    const update = await fetch(`${config.url}/rest/v1/recipes?id=eq.${id}&user_id=eq.${auth.user.id}`, {
      method: "PATCH",
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ cover_image_url: url, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!update.ok) return NextResponse.json({ error: { code: "RECIPE_IMAGE_SAVE_FAILED" } }, { status: 502 });
    return NextResponse.json({ cover_image_url: url });
  } catch {
    return NextResponse.json({ error: { code: "IMAGE_UPLOAD_FAILED", message: "Não foi possível enviar a imagem." } }, { status: 503 });
  }
}
