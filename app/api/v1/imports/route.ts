import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSourceUrl } from "@/lib/source-url";

export const runtime = "nodejs";

const importRequestSchema = z.object({
  source_url: z.string().trim().min(1).max(2048),
  locale: z.string().trim().min(2).max(20).default("pt-BR"),
  servings_target: z.number().positive().max(100).optional(),
}).strict();

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "O corpo da requisição precisa ser um JSON válido.",
          retryable: false,
        },
      },
      { status: 400 },
    );
  }

  const parsed = importRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Confira o link e os parâmetros enviados.",
          retryable: false,
          fields: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
          })),
        },
      },
      { status: 400 },
    );
  }

  const source = validateSourceUrl(parsed.data.source_url);

  if (!source.ok) {
    return NextResponse.json(
      {
        error: {
          code: source.code,
          message: source.message,
          retryable: false,
        },
      },
      { status: 422 },
    );
  }

  // Deliberately do not report a queued import until a durable queue and an
  // authorized source connector are configured. URL validation is not access
  // to the source media and does not imply that extraction has started.
  return NextResponse.json(
    {
      error: {
        code: "IMPORT_PIPELINE_NOT_CONFIGURED",
        message:
          "O link foi validado, mas o processamento de mídia ainda não está configurado neste ambiente.",
        retryable: false,
        platform: source.platform,
      },
    },
    { status: 503 },
  );
}
