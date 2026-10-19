"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { PageTransition } from "@/components/view-transition";
import { useVoiceAssistantContext, type VoiceContextConfig } from "@/components/voice-assistant-provider";
import { useTimerAlerts } from "@/lib/client/use-timer-alerts";
import { useTimers } from "@/lib/client/use-timers";
import { formatDuration, remainingTimerSeconds } from "@/lib/recipe/cooking-session";
import { sortTimersByUrgency, type StoredTimer } from "@/lib/recipe/timer-store";
import { defineToolGroup } from "@/lib/voice/function-tool";
import type { ExecuteToolFn } from "@/lib/voice/live-session";
import {
  TIMER_TOOLS,
  executeTimerTool,
  type TimerVoiceAddInput,
  type TimerVoiceBridge,
} from "@/lib/voice/timer-tools";

const TIMER_TOOL_GROUPS = [defineToolGroup(TIMER_TOOLS)];

const TIMER_SYSTEM_INSTRUCTION = [
  "Você é o assistente de voz do Recistep na tela 'Temporizadores'.",
  "Fale em português do Brasil, de forma curta e natural.",
  "Ajude o usuário a criar, pausar, retomar e remover temporizadores. Use listTimers antes de alterar quando houver mais de um timer.",
  "Nunca invente durações, receitas ou rótulos: use apenas o que o usuário informar.",
  "Confirme em voz alta cada ação depois que a ferramenta retornar success=true.",
].join("\n");

type TimerGroup = {
  key: string;
  recipeId: string | null;
  title: string;
  timers: StoredTimer[];
};

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function groupTimers(timers: StoredTimer[], now: number): TimerGroup[] {
  const groups = new Map<string, TimerGroup>();
  for (const timer of timers) {
    const key = timer.recipeId ? `recipe:${timer.recipeId}` : `standalone:${normalize(timer.recipeTitle)}`;
    const group = groups.get(key);
    if (group) group.timers.push(timer);
    else groups.set(key, { key, recipeId: timer.recipeId, title: timer.recipeTitle, timers: [timer] });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    timers: sortTimersByUrgency(group.timers, now),
  }));
}

