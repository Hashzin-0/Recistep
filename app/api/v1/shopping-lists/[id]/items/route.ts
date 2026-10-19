import { NextResponse } from "next/server";
import { z } from "zod";
import { addShoppingItemForUser } from "@/lib/server/supabase-rest";
import { authenticateRequest, isUuid } from "@/lib/server/route-auth";
import { checkUserRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(1_000_000).nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "INVALID_ID" } }, { status: 400 });

  try {
    const rateLimit = await checkUserRateLimit({ userId: auth.user.id, route: "shopping-lists:add-item", limit: 120, windowSeconds: 600 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Muitos itens adicionados em pouco tempo. Aguarde antes de tentar novamente.", retryable: true } },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }
  } catch {
    return NextResponse.json(
      { error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Não foi possível verificar o limite de uso. Tente novamente em instantes.", retryable: true } },
      { status: 503 },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_JSON" } }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Informe ao menos o nome do item." } }, { status: 400 });

  try {
    const data = await addShoppingItemForUser({
      listId: id,
      userId: auth.user.id,
      name: parsed.data.name,
      quantity: parsed.data.quantity ?? null,
      unit: parsed.data.unit ?? null,
      notes: parsed.data.notes ?? null,
    });
    if (!data) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Lista de compras não encontrada." } }, { status: 404 });
    return NextResponse.json({ data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: { code: "SHOPPING_ITEM_CREATE_FAILED", message: "Não foi possível adicionar o item.", retryable: true } }, { status: 500 });
  }
}
