import {
  createRunningTimer,
  pauseTimer,
  remainingTimerSeconds,
  resumeTimer,
  type CookingTimerState,
} from "@/lib/recipe/cooking-session";

export type StoredTimer = CookingTimerState & {
  recipeId: string | null;
  recipeTitle: string;
  stepNumber: number | null;
  stepInstruction: string | null;
  createdAt: number;
};

export type AddStoredTimerInput = {
  durationSeconds: number;
  recipeId?: string | null;
  recipeTitle?: string | null;
  stepPosition?: number;
  stepNumber?: number | null;
  stepInstruction?: string | null;
  id?: string;
};

export const TIMERS_STORAGE_PREFIX = "recistep:timers:v1:";
export const TIMERS_CHANGED_EVENT = "recistep:timers-changed";
export const MAX_TIMERS = 200;
export const MAX_TIMER_DURATION_SECONDS = 604800;
export const STANDALONE_TIMER_TITLE = "Temporizador avulso";

export function timersStorageKey(ownerEmail: string | null | undefined): string {
  const owner = ownerEmail?.trim().toLowerCase();
  return TIMERS_STORAGE_PREFIX + (owner || "anon");
}

export function isValidCookingTimerState(value: unknown): value is CookingTimerState {
  if (!value || typeof value !== "object") return false;
  const timer = value as Partial<CookingTimerState>;
  return typeof timer.id === "string" && timer.id.length > 0 &&
    Number.isInteger(timer.stepPosition) && timer.stepPosition! >= 0 &&
    Number.isFinite(timer.durationSeconds) && timer.durationSeconds! > 0 &&
    timer.durationSeconds! <= MAX_TIMER_DURATION_SECONDS &&
    (timer.endsAt === null || Number.isFinite(timer.endsAt)) &&
    (timer.pausedRemainingSeconds === null || Number.isFinite(timer.pausedRemainingSeconds));
}

export function isValidStoredTimer(value: unknown): value is StoredTimer {
  if (!isValidCookingTimerState(value)) return false;
  const timer = value as Partial<StoredTimer>;
  return (timer.recipeId === null || (typeof timer.recipeId === "string" && timer.recipeId.length > 0)) &&
    typeof timer.recipeTitle === "string" && timer.recipeTitle.trim().length > 0 &&
    (timer.stepNumber === null || (Number.isInteger(timer.stepNumber) && timer.stepNumber! >= 1)) &&
    (timer.stepInstruction === null || typeof timer.stepInstruction === "string") &&
    Number.isFinite(timer.createdAt);
}

export function parseStoredTimers(raw: string | null): StoredTimer[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const timers: StoredTimer[] = [];
  for (const candidate of parsed) {
    if (!isValidStoredTimer(candidate) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    timers.push({
      ...candidate,
      recipeTitle: candidate.recipeTitle.trim(),
      stepInstruction: candidate.stepInstruction?.trim() || null,
    });
    if (timers.length >= MAX_TIMERS) break;
  }
  return timers;
}

export function serializeStoredTimers(timers: StoredTimer[]): string {
  return JSON.stringify(timers);
}

export function readStoredTimers(ownerEmail: string | null | undefined): StoredTimer[] {
  if (typeof window === "undefined") return [];
  try {
    return parseStoredTimers(window.localStorage.getItem(timersStorageKey(ownerEmail)));
  } catch {
    return [];
  }
}

export function writeStoredTimers(ownerEmail: string | null | undefined, timers: StoredTimer[]): boolean {
  if (typeof window === "undefined") return false;
  const key = timersStorageKey(ownerEmail);
  try {
    window.localStorage.setItem(key, serializeStoredTimers(timers.slice(0, MAX_TIMERS)));
  } catch {
    return false;
  }
  notifyTimersChanged(key);
  return true;
}

export function notifyTimersChanged(key: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TIMERS_CHANGED_EVENT, { detail: { key } }));
}

export function timersForRecipe(timers: StoredTimer[], recipeId: string): StoredTimer[] {
  return timers.filter((timer) => timer.recipeId === recipeId);
}

export function createStoredTimer(input: AddStoredTimerInput, nowMs: number): StoredTimer {
  const stepPosition = input.stepPosition ?? 0;
  const durationSeconds = input.durationSeconds;
  const id = input.id ?? `timer-${nowMs}-${stepPosition}-${Math.random().toString(36).slice(2, 10)}`;
  const base = createRunningTimer(stepPosition, durationSeconds, nowMs, id);
  return {
    ...base,
    recipeId: input.recipeId ?? null,
    recipeTitle: input.recipeTitle?.trim() || STANDALONE_TIMER_TITLE,
    stepNumber: input.stepNumber ?? null,
    stepInstruction: input.stepInstruction?.trim() || null,
    createdAt: nowMs,
  };
}

export function toggleStoredTimer(timer: StoredTimer, nowMs: number): StoredTimer {
  return timer.endsAt === null ? resumeTimer(timer, nowMs) as StoredTimer : pauseTimer(timer, nowMs) as StoredTimer;
}

export function sortTimersByUrgency(timers: StoredTimer[], nowMs: number): StoredTimer[] {
  const rank = (timer: StoredTimer): number => {
    const remaining = remainingTimerSeconds(timer, nowMs);
    if (remaining === 0) return 2;
    return timer.endsAt === null ? 1 : 0;
  };
  return [...timers].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return remainingTimerSeconds(a, nowMs) - remainingTimerSeconds(b, nowMs);
  });
}
