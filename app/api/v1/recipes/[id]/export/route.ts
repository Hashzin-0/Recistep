import { NextResponse } from "next/server";
import { buildRecipePdf, type RecipePdfOptions } from "@/lib/recipe/recipe-pdf";
import { recipeApiData } from "@/lib/recipe/recipe-draft";
import { authenticateRequest, isUuid } from "@/lib/server/route-auth";
import { getRecipeForUser } from "@/lib/server/supabase-rest";
import { checkUserRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

function sanitizeFileName(value: string): string {
  return value.normalize("NFKD").replace(/[^\\w\\s-]/g, "").trim().replace(/\\s+/g, "-").toLowerCase() || "receita";
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) break;
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    i += 2 + length;
  }
  return null;
}

async function loadCoverImage(url: string | null): Promise<RecipePdfOptions["coverImage"]> {
  if (!url) return undefined;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return undefined;
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    const source = Buffer.from(await response.arrayBuffer());
    if (type.includes("jpeg") || type.includes("jpg")) {
      const dimensions = jpegDimensions(source);
      if (dimensions) return { bytes: new Uint8Array(source), width: dimensions.width, height: dimensions.height };
    }
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(source)
      .rotate()
      .resize(220, 220, { fit: "cover", position: "centre" })
      .jpeg({ quality: 86 })
      .toBuffer();
    const dimensions = jpegDimensions(jpeg);
    if (!dimensions) return undefined;
    return { bytes: new Uint8Array(jpeg), width: dimensions.width, height: dimensions.height };
  } catch {
    return undefined;
  }
}

async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { code: "INVALID_RECIPE_ID", message: "Identificador de receita invalido.", retryable: false } }, { status: 400 });
  }

  try {
    const rateLimit = await checkUserRateLimit({ userId: auth.user.id, route: "recipes:export", limit: 20, windowSeconds: 600 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Voce atingiu o limite de exportacoes. Aguarde antes de tentar novamente.", retryable: true } },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }
  } catch {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Nao foi possivel verificar o limite de uso. Tente novamente em instantes.", retryable: true } },
      { status: 503 },
    );
  }

  try {
    const detail = await getRecipeForUser(id, auth.user.id);
    if (!detail) {
      return NextResponse.json({ error: { code: "RECIPE_NOT_FOUND", message: "Receita nao encontrada.", retryable: false } }, { status: 404 });
    }
    const data = recipeApiData(detail);
    const coverUrl = data.cover_image_url ?? data.video_display?.thumbnail_url ?? null;
    const coverImage = await loadCoverImage(coverUrl);
    const bytes = buildRecipePdf(data, { coverImage });
    const fileName = `${sanitizeFileName(data.recipe.title)}.pdf`;
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: { code: "RECIPE_EXPORT_FAILED", message: "Nao foi possivel exportar a receita.", retryable: true } }, { status: 503 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, context);
}
