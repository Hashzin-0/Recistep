import { NextResponse } from "next/server";
import {
  authenticateSupabaseAccessToken,
  getImportStreamSnapshot,
  getSupabaseConfig,
  type ImportStreamSnapshot,
} from "@/lib/server/supabase-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 500;
const HEARTBEAT_MS = 15_000;

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length >= 20 && token.length <= 4096 ? token : null;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isTerminal(status: string): boolean {
  return ["review_required", "completed", "failed", "source_content_required", "cancelled"].includes(status);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
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
      error: { code: "UNAUTHORIZED", message: "Entre na sua conta para acompanhar a extração.", retryable: false },
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

  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* client gone */ }
      };

      let lastSeq = -1;
      let lastStatus = "";
      let lastHeartbeat = Date.now();

      send("retry: 3000\n\n");

      while (!signal.aborted) {
        let snapshot: ImportStreamSnapshot | null = null;
        try {
          snapshot = await getImportStreamSnapshot(id, user.id);
        } catch {
          // Transient read failure: keep tailing.
        }

        if (snapshot) {
          if (snapshot.status !== lastStatus) {
            lastStatus = snapshot.status;
            send(sse("status", { status: snapshot.status }));
          }

          if (
            snapshot.recipe_partial &&
            snapshot.recipe_stream_seq !== lastSeq &&
            !isTerminal(snapshot.status)
          ) {
            lastSeq = snapshot.recipe_stream_seq;
            send(sse("partial", snapshot.recipe_partial));
          }

          if (isTerminal(snapshot.status)) {
            const payload = snapshot.recipe_draft ?? snapshot.recipe_partial;
            if (snapshot.status === "failed" || snapshot.status === "source_content_required" || snapshot.status === "cancelled") {
              send(sse("error", {
                code: snapshot.error_code ?? "EXTRACTION_FAILED",
                message: snapshot.error_message ?? "Não foi possível extrair a receita.",
                status: snapshot.status,
              }));
            } else {
              send(sse("done", payload ?? {}));
            }
            break;
          }
        }

        if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
          lastHeartbeat = Date.now();
          send(": heartbeat\n\n");
        }

        await delay(POLL_MS, signal);
      }

      try { controller.close(); } catch { /* already closed */ }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
