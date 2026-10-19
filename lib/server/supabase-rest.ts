import "server-only";
import { recipeSummary, type DbIngredientRow, type DbRecipeRow, type DbStepRow, type DbUtensilRow, type RecipeDetail, type RecipeSummary } from "@/lib/recipe/recipe-draft";

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
  recipe_id?: string | null;
  source_url_hash?: string | null;
  source_content_hash?: string | null;
  recipe_fingerprint?: string | null;
  source_metadata: Record<string, unknown> | null;
  source_transcript: string | null;
  recipe_draft: unknown | null;
  recipe_partial?: unknown | null;
  recipe_stream_seq?: number;
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
  source_url_hash?: string;
  status?: ImportStatus;
  recipe_draft?: unknown | null;
  source_metadata?: Record<string, unknown> | null;
  recipe_fingerprint?: string | null;
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
    "status" | "source_metadata" | "source_transcript" | "recipe_draft" | "recipe_partial" | "recipe_stream_seq" | "error_code" | "error_message" | "attempt_count" | "source_url_hash" | "source_content_hash" | "recipe_fingerprint"
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
    select: "id,user_id,source_url,platform,locale,servings_target,status,recipe_id,source_url_hash,source_content_hash,recipe_fingerprint,source_metadata,recipe_draft,error_code,error_message,attempt_count,created_at,updated_at",
    id: `eq.${id}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const records = await supabaseRequest<SourceImportRecord[]>(
    `source_imports?${params.toString()}`,
  );
  return records[0] ?? null;
}

export type ImportStreamSnapshot = {
  status: ImportStatus;
  recipe_draft: unknown | null;
  recipe_partial: unknown | null;
  recipe_stream_seq: number;
  error_code: string | null;
  error_message: string | null;
};

// Lean read used by the SSE tailing endpoint. Deliberately excludes the raw
// transcript and heavy metadata.
export async function getImportStreamSnapshot(
  id: string,
  userId: string,
): Promise<ImportStreamSnapshot | null> {
  const params = new URLSearchParams({
    select: "status,recipe_draft,recipe_partial,recipe_stream_seq,error_code,error_message",
    id: `eq.${id}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const records = await supabaseRequest<ImportStreamSnapshot[]>(
    `source_imports?${params.toString()}`,
  );
  return records[0] ?? null;
}




export type ShoppingListItemRecord = {
  id: string; shopping_list_id: string; name: string; normalized_name: string;
  quantity: number | null; unit: string | null; notes: string | null; is_purchased: boolean;
  source_recipe_ids: string[]; source_ingredient_ids: string[]; position: number;
};
export type ShoppingListRecord = {
  id: string; title: string; created_at: string; updated_at: string; items: ShoppingListItemRecord[];
};
export async function createShoppingListFromRecipes(userId: string, recipeIds: string[]): Promise<{ id: string; title: string }> {
  const result = await supabaseRequest<{ id: string; title: string } | Array<{ id: string; title: string }>>(
    "rpc/create_shopping_list_from_recipes",
    { method: "POST", body: JSON.stringify({ p_user_id: userId, p_recipe_ids: recipeIds }) },
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row.id !== "string") throw new Error("SHOPPING_LIST_CREATE_EMPTY");
  return row;
}
export async function getShoppingListForUser(listId: string, userId: string): Promise<ShoppingListRecord | null> {
  const params = new URLSearchParams({ select: "id,title,created_at,updated_at", id: "eq." + listId, user_id: "eq." + userId, limit: "1" });
  const lists = await supabaseRequest<Omit<ShoppingListRecord, "items">[]>("shopping_lists?" + params.toString());
  const list = lists[0];
  if (!list) return null;
  const itemParams = new URLSearchParams({
    select: "id,shopping_list_id,name,normalized_name,quantity,unit,notes,is_purchased,source_recipe_ids,source_ingredient_ids,position",
    shopping_list_id: "eq." + listId, order: "position.asc",
  });
  const items = await supabaseRequest<ShoppingListItemRecord[]>("shopping_list_items?" + itemParams.toString());
  return { ...list, items };
}
export async function setShoppingItemPurchased(input: {
  listId: string; itemId: string; userId: string; isPurchased: boolean;
}): Promise<ShoppingListItemRecord | null> {
  const listParams = new URLSearchParams({ select: "id", id: "eq." + input.listId, user_id: "eq." + input.userId, limit: "1" });
  const lists = await supabaseRequest<Array<{ id: string }>>("shopping_lists?" + listParams.toString());
  if (!lists[0]) return null;
  const itemParams = new URLSearchParams({ select: "id,shopping_list_id,name,normalized_name,quantity,unit,notes,is_purchased,source_recipe_ids,source_ingredient_ids,position", id: "eq." + input.itemId, shopping_list_id: "eq." + input.listId });
  const rows = await supabaseRequest<ShoppingListItemRecord[]>("shopping_list_items?" + itemParams.toString(), {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ is_purchased: input.isPurchased, updated_at: new Date().toISOString() }),
  });
  return rows[0] ?? null;
}
type RecipeListRow = DbRecipeRow & {
  ingredients: { count: number }[] | null;
  preparation_steps: { count: number }[] | null;
};