export default function TemporizadoresPage() {
  const { signedInEmail } = useAuth();
  const {
    timers,
    hydrated,
    addTimer,
    pauseOrResumeTimer,
    removeTimer,
  } = useTimers(signedInEmail);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState("");
  const alerts = useTimerAlerts(timers, now, hydrated);
  const shouldTick = timers.some((timer) => timer.endsAt !== null && timer.endsAt > Date.now());

  useEffect(() => {
    if (!shouldTick) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [shouldTick]);

  const groups = useMemo(() => groupTimers(timers, now), [timers, now]);

  const addFromVoice = useCallback((input: TimerVoiceAddInput): StoredTimer => addTimer({
    durationSeconds: input.durationSeconds,
    recipeId: null,
    recipeTitle: input.recipeTitle,
    stepPosition: 0,
    stepNumber: null,
    stepInstruction: input.label ?? null,
  }), [addTimer]);

  const bridgeRef = useRef<TimerVoiceBridge | null>(null);
  const bridge = useMemo<TimerVoiceBridge>(() => ({
    timers,
    now,
    actions: {
      addTimer: addFromVoice,
      pauseOrResumeTimer: (timerId, nowMs) => pauseOrResumeTimer(timerId, nowMs),
      removeTimer: (timerId) => removeTimer(timerId),
    },
  }), [timers, now, addFromVoice, pauseOrResumeTimer, removeTimer]);
  useEffect(() => { bridgeRef.current = bridge; }, [bridge]);

  const executeVoiceTool = useCallback<ExecuteToolFn>(async (name, args, setActionLabel) => {
    const current = bridgeRef.current;
    if (!current) return { success: false, error: "A lista de temporizadores ainda não carregou." };
    const output = executeTimerTool(current, name, args, setActionLabel);
    if ("success" in output && output.success) {
      setNow(Date.now());
      setNotice("");
    }
    return output;
  }, []);

  const voiceContext = useMemo<VoiceContextConfig>(() => ({
    key: "timers",
    contextLabel: "Temporizadores",
    systemInstruction: TIMER_SYSTEM_INSTRUCTION,
    toolGroups: TIMER_TOOL_GROUPS,
    executeTool: executeVoiceTool,
    thinkingLevel: "low",
  }), [executeVoiceTool]);

  useVoiceAssistantContext(voiceContext);

  function toggleTimer(timer: StoredTimer) {
    pauseOrResumeTimer(timer.id, Date.now());
    setNow(Date.now());
    setNotice("");
  }

  function deleteTimer(timer: StoredTimer) {
    removeTimer(timer.id);
    setNow(Date.now());
    setNotice("Temporizador removido.");
  }

  return (
    <PageTransition>
      <main className="site-shell page-main">
        <section className="page-heading">
          <div>
            <p className="page-kicker">Seus relógios</p>
            <h1>Temporizadores</h1>
            <p>Todos os temporizadores do modo cozinha reunidos em um só lugar. Eles continuam contando enquanto você navega.</p>
          </div>
          {signedInEmail && (
            <button
              className="auth-secondary-button"
              type="button"
              onClick={() => void alerts.armAlerts()}
              disabled={alerts.armed}
            >
              {alerts.armed ? "Alertas ativados" : "Ativar som e notificações"}
            </button>
          )}
        </section>

        {!signedInEmail && <SignInPrompt message="Entre para ver e controlar seus temporizadores." />}

        {signedInEmail && (
          <>
            {alerts.message && (
              <p className="kitchen-notice" role="status">
                {alerts.message}{" "}
                <button type="button" className="link-button" onClick={alerts.clearMessage}>Fechar</button>
              </p>
            )}
            {notice && <p className="kitchen-notice" role="status">{notice}</p>}
            {!hydrated && <p className="field-hint">Carregando temporizadores…</p>}

            {hydrated && timers.length === 0 && (
              <div className="empty-state">
                <p>Nenhum temporizador ativo.</p>
                <p className="field-hint">Abra uma receita em Minhas receitas, inicie o preparo e crie um timer no modo cozinha.</p>
              </div>
            )}

            <div className="timers-groups">
              {groups.map((group) => (
                <section className="timers-group" key={group.key} aria-label={`Temporizadores de ${group.title}`}>
                  <header className="timers-group-heading">
                    <div>
                      <h2>{group.title}</h2>
                      <span>{group.timers.length} {group.timers.length === 1 ? "timer" : "timers"}</span>
                    </div>
                    {group.recipeId && (
                      <Link className="auth-secondary-button" href={`/minhas-receitas/${group.recipeId}?preparo=1`}>
                        Abrir preparo
                      </Link>
                    )}
                  </header>
                  <div className="timers-grid">
                    {group.timers.map((timer) => {
                      const remaining = remainingTimerSeconds(timer, now);
                      const finished = remaining === 0;
                      const paused = timer.endsAt === null && !finished;
                      const status = finished ? "Concluído" : paused ? "Pausado" : "Em andamento";
                      return (
                        <article className={"timer-card" + (finished ? " is-finished" : paused ? " is-paused" : "")} key={timer.id}>
                          <div className="timer-card-heading">
                            <span className="timer-card-step">{timer.stepNumber !== null ? `Etapa ${timer.stepNumber}` : "Timer avulso"}</span>
                            <span className="timer-card-status">{status}</span>
                          </div>
                          {timer.stepInstruction && <p className="timer-card-instruction">{timer.stepInstruction}</p>}
                          <div
                            className="timer-card-clock"
                            role="timer"
                            aria-live={finished ? "assertive" : "off"}
                          >
                            {formatDuration(remaining)}
                          </div>
                          <div className="timer-card-actions">
                            {!finished && (
                              <button type="button" className="auth-secondary-button" onClick={() => toggleTimer(timer)}>
                                {paused ? "Retomar" : "Pausar"}
                              </button>
                            )}
                            <button type="button" className="link-button danger" onClick={() => deleteTimer(timer)}>
                              Remover
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </PageTransition>
  );
}
