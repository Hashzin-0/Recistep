import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Requests a Google OAuth URL from Supabase. The caller performs the redirect
 * explicitly so it can handle missing URLs and surface configuration errors.
 */
export function startGoogleOAuth(
  client: Pick<SupabaseClient, "auth">,
  redirectTo: string,
) {
  return client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
}