type RecipeDetailRow = DbRecipeRow & {
  ingredients: DbIngredientRow[] | null;
  preparation_steps: DbStepRow[] | null;
  recipe_utensils: DbUtensilRow[] | null;
};

const RECIPE_COLUMNS = "id,user_id,source_import_id,title,description,source_url,source_language,servings,prep_seconds,cook_seconds,total_seconds,uncertainties,warnings,is_confirmed,cover_image_url,preparation_flowchart_url,created_at,updated_at";

export async function listRecipesForUser(userId: string): Promise<RecipeSummary[]> {
  const params = new URLSearchParams({
    select: `${RECIPE_COLUMNS},ingredients(count),preparation_steps(count)`,
    user_id: `eq.${userId}`,
    order: "updated_at.desc",
  });
  const rows = await supabaseRequest<RecipeListRow[]>("recipes?" + params.toString());
  return rows.map((row) => recipeSummary(row, row.ingredients?.[0]?.count ?? 0, row.preparation_steps?.[0]?.count ?? 0));
}

export async function getRecipeForUser(recipeId: string, userId: string): Promise<RecipeDetail | null> {
  const params = new URLSearchParams({
    select: `${RECIPE_COLUMNS},ingredients(*),preparation_steps(*),recipe_utensils(*)`,
    id: `eq.${recipeId}`,
    user_id: `eq.${userId}`,
    limit: "1",
    "ingredients.order": "position.asc",
    "preparation_steps.order": "position.asc",
  });
  const rows = await supabaseRequest<RecipeDetailRow[]>("recipes?" + params.toString());
  const row = rows[0];
  if (!row) return null;
  const { ingredients, preparation_steps, recipe_utensils, ...recipe } = row;
  return { recipe, ingredients: ingredients ?? [], steps: preparation_steps ?? [], utensils: recipe_utensils ?? [] };
}

export async function createManualRecipe(
  userId: string,
  recipe: unknown,
): Promise<{ recipe_id: string }> {
  const result = await supabaseRequest<{ recipe_id: string } | { recipe_id: string }[]>(
    "rpc/create_manual_recipe",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ p_user_id: userId, p_recipe: recipe }),
    },
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row.recipe_id !== "string") throw new Error("RECIPE_CREATE_EMPTY");
  return row;
}

export async function updateRecipeForUser(
  recipeId: string,
  userId: string,
  recipe: unknown,
): Promise<{ recipe_id: string }> {
  const result = await supabaseRequest<{ recipe_id: string } | { recipe_id: string }[]>(
    "rpc/update_recipe",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ p_recipe_id: recipeId, p_user_id: userId, p_recipe: recipe }),
    },
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row.recipe_id !== "string") throw new Error("RECIPE_UPDATE_EMPTY");
  return row;
}

