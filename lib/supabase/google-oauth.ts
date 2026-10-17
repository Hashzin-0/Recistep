import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Starts Google OAuth through Supabase Auth and returns to the app origin.
 * The Supabase dashboard must allow this redirect URL and have Google enabled.
 */
export function startGoogleOAuth(
  client: Pick<SupabaseClient, "auth">,
  redirectTo: string,
) {
  return client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}
