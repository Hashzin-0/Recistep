import "server-only";
import { consumeApiRateLimit } from "@/lib/server/supabase-rest";

export async function checkUserRateLimit(input: {
  userId: string;
  route: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const result = await consumeApiRateLimit(input);
  return { allowed: result.allowed, retryAfterSeconds: result.retry_after_seconds };
}
