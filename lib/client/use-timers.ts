"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MAX_TIMERS,
  TIMERS_CHANGED_EVENT,
  createStoredTimer,
  readStoredTimers,
  timersStorageKey,
  toggleStoredTimer,
  writeStoredTimers,
  type AddStoredTimerInput,
  type StoredTimer,
} from "@/lib/recipe/timer-store";

type TimersChangedEvent = CustomEvent<{ key?: string }>;

export function useTimers(ownerEmail: string | null | undefined) {
  const owner = ownerEmail?.trim().toLowerCase() || null;
  const storageKey = timersStorageKey(owner);
  const [timers, setTimers] = useState<StoredTimer[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const sync = () => {
      setTimers(readStoredTimers(owner));
      setHydrated(true);
    };
    sync();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === storageKey) sync();
    };
    const onChanged = (event: Event) => {
      const detail = (event as TimersChangedEvent).detail;
      if (!detail?.key || detail.key === storageKey) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(TIMERS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(TIMERS_CHANGED_EVENT, onChanged);
    };
  }, [owner, storageKey]);

  const persist = useCallback((updater: (current: StoredTimer[]) => StoredTimer[]): StoredTimer[] => {
    const next = updater(readStoredTimers(owner)).slice(0, MAX_TIMERS);
    writeStoredTimers(owner, next);
    return next;
  }, [owner]);

  const addTimer = useCallback((input: AddStoredTimerInput): StoredTimer => {
    const timer = createStoredTimer(input, Date.now());
    persist((current) => [...current.filter((item) => item.id !== timer.id), timer]);
    return timer;
  }, [persist]);

  const addTimers = useCallback((incoming: StoredTimer[]): void => {
    if (incoming.length === 0) return;
    persist((current) => {
      const known = new Set(current.map((timer) => timer.id));
      return [...current, ...incoming.filter((timer) => !known.has(timer.id))];
    });
  }, [persist]);

  const pauseOrResumeTimer = useCallback((timerId: string, nowMs: number = Date.now()): StoredTimer | null => {
    let result: StoredTimer | null = null;
    persist((current) => current.map((timer) => {
      if (timer.id !== timerId) return timer;
      result = toggleStoredTimer(timer, nowMs);
      return result;
    }));
    return result;
  }, [persist]);

  const removeTimer = useCallback((timerId: string): StoredTimer | null => {
    let removed: StoredTimer | null = null;
    persist((current) => {
      removed = current.find((timer) => timer.id === timerId) ?? null;
      return removed ? current.filter((timer) => timer.id !== timerId) : current;
    });
    return removed;
  }, [persist]);

  const removeTimers = useCallback((timerIds: string[]): void => {
    if (timerIds.length === 0) return;
    const ids = new Set(timerIds);
    persist((current) => current.filter((timer) => !ids.has(timer.id)));
  }, [persist]);

  return {
    timers,
    hydrated,
    addTimer,
    addTimers,
    pauseOrResumeTimer,
    removeTimer,
    removeTimers,
  };
}
