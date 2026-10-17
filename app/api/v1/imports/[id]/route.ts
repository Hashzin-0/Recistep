import { NextResponse } from "next/server";
import { authenticateSupabaseAccessToken, getUserSourceImport, getSupabaseConfig } from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 20 && token.length <= 4096 ? token : null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!getSupabaseConfig()) {
    return NextResponse.json({
      error: { code: "PERSISTENCE_NOT_CONFIGURED", message: "A persistência ainda não está configurada.", retryable: false },
    }, { status: 503 });
  }

  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json({
      error: { code: "UNAUTHORIZED", message: "Entre na sua conta para consultar a importação.", retryable: false },
    }, { status: 401 });
  }

  let user: { id: string };
  try {
    user = await authenticateSupabaseAccessToken(token);
  } catch {
    return NextResponse.json({
      error: { code: "UNAUTHORIZED", message: "A sessão é inválida ou expirou.", retryable: false },
    }, { status: 401 });
  }

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({
      error: { code: "INVALID_IMPORT_ID", message: "Identificador de importação inválido.", retryable: false },
    }, { status: 400 });
  }

  try {
    const record = await getUserSourceImport(id, user.id);
    if (!record) {
      return NextResponse.json({
        error: { code: "IMPORT_NOT_FOUND", message: "Importação não encontrada.", retryable: false },
      }, { status: 404 });
    }
    return NextResponse.json({ data: record });
  } catch {
    return NextResponse.json({
      error: { code: "PERSISTENCE_UNAVAILABLE", message: "Não foi possível consultar a importação agora.", retryable: true },
    }, { status: 503 });
  }
}
