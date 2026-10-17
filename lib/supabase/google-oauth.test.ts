import { describe, expect, it, vi } from "vitest";
import { startGoogleOAuth } from "./google-oauth";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("startGoogleOAuth", () => {
  it("requests Google through Supabase Auth and returns to the supplied origin", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { provider: "google", url: "https://accounts.google.com/" }, error: null });
    const client = { auth: { signInWithOAuth } } as unknown as Pick<SupabaseClient, "auth">;

    await startGoogleOAuth(client, "https://recistep.example");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://recistep.example", skipBrowserRedirect: true },
    });
  });

  it("returns provider configuration errors to the caller", async () => {
    const error = new Error("provider disabled");
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { provider: "google", url: null }, error });
    const client = { auth: { signInWithOAuth } } as unknown as Pick<SupabaseClient, "auth">;

    await expect(startGoogleOAuth(client, "http://localhost:3000")).resolves.toMatchObject({ error });
  });
});
