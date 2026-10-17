import { NextResponse } from "next/server";
import { authenticateRequest, isUuid } from "@/lib/server/route-auth";
import { getRecipeForUser, getSupabaseConfig } from "@/lib/server/supabase-rest";
import { draftFromDbRecipe } from "@/lib/recipe/recipe-draft";
import { checkUserRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
const MODEL = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_RECIPE_ID" } }, { status: 400 });
  const limit = await checkUserRateLimit({ userId: auth.user.id, route: "recipe-flowchart", limit: 3, windowSeconds: 3600 });
  if (!limit.allowed) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Limite de geração atingido. Tente novamente mais tarde." } }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const recipe = await getRecipeForUser(id, auth.user.id).catch(() => null);
  if (!recipe) return NextResponse.json({ error: { code: "RECIPE_NOT_FOUND" } }, { status: 404 });
  const config = getSupabaseConfig();
  if (!config) return NextResponse.json({ error: { code: "SUPABASE_NOT_CONFIGURED" } }, { status: 503 });
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: { code: "GEMINI_NOT_CONFIGURED", message: "Configure GEMINI_API_KEY no servidor." } }, { status: 503 });

  const recipeDraft = draftFromDbRecipe(recipe.recipe, recipe.ingredients, recipe.steps);
  const title = recipeDraft.title.slice(0, 200);
  const steps = recipeDraft.steps.slice().sort((a, b) => a.position - b.position).slice(0, 30).map((step) => step.instruction.slice(0, 500)).filter(Boolean);
  if (!steps.length) return NextResponse.json({ error: { code: "RECIPE_STEPS_REQUIRED", message: "A receita precisa ter etapas para gerar o fluxograma." } }, { status: 400 });

  try {
    const prompt = [
      "Crie uma única imagem em formato infográfico de fluxograma culinário em português brasileiro.",
      "Mostre cada etapa em cartões numerados conectados por setas, com pequenas ilustrações claras dos utensílios e ações.",
      "Layout vertical, fundo claro, alto contraste, texto curto e legível, sem ingredientes ou passos que não estejam na lista.",
      "Não invente etapas; mantenha a ordem fornecida. Não use marcas d'água.",
      `Receita: ${title}`,
      ...steps.map((step, index) => `${index + 1}. ${step}`),
    ].join("\n");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], responseFormat: { image: { aspectRatio: "3:4", imageSize: "1K" } } } }),
      signal: AbortSignal.timeout(90000),
    });
    const payload = await response.json().catch(() => null) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }[] } }[]; error?: { message?: string } } | null;
    if (!response.ok) {
      console.error("[recipe-flowchart] Gemini rejected request", response.status, payload?.error?.message?.slice(0, 300));
      return NextResponse.json({ error: { code: response.status === 404 ? "GEMINI_IMAGE_MODEL_UNAVAILABLE" : "GEMINI_IMAGE_GENERATION_FAILED", message: response.status === 404 ? "O modelo configurado não está disponível para geração de imagens nesta conta." : "O Gemini não conseguiu gerar o fluxograma." } }, { status: response.status === 404 ? 503 : 502 });
    }
    const parts = payload?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((part) => part.inlineData?.data || part.inline_data?.data);
    const base64 = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;
    const mime = imagePart?.inlineData?.mimeType ?? imagePart?.inline_data?.mime_type ?? "image/png";
    if (!base64 || !/^image\/(png|jpeg|webp)$/.test(mime)) {
      return NextResponse.json({ error: { code: "GEMINI_RETURNED_NO_IMAGE", message: "O modelo não retornou uma imagem. Verifique se ele oferece geração de imagens na API." } }, { status: 502 });
    }
    const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
    const path = `${auth.user.id}/${id}/flowchart-${crypto.randomUUID()}.${ext}`;
    const binary = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    if (binary.byteLength > 8 * 1024 * 1024) return NextResponse.json({ error: { code: "FLOWCHART_TOO_LARGE" } }, { status: 502 });
    const upload = await fetch(`${config.url}/storage/v1/object/recipe-media/${path}`, {
      method: "POST",
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, "Content-Type": mime, "x-upsert": "false" },
      body: binary,
      signal: AbortSignal.timeout(20000),
    });
    if (!upload.ok) return NextResponse.json({ error: { code: "FLOWCHART_UPLOAD_FAILED", message: "A imagem foi gerada, mas não pôde ser salva." } }, { status: 502 });
    const url = `${config.url}/storage/v1/object/public/recipe-media/${path}`;
    const update = await fetch(`${config.url}/rest/v1/recipes?id=eq.${id}&user_id=eq.${auth.user.id}`, {
      method: "PATCH",
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ preparation_flowchart_url: url, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!update.ok) return NextResponse.json({ error: { code: "FLOWCHART_SAVE_FAILED" } }, { status: 502 });
    return NextResponse.json({ preparation_flowchart_url: url, model: MODEL });
  } catch {
    return NextResponse.json({ error: { code: "FLOWCHART_GENERATION_FAILED", message: "Não foi possível gerar o fluxograma agora." } }, { status: 503 });
  }
}
