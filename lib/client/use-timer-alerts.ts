"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { remainingTimerSeconds } from "@/lib/recipe/cooking-session";
import type { StoredTimer } from "@/lib/recipe/timer-store";

function timerLabel(timer: StoredTimer): string {
  if (timer.stepNumber !== null) return `${timer.recipeTitle} · etapa ${timer.stepNumber}`;
  return timer.recipeTitle;
}

export function useTimerAlerts(timers: StoredTimer[], now: number, hydrated: boolean) {
  const announcedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [armed, setArmed] = useState(false);
  const [message, setMessage] = useState("");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );

  const beep = useCallback(() => {
    if (!armed || typeof window === "undefined" || !window.AudioContext) return;
    try {
      const context = audioContextRef.current ?? new window.AudioContext();
      audioContextRef.current = context;
      void context.resume().catch(() => undefined);
      [880, 1046].forEach((frequency, index) => {
        const start = context.currentTime + index * 0.24;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.2);
      });
    } catch {
      // O aviso visual continua mesmo quando o navegador bloqueia o áudio.
    }
  }, [armed]);

  useEffect(() => {
    if (!hydrated) return;
    if (!seededRef.current) {
      seededRef.current = true;
      for (const timer of timers) {
        if (remainingTimerSeconds(timer, now) === 0) announcedRef.current.add(timer.id);
      }
      return;
    }
    for (const timer of timers) {
      if (remainingTimerSeconds(timer, now) > 0) {
        announcedRef.current.delete(timer.id);
        continue;
      }
      if (announcedRef.current.has(timer.id)) continue;
      announcedRef.current.add(timer.id);
      const label = timerLabel(timer);
      setMessage(`Tempo encerrado: ${label}.`);
      beep();
      if (typeof window !== "undefined" && "Notification" in window &&
        Notification.permission === "granted" && document.visibilityState === "hidden") {
        try {
          const notification = new Notification("Temporizador concluído", {
            body: label,
            tag: `recistep-timer-${timer.id}`,
          });
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        } catch {
          // Notificações são um complemento opcional ao aviso na página.
        }
      }
    }
    const existing = new Set(timers.map((timer) => timer.id));
    for (const id of announcedRef.current) if (!existing.has(id)) announcedRef.current.delete(id);
  }, [timers, now, hydrated, beep]);

  const armAlerts = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      if (window.AudioContext) {
        const context = audioContextRef.current ?? new window.AudioContext();
        audioContextRef.current = context;
        await context.resume();
      }
    } catch {
      // Sem áudio, o alerta visual e a notificação ainda podem funcionar.
    }
    if ("Notification" in window) {
      try {
        const result = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        setPermission(result);
        setArmed(true);
        setMessage(result === "granted"
          ? "Som e notificações ativados."
          : result === "denied"
            ? "Som ativado; notificações bloqueadas no navegador."
            : "Som ativado.");
        return;
      } catch {
        setPermission(Notification.permission);
      }
    }
    setArmed(true);
    setMessage("Som ativado.");
  }, []);

  return { armed, message, permission, armAlerts, clearMessage: () => setMessage("") };
}