export async function deleteRecipeForUser(recipeId: string, userId: string): Promise<boolean> {
  const params = new URLSearchParams({ id: `eq.${recipeId}`, user_id: `eq.${userId}`, select: "id" });
  const rows = await supabaseRequest<{ id: string }[]>("recipes?" + params.toString(), {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  return rows.length > 0;
}

export async function listShoppingListsForUser(userId: string): Promise<ShoppingListRecord[]> {
  const listParams = new URLSearchParams({
    select: "id,title,created_at,updated_at",
    user_id: `eq.${userId}`,
    order: "updated_at.desc",
  });
  const lists = await supabaseRequest<Omit<ShoppingListRecord, "items">[]>("shopping_lists?" + listParams.toString());
  if (lists.length === 0) return [];
  const itemParams = new URLSearchParams({
    select: "id,shopping_list_id,name,normalized_name,quantity,unit,notes,is_purchased,source_recipe_ids,source_ingredient_ids,position",
    shopping_list_id: `in.(${lists.map((list) => list.id).join(",")})`,
    order: "position.asc",
  });
  const items = await supabaseRequest<ShoppingListItemRecord[]>("shopping_list_items?" + itemParams.toString());
  return lists.map((list) => ({
    ...list,
    items: items.filter((item) => item.shopping_list_id === list.id),
  }));
}

export async function deleteShoppingListForUser(listId: string, userId: string): Promise<boolean> {
  const params = new URLSearchParams({ id: `eq.${listId}`, user_id: `eq.${userId}`, select: "id" });
  const rows = await supabaseRequest<{ id: string }[]>("shopping_lists?" + params.toString(), {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  return rows.length > 0;
}

export type RecipeCacheDbEntry = {
  source_url_hash: string | null;
  source_content_hash: string | null;
  recipe_fingerprint: string;
  normalized_title?: string | null;
  recipe_draft: unknown;
  source_metadata: Record<string, unknown> | null;
};

export async function findRecipeCacheEntry(
  kind: "url" | "content" | "title" | "write",
  value: string,
): Promise<RecipeCacheDbEntry | null> {
  if (kind === "write") {
    await supabaseRequest<unknown>("recipe_cache", {
      method: "POST", headers: { Prefer: "return=representation" }, body: value,
    });
    return null;
  }
  const params = new URLSearchParams({
    select: "source_url_hash,source_content_hash,recipe_fingerprint,normalized_title,recipe_draft,source_metadata",
    [kind === "url" ? "source_url_hash" : kind === "content" ? "source_content_hash" : "normalized_title"]: "eq." + value,
    order: "updated_at.desc", limit: "1",
  });
  const rows = await supabaseRequest<RecipeCacheDbEntry[]>("recipe_cache?" + params.toString());
  return rows[0] ?? null;
}

export async function confirmRecipeFromImport(input: {
  import_id: string;
  user_id: string;
  recipe: unknown;
}): Promise<{ recipe_id: string; already_confirmed: boolean }> {
  const result = await supabaseRequest<{ recipe_id: string; already_confirmed: boolean } | Array<{ recipe_id: string; already_confirmed: boolean }>>(
    "rpc/confirm_recipe_from_import",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        p_import_id: input.import_id,
        p_user_id: input.user_id,
        p_recipe: input.recipe,
      }),
    },
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row.recipe_id !== "string") throw new Error("RECIPE_CONFIRMATION_EMPTY");
  return row;
}

export type ApiRateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  window_seconds: number;
  retry_after_seconds: number;
};

export async function consumeApiRateLimit(input: {
  userId: string;
  route: string;
  limit: number;
  windowSeconds: number;
}): Promise<ApiRateLimitResult> {
  const result = await supabaseRequest<ApiRateLimitResult | ApiRateLimitResult[]>(
    "rpc/consume_api_rate_limit",
    {
      method: "POST",
      body: JSON.stringify({
        p_user_id: input.userId,
        p_route_key: input.route,
        p_limit: input.limit,
        p_window_seconds: input.windowSeconds,
      }),
    },
  );
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row.allowed !== "boolean" || !Number.isFinite(row.retry_after_seconds)) {
    throw new Error("RATE_LIMIT_RESPONSE_INVALID");
  }
  return row;
}
