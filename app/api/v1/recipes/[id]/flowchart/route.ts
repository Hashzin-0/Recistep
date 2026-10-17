import { NextResponse } from "next/server";
import { authenticateRequest, isUuid } from "@/lib/server/route-auth";
import { getRecipeForUser, getSupabaseConfig } from "@/lib/server/supabase-rest";
import { draftFromDbRecipe } from "@/lib/recipe/recipe-draft";
import { checkUserRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";

function sanitizeSvg(raw: string): string | null {
  const svg = raw.replace(/^```(?:svg|xml)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  if (!/^<svg\b[\s\S]*<\/svg>$/i.test(svg) || svg.length > 2_000_000) return null;
  if (/<\s*(script|foreignObject|iframe|image|use|audio|video|style|link|!DOCTYPE|!ENTITY)\b/i.test(svg) || /\bon\w+\s*=/i.test(svg) || /(?:javascript:|data:|https?:|url\s*\((?!\s*#[\w-]+\s*\)))/i.test(svg)) return null;
  const tags = new Set(["svg", "g", "rect", "text", "tspan", "line", "path", "circle", "ellipse", "polygon", "polyline", "defs", "marker"]);
  const attrs = new Set(["xmlns", "width", "height", "viewBox", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "stroke", "stroke-width", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline", "transform", "opacity", "marker-end", "id", "refX", "refY", "markerWidth", "markerHeight", "orient"]);
  let valid = true;
  const sanitized = svg.replace(/<\/?([A-Za-z][\w:-]*)\b([^>]*)>/g, (tag, tagName: string, rawAttrs: string) => {
    if (!tags.has(tagName)) { valid = false; return ""; }
    if (tag.startsWith("</")) return `</${tagName}>`;
    let kept = "";
    const attrPattern = /([A-Za-z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g;
    let match: RegExpExecArray | null;
    while ((match = attrPattern.exec(rawAttrs))) {
      if (!attrs.has(match[1])) { valid = false; continue; }
      if (/[<>]/.test(match[2])) { valid = false; continue; }
      kept += ` ${match[1]}=${match[2]}`;
    }
    return `<${tagName}${kept}${/\/\s*>$/.test(tag) ? "/>" : ">"}`;
  });
  if (!valid || !sanitized.startsWith("<svg") || !sanitized.endsWith("</svg>")) return null;
  return sanitized;
}

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
      "Gere um fluxograma culinário como um único documento SVG válido, completo e autocontido, em português brasileiro.",
      "Retorne SOMENTE o SVG, sem Markdown ou explicações. Use viewBox=\"0 0 900 1200\", fundo claro, título no topo, cartões arredondados numerados conectados por setas e tipografia legível.",
      "Use apenas elementos SVG básicos: svg, g, rect, text, tspan, line, path, circle, ellipse, polygon, polyline, defs e marker. Não use script, style, imagem externa, links, animação, foreignObject nem atributos de evento.",
      "Organize as etapas verticalmente, mantenha texto curto e legível e não invente etapas ou ingredientes. Inclua todas as etapas fornecidas na ordem.",
      `Receita: ${title}`,
      ...steps.map((step, index) => `${index + 1}. ${step}`),
    ].join("\n");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 12000 } }),
      signal: AbortSignal.timeout(90000),
    });
    const payload = await response.json().catch(() => null) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } } | null;
    if (!response.ok) {
      console.error("[recipe-flowchart] Gemini rejected request", response.status, payload?.error?.message?.slice(0, 300));
      return NextResponse.json({ error: { code: "GEMINI_FLOWCHART_FAILED", message: "O Gemini não conseguiu gerar o fluxograma." } }, { status: 502 });
    }
    const svgText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
    const svg = sanitizeSvg(svgText);
    if (!svg) return NextResponse.json({ error: { code: "GEMINI_RETURNED_INVALID_SVG", message: "O Gemini não retornou um SVG válido e seguro. Tente novamente." } }, { status: 502 });
    const mime = "image/svg+xml";
    const ext = "svg";
    const path = `${auth.user.id}/${id}/flowchart-${crypto.randomUUID()}.${ext}`;
    const binary = new TextEncoder().encode(svg);
    if (binary.byteLength > 8 * 1024 * 1024) return NextResponse.json({ error: { code: "FLOWCHART_TOO_LARGE" } }, { status: 502 });
    const upload = await fetch(`${config.url}/storage/v1/object/recipe-media/${path}`, {
      method: "POST",
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, "Content-Type": mime, "x-upsert": "false" },
      body: binary,
      signal: AbortSignal.timeout(20000),
    });
    if (!upload.ok) return NextResponse.json({ error: { code: "FLOWCHART_UPLOAD_FAILED", message: "O fluxograma foi gerado, mas não pôde ser salvo." } }, { status: 502 });
    const url = `${config.url}/storage/v1/object/public/recipe-media/${path}`;
    const update = await fetch(`${config.url}/rest/v1/recipes?id=eq.${id}&user_id=eq.${auth.user.id}`, {
      method: "PATCH",
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ preparation_flowchart_url: url, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!update.ok) return NextResponse.json({ error: { code: "FLOWCHART_SAVE_FAILED" } }, { status: 502 });
    return NextResponse.json({ preparation_flowchart_url: url, model: MODEL, format: "svg" });
  } catch {
    return NextResponse.json({ error: { code: "FLOWCHART_GENERATION_FAILED", message: "Não foi possível gerar o fluxograma agora." } }, { status: 503 });
  }
}
