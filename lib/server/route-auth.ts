import "server-only";
import { NextResponse } from "next/server";
import { authenticateSupabaseAccessToken, getSupabaseConfig } from "@/lib/server/supabase-rest";

export function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 20 && token.length <= 4096 ? token : null;
}

export function unauthorized(message: string): NextResponse {
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message, retryable: false } }, { status: 401 });
}

export function persistenceNotConfigured(): NextResponse {
  return NextResponse.json(
    { error: { code: "PERSISTENCE_NOT_CONFIGURED", message: "A persistência ainda não está configurada.", retryable: false } },
    { status: 503 },
  );
}

export async function authenticateRequest(
  request: Request,
): Promise<{ ok: true; user: { id: string; email?: string } } | { ok: false; response: NextResponse }> {
  if (!getSupabaseConfig()) return { ok: false, response: persistenceNotConfigured() };
  const token = bearerToken(request);
  if (!token) return { ok: false, response: unauthorized("Entre na sua conta para continuar.") };
  try {
    const user = await authenticateSupabaseAccessToken(token);
    return { ok: true, user };
  } catch {
    return { ok: false, response: unauthorized("A sessão é inválida ou expirou.") };
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}
