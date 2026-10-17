export const DEFAULT_LIVE_MODEL_ID = "gemini-3.8-live-extended-thinking";

export const DEFAULT_LIVE_VOICE_NAME = "Puck";

export const DEFAULT_LIVE_TOKEN_TTL_MINUTES = 30;

export const LIVE_WS_BASE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export type LiveStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type LiveThinkingLevel = "minimal" | "low" | "medium" | "high";

export function liveModelId(): string {
  return process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL_ID;
}

export function liveVoiceName(): string {
  return process.env.GEMINI_LIVE_VOICE?.trim() || DEFAULT_LIVE_VOICE_NAME;
}

export function liveTokenTtlMinutes(): number {
  const raw = Number(process.env.GEMINI_LIVE_TOKEN_TTL_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIVE_TOKEN_TTL_MINUTES;
  return Math.min(30, Math.max(1, Math.floor(raw)));
}

export function isLiveConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/** O campo `model` do setup do WebSocket precisa do prefixo `models/`. */
export function toLiveModelResource(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}
