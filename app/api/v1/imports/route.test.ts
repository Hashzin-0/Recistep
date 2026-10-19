import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateSupabaseAccessToken: vi.fn(),
  createSourceImport: vi.fn(),
  getSupabaseConfig: vi.fn(),
  listUserSourceImports: vi.fn(),
  updateSourceImport: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/supabase-rest", () => ({
  authenticateSupabaseAccessToken: mocks.authenticateSupabaseAccessToken,
  createSourceImport: mocks.createSourceImport,
  getSupabaseConfig: mocks.getSupabaseConfig,
  listUserSourceImports: mocks.listUserSourceImports,
  updateSourceImport: mocks.updateSourceImport,
}));
vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn() },
  isInngestConfigured: () => true,
}));
vi.mock("@/lib/source-url", () => ({ validateSourceUrl: vi.fn() }));
vi.mock("@/lib/server/rate-limit", () => ({ checkUserRateLimit: vi.fn() }));
vi.mock("@/lib/server/recipe-cache", () => ({
  findCachedRecipeByUrl: vi.fn(),
  fingerprintRecipe: vi.fn(),
  hashSourceUrl: vi.fn(),
}));

import { GET } from "./route";

const ACTIVE_IMPORT = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "user-123",
  status: "processing",
  source_url: "https://youtube.com/watch?v=abc",
  platform: "youtube",
  locale: "pt-BR",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function request(url = "http://localhost/api/v1/imports") {
  return new Request(url, {
    method: "GET",
    headers: { Authorization: "Bearer test-token" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSupabaseConfig.mockReturnValue({ url: "https://x", anonKey: "a", serviceKey: "s" });
  mocks.authenticateSupabaseAccessToken.mockResolvedValue({ id: "user-123" });
  mocks.listUserSourceImports.mockResolvedValue([ACTIVE_IMPORT]);
});

describe("GET /api/v1/imports", () => {
  it("lists the active imports of the authenticated user", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([ACTIVE_IMPORT]);
    expect(mocks.listUserSourceImports).toHaveBeenCalledWith("user-123", {
      statuses: ["queued", "processing", "source_content_required", "review_required"],
      limit: 5,
    });
  });

  it("rejects requests without a bearer token", async () => {
    const response = await GET(new Request("http://localhost/api/v1/imports", { method: "GET" }));
    expect(response.status).toBe(401);
    expect(mocks.listUserSourceImports).not.toHaveBeenCalled();
  });

  it("returns 401 when authentication fails", async () => {
    mocks.authenticateSupabaseAccessToken.mockRejectedValue(new Error("UNAUTHORIZED"));
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("rejects an invalid status filter", async () => {
    const response = await GET(request("http://localhost/api/v1/imports?status=bogus"));
    expect(response.status).toBe(400);
    expect(mocks.listUserSourceImports).not.toHaveBeenCalled();
  });

  it("accepts a valid status filter and clamps the limit", async () => {
    const response = await GET(request("http://localhost/api/v1/imports?status=queued,review_required&limit=99"));
    expect(response.status).toBe(200);
    expect(mocks.listUserSourceImports).toHaveBeenCalledWith("user-123", {
      statuses: ["queued", "review_required"],
      limit: 20,
    });
  });

  it("returns 503 when persistence is unavailable", async () => {
    mocks.getSupabaseConfig.mockReturnValue(null);
    const response = await GET(request());
    expect(response.status).toBe(503);
  });
});
