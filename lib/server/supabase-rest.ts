import "server-only";

export type ImportStatus =
  | "queued"
  | "processing"
  | "source_content_required"
  | "review_required"
  | "completed"
  | "failed"
  | "cancelled";

export type SourceImportRecord = {
  id: string;
  user_id: string;
  source_url: string;
  platform: "youtube" | "tiktok" | "instagram";
  locale: string;
  servings_target: number | null;
  idempotency_key: string;
  status: ImportStatus;
  source_metadata: Record<string, unknown> | null;
  source_transcript: string | null;
  recipe_draft: unknown | null;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
};

export type SourceMetadata = {
  title: string;
  author_name: string | null;
  provider_name: string | null;
  thumbnail_url: string | null;
};

type SupabaseConfig = { url: string; anonKey: string; serviceKey: string };

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey || !serviceKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return null;
  } catch {
    return null;
  }
  return { url, anonKey, serviceKey };
}

async function supabaseRequest<T>(
  path: string,
  init: RequestInit = {},
  config = getSupabaseConfig(),
): Promise<T> {
  if (!config) throw new Error("SUPABASE_NOT_CONFIGURED");
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(8_000),
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`SUPABASE_HTTP_${response.status}:${text.slice(0, 300)}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function authenticateSupabaseAccessToken(
  accessToken: string,
): Promise<{ id: string; email?: string }> {
  const config = getSupabaseConfig();
  if (!config) throw new Error("SUPABASE_NOT_CONFIGURED");

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });

  if (!response.ok) throw new Error("UNAUTHORIZED");
  const user = (await response.json()) as { id?: unknown; email?: unknown };
  if (typeof user.id !== "string" || !/^[0-9a-f-]{36}$/i.test(user.id)) {
    throw new Error("UNAUTHORIZED");
  }

  return {
    id: user.id,
    ...(typeof user.email === "string" ? { email: user.email } : {}),
  };
}

export async function createSourceImport(input: {
  user_id: string;
  source_url: string;
  platform: SourceImportRecord["platform"];
  locale: string;
  servings_target: number | null;
  idempotency_key: string;
}): Promise<{ record: SourceImportRecord; created: boolean }> {
  try {
    const records = await supabaseRequest<SourceImportRecord[]>(
      "source_imports?select=*",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(input),
      },
    );
    if (!records[0]) throw new Error("SUPABASE_EMPTY_INSERT");
    return { record: records[0], created: true };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("SUPABASE_HTTP_409")) {
      throw error;
    }
    const params = new URLSearchParams({
      select: "*",
      user_id: `eq.${input.user_id}`,
      idempotency_key: `eq.${input.idempotency_key}`,
      limit: "1",
    });
    const records = await supabaseRequest<SourceImportRecord[]>(
      `source_imports?${params.toString()}`,
    );
    if (!records[0]) throw error;
    return { record: records[0], created: false };
  }
}

export async function getSourceImport(id: string): Promise<SourceImportRecord | null> {
  const params = new URLSearchParams({ select: "*", id: `eq.${id}`, limit: "1" });
  const records = await supabaseRequest<SourceImportRecord[]>(
    `source_imports?${params.toString()}`,
  );
  return records[0] ?? null;
}

export async function updateSourceImport(
  id: string,
  patch: Partial<Pick<
    SourceImportRecord,
    "status" | "source_metadata" | "source_transcript" | "recipe_draft" | "error_code" | "error_message" | "attempt_count"
  >>,
): Promise<void> {
  const params = new URLSearchParams({ id: `eq.${id}` });
  await supabaseRequest<unknown>(`source_imports?${params.toString()}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export async function getUserSourceImport(
  id: string,
  userId: string,
): Promise<SourceImportRecord | null> {
  const params = new URLSearchParams({
    select: "id,user_id,source_url,platform,locale,servings_target,status,source_metadata,recipe_draft,error_code,error_message,attempt_count,created_at,updated_at",
    id: `eq.${id}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const records = await supabaseRequest<SourceImportRecord[]>(
    `source_imports?${params.toString()}`,
  );
  return records[0] ?? null;
}

export async function saveSourceMetadata(id: string, metadata: SourceMetadata): Promise<void> {
  await updateSourceImport(id, {
    status: "source_content_required",
    source_metadata: metadata,
    error_code: "SOURCE_CONTENT_UNAVAILABLE",
    error_message:
      "Os metadados públicos foram obtidos, mas a transcrição/conteúdo da receita não está disponível por um conector autorizado.",
  });
}
