import "server-only";
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { authenticateSupabaseAccessToken, getSupabaseConfig } from "@/lib/server/supabase-rest";
import { checkUserRateLimit } from "@/lib/server/rate-limit";
import { liveModelId, liveTokenTtlMinutes, liveVoiceName, LIVE_WS_BASE_URL } from "@/lib/voice/live-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 20 && token.length <= 4096 ? token : null;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  headers?: Record<string, string>,
) {
  return NextResponse.json({ error: { code, message, retryable } }, { status, headers });
}

export async function POST(request: Request) {
  if (!getSupabaseConfig()) {
    return errorResponse(
      503,
      "VOICE_NOT_CONFIGURED",
      "Configure as variáveis do Supabase no ambiente de servidor antes de usar a voz.",
      false,
    );
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return errorResponse(
      503,
      "VOICE_NOT_CONFIGURED",
      "Configure GEMINI_API_KEY no ambiente de servidor antes de usar a voz.",
      false,
    );
  }

  const token = bearerToken(request);
  if (!token) {
    return errorResponse(401, "UNAUTHORIZED", "Entre na sua conta para usar o assistente de voz.", false);
  }

  let user: { id: string };
  try {
    user = await authenticateSupabaseAccessToken(token);
  } catch {
    return errorResponse(401, "UNAUTHORIZED", "A sessão é inválida ou expirou.", false);
  }

  try {
    const rateLimit = await checkUserRateLimit({
      userId: user.id,
      route: "voice:token",
      limit: 10,
      windowSeconds: 600,
    });
    if (!rateLimit.allowed) {
      return errorResponse(
        429,
        "RATE_LIMITED",
        "Você atingiu o limite de sessões de voz. Aguarde antes de conectar novamente.",
        true,
        { "Retry-After": String(rateLimit.retryAfterSeconds) },
      );
    }
  } catch {
    return errorResponse(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "Não foi possível verificar o limite de uso. Tente novamente em instantes.",
      true,
    );
  }

  const ttlMinutes = liveTokenTtlMinutes();
  const now = Date.now();
  const expireTime = new Date(now + ttlMinutes * 60_000);
  const newSessionExpireTime = new Date(now + 60_000);

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1beta" },
    });

    const ephemeral = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expireTime.toISOString(),
        newSessionExpireTime: newSessionExpireTime.toISOString(),
      },
    });

    if (!ephemeral.name) {
      return errorResponse(
        503,
        "VOICE_TOKEN_UNAVAILABLE",
        "O provedor não devolveu uma credencial de voz válida. Tente novamente.",
        true,
      );
    }

    return NextResponse.json({
      data: {
        token: ephemeral.name,
        expires_at: expireTime.toISOString(),
        new_session_expires_at: newSessionExpireTime.toISOString(),
        model: liveModelId(),
        voice: liveVoiceName(),
        ws_base_url: LIVE_WS_BASE_URL,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const providerUnavailable = /429|500|502|503|quota|rate|temporar|internal/i.test(detail);
    return errorResponse(
      providerUnavailable ? 503 : 502,
      providerUnavailable ? "VOICE_TOKEN_TEMPORARILY_UNAVAILABLE" : "VOICE_TOKEN_FAILED",
      providerUnavailable
        ? "O provedor de voz recusou a solicitação. Tente novamente em instantes."
        : "Não foi possível emitir a credencial de voz.",
      providerUnavailable,
    );
  }
}
