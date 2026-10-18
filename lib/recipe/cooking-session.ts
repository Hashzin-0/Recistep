export type CookingTimerState = {
  id: string;
  stepPosition: number;
  durationSeconds: number;
  endsAt: number | null;
  pausedRemainingSeconds: number | null;
};

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return [hours, String(minutes).padStart(2, "0"), String(seconds).padStart(2, "0")].join(":");
  return [minutes, String(seconds).padStart(2, "0")].join(":");
}

export function remainingTimerSeconds(timer: CookingTimerState, nowMs: number): number {
  if (timer.endsAt === null) return Math.max(0, Math.ceil(timer.pausedRemainingSeconds ?? timer.durationSeconds));
  return Math.max(0, Math.ceil((timer.endsAt - nowMs) / 1000));
}

export function createRunningTimer(stepPosition: number, durationSeconds: number, nowMs: number): CookingTimerState {
  if (!Number.isInteger(stepPosition) || stepPosition < 0) throw new RangeError("Etapa inválida.");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 604800) {
    throw new RangeError("O temporizador deve ter entre 1 segundo e 7 dias.");
  }
  return { stepPosition, durationSeconds: Math.ceil(durationSeconds), endsAt: nowMs + Math.ceil(durationSeconds) * 1000, pausedRemainingSeconds: null };
}

export function pauseTimer(timer: CookingTimerState, nowMs: number): CookingTimerState {
  const remaining = remainingTimerSeconds(timer, nowMs);
  return { ...timer, endsAt: null, pausedRemainingSeconds: remaining };
}

export function resumeTimer(timer: CookingTimerState, nowMs: number): CookingTimerState {
  const remaining = remainingTimerSeconds(timer, nowMs);
  return { ...timer, endsAt: nowMs + remaining * 1000, pausedRemainingSeconds: null };
}
