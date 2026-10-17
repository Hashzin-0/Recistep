"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRunningTimer, formatDuration, pauseTimer, remainingTimerSeconds, resumeTimer, type CookingTimerState } from "@/lib/recipe/cooking-session";
import { VoiceAssistantHud, type VoiceControlApi } from "@/components/voice-assistant-hud";
import { defineToolGroup } from "@/lib/voice/function-tool";
import { buildKitchenSystemInstruction } from "@/lib/voice/prompts";
import {
  KITCHEN_TOOLS,
  executeKitchenTool,
  withToggledIngredient,
  withToggledStep,
  type KitchenVoiceBridge,
} from "@/lib/voice/recipe-tools";
import type { ExecuteToolFn } from "@/lib/voice/live-session";

type Ingredient = { name: string; quantity: number | null; unit: string | null; notes: string | null };
type Step = { position: number; instruction: string; duration_seconds: number | null; temperature_value: number | null; temperature_unit: "C" | "F" | null };
type SessionState = { completedSteps: number[]; checkedIngredients: number[]; currentStep: number; timer: CookingTimerState | null };
const emptySession: SessionState = { completedSteps: [], checkedIngredients: [], currentStep: 0, timer: null };

const KITCHEN_TOOL_GROUPS = [defineToolGroup(KITCHEN_TOOLS)];

function validSession(value: unknown, steps: Step[], ingredients: Ingredient[]): SessionState {
  if (!value || typeof value !== "object") return emptySession;
  const candidate = value as Partial<SessionState>;
  const positions = new Set(steps.map((step) => step.position));
  const indexes = new Set(ingredients.map((_, index) => index));
  const completedSteps = Array.isArray(candidate.completedSteps) ? candidate.completedSteps.filter((n): n is number => Number.isInteger(n) && positions.has(n)) : [];
  const checkedIngredients = Array.isArray(candidate.checkedIngredients) ? candidate.checkedIngredients.filter((n): n is number => Number.isInteger(n) && indexes.has(n)) : [];
  const currentStep = typeof candidate.currentStep === "number" && positions.has(candidate.currentStep) ? candidate.currentStep : steps[0]?.position ?? 0;
  let timer: CookingTimerState | null = null;
  const rawTimer = candidate.timer;
  if (rawTimer && typeof rawTimer === "object" && positions.has(rawTimer.stepPosition) &&
      Number.isFinite(rawTimer.durationSeconds) && rawTimer.durationSeconds > 0 &&
      (rawTimer.endsAt === null || Number.isFinite(rawTimer.endsAt)) &&
      (rawTimer.pausedRemainingSeconds === null || Number.isFinite(rawTimer.pausedRemainingSeconds))) {
    timer = rawTimer as CookingTimerState;
  }
  return { completedSteps: [...new Set(completedSteps)], checkedIngredients: [...new Set(checkedIngredients)], currentStep, timer };
}

function quantityLabel(ingredient: Ingredient): string {
  if (ingredient.quantity === null) return "Quantidade não informada";
  return String(ingredient.quantity) + (ingredient.unit ? " " + ingredient.unit : "");
}

export function KitchenMode({ recipeId, title, description, servings, ingredients, steps, getAccessToken }: {
  recipeId: string; title: string; description?: string | null; servings?: number | null;
  ingredients: Ingredient[]; steps: Step[]; getAccessToken?: () => Promise<string | null>;
}) {
  const orderedSteps = useMemo(() => [...steps].sort((a, b) => a.position - b.position), [steps]);
  const [session, setSession] = useState<SessionState>(emptySession);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [customMinutes, setCustomMinutes] = useState("5");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const voiceApiRef = useRef<VoiceControlApi | null>(null);
  const activeStep = orderedSteps.find((step) => step.position === session.currentStep) ?? orderedSteps[0];
  const timerRemaining = session.timer ? remainingTimerSeconds(session.timer, now) : null;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("recistep:cooking:" + recipeId);
      if (saved) setSession(validSession(JSON.parse(saved), steps, ingredients));
    } catch {
      setSession(emptySession);
    } finally {
      setHydrated(true);
    }
  }, [recipeId, steps, ingredients]);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem("recistep:cooking:" + recipeId, JSON.stringify(session)); }
    catch { setNotice("O navegador não permitiu salvar o progresso neste dispositivo."); }
  }, [hydrated, recipeId, session]);

  useEffect(() => {
    if (!session.timer || session.timer.endsAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [session.timer?.endsAt]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    const installable = (event: Event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", installable);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("beforeinstallprompt", installable);
    };
  }, []);

  function updateSession(patch: Partial<SessionState>) { setSession((previous) => ({ ...previous, ...patch })); }
  function chooseStep(position: number) { updateSession({ currentStep: position }); setNotice(""); }
  function toggleStep(position: number) {
    setSession((previous) => withToggledStep(previous, orderedSteps, position));
  }
  function toggleIngredient(index: number) {
    setSession((previous) => withToggledIngredient(previous, index));
  }
  function startTimer() {
    if (!activeStep) return;
    const duration = activeStep.duration_seconds ?? Number(customMinutes) * 60;
    startTimerForStep(activeStep.position, duration);
  }
  function startTimerForStep(stepPosition: number, duration: number) {
    try {
      updateSession({ timer: createRunningTimer(stepPosition, duration, Date.now()) });
      setNow(Date.now());
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Duração inválida."); }
  }
  function pauseOrResumeTimer(nowMs: number = Date.now()) {
    if (!session.timer) return;
    updateSession({ timer: session.timer.endsAt === null ? resumeTimer(session.timer, nowMs) : pauseTimer(session.timer, nowMs) });
    setNow(nowMs);
  }
  function resetTimer() { updateSession({ timer: null }); setNow(Date.now()); }
  async function installApp() {
    if (!installPrompt) return;
    const prompt = installPrompt as Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
    if (!prompt.prompt) return;
    await prompt.prompt();
    const result = await prompt.userChoice;
    if (result?.outcome === "accepted") setNotice("Instalação solicitada pelo navegador.");
    setInstallPrompt(null);
  }
  const timerExpired = session.timer !== null && timerRemaining === 0;

  const systemInstruction = useMemo(
    () =>
      buildKitchenSystemInstruction({
        title,
        description: description ?? null,
        servings: servings ?? null,
        ingredients,
        steps: orderedSteps,
      }),
    [title, description, servings, ingredients, orderedSteps],
  );

  const voiceBridgeRef = useRef<KitchenVoiceBridge | null>(null);
  const voiceBridge: KitchenVoiceBridge = {
    title,
    servings: servings ?? null,
    ingredients,
    steps: orderedSteps,
    session,
    timerRemainingSeconds: timerRemaining,
    now,
    actions: {
      chooseStep,
      toggleStepComplete: toggleStep,
      toggleIngredient,
      startTimer: startTimerForStep,
      pauseOrResumeTimer,
      resetTimer,
      setNotice,
    },
  };
  useEffect(() => { voiceBridgeRef.current = voiceBridge; });

  const executeTool = useCallback<ExecuteToolFn>(async (name, args, setActionLabel) => {
    const bridge = voiceBridgeRef.current;
    if (!bridge) return { success: false, error: "Modo cozinha ainda não carregou a receita." };
    const output = executeKitchenTool(bridge, name, args, setActionLabel);
    if (name === "stopVoiceGuidance") voiceApiRef.current?.requestDisconnect();
    return output;
  }, []);

  const timerAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!timerExpired) { timerAnnouncedRef.current = false; return; }
    if (timerAnnouncedRef.current) return;
    timerAnnouncedRef.current = true;
    const timerStep = session.timer ? orderedSteps.find((step) => step.position === session.timer?.stepPosition) : null;
    const stepNumber = timerStep ? orderedSteps.findIndex((step) => step.position === timerStep.position) + 1 : null;
    voiceApiRef.current?.sendText(
      `Aviso do sistema: ${stepNumber ? `o temporizador da etapa ${stepNumber}` : "o temporizador"} terminou. ` +
      "Avise o usuário em voz alta e pergunte se ele quer seguir para a próxima etapa.",
    );
  }, [timerExpired, session.timer, orderedSteps]);

  return <section className="kitchen-mode" aria-labelledby="kitchen-mode-title">
    <div className="kitchen-heading">
      <div><span className="kitchen-eyebrow">MODO COZINHA</span><h3 id="kitchen-mode-title">{title}</h3><p>Progresso salvo somente neste dispositivo. Mantenha a tela visível durante o preparo.</p></div>
      <div className={"connection-state" + (online ? "" : " offline")} role="status"><span />{online ? "Conectado" : "Sem conexão"}</div>
    </div>
    {!online && <p className="kitchen-notice" role="status">O modo cozinha já carregado pode continuar, mas o banco e a importação precisam de conexão.</p>}
    <div className="kitchen-progress" aria-label="Progresso do preparo">
      <div><strong>{session.completedSteps.length} de {orderedSteps.length}</strong><span>etapas concluídas</span></div>
      <div className="kitchen-progress-track"><span style={{ width: (orderedSteps.length ? session.completedSteps.length / orderedSteps.length * 100 : 0) + "%" }} /></div>
    </div>
    <div className="kitchen-layout">
      <div className="kitchen-step-column">
        <div className="kitchen-section-title"><h4>Etapas do preparo</h4><span>{orderedSteps.length} etapas</span></div>
        <ol className="kitchen-step-list">
          {orderedSteps.map((step, index) => {
            const complete = session.completedSteps.includes(step.position);
            const selected = activeStep?.position === step.position;
            return <li key={step.position} className={(complete ? "complete " : "") + (selected ? "selected" : "")}>
              <button type="button" className="kitchen-step-select" onClick={() => chooseStep(step.position)} aria-current={selected ? "step" : undefined}>
                <span className="kitchen-step-number">{complete ? "✓" : index + 1}</span><span><strong>Etapa {index + 1}</strong><small>{step.duration_seconds === null ? "Tempo não informado" : formatDuration(step.duration_seconds)}</small></span>
              </button>
              <p>{step.instruction}</p>
              {step.temperature_value !== null && <p className="kitchen-temperature">Temperatura: {step.temperature_value}°{step.temperature_unit ?? "C"}</p>}
              <button type="button" className="kitchen-complete-button" onClick={() => toggleStep(step.position)}>{complete ? "Reabrir etapa" : "Marcar como concluída"}</button>
            </li>;
          })}
        </ol>
      </div>
      <aside className="kitchen-side-column">
        {getAccessToken && (
          <VoiceAssistantHud
            contextLabel="Preparo da receita"
            systemInstruction={systemInstruction}
            toolGroups={KITCHEN_TOOL_GROUPS}
            executeTool={executeTool}
            getAccessToken={getAccessToken}
            thinkingLevel="low"
            apiRef={voiceApiRef}
          />
        )}
        <section className="kitchen-panel" aria-label="Temporizador da etapa">
          <div className="kitchen-section-title"><h4>Temporizador</h4><span>{activeStep ? "Etapa " + (orderedSteps.findIndex((step) => step.position === activeStep.position) + 1) : "—"}</span></div>
          <p className="kitchen-timer-instruction">{activeStep?.instruction ?? "Selecione uma etapa para começar."}</p>
          <div className={"kitchen-clock" + (timerExpired ? " expired" : "")} role="timer" aria-live={timerExpired ? "assertive" : "off"}>{session.timer ? formatDuration(timerRemaining ?? 0) : activeStep?.duration_seconds !== null && activeStep?.duration_seconds !== undefined ? formatDuration(activeStep.duration_seconds) : "—:—"}</div>
          {timerExpired && <p className="kitchen-notice" role="alert">Tempo encerrado. Confira o preparo antes de avançar.</p>}
          {!session.timer && <label className="kitchen-custom-time">Minutos personalizados (quando necessário)<input type="number" min="0.0167" max="10080" step="any" value={customMinutes} onChange={(event) => setCustomMinutes(event.target.value)} /></label>}
          <div className="kitchen-timer-actions">
            {!session.timer ? <button type="button" onClick={startTimer} disabled={!activeStep}>Iniciar timer</button> : <>
              <button type="button" onClick={() => pauseOrResumeTimer()}>{session.timer.endsAt === null ? "Retomar" : "Pausar"}</button>
              <button type="button" className="secondary-button" onClick={resetTimer}>Zerar</button>
            </>}
          </div>
          <p className="field-hint">Timers usam o relógio do dispositivo e continuam contando com a aba em segundo plano. Eles não controlam o forno ou outro equipamento.</p>
        </section>
        <section className="kitchen-panel" aria-label="Checklist de ingredientes">
          <div className="kitchen-section-title"><h4>Ingredientes</h4><span>{session.checkedIngredients.length}/{ingredients.length}</span></div>
          <div className="kitchen-ingredient-list">{ingredients.map((ingredient, index) => <label key={index} className={session.checkedIngredients.includes(index) ? "checked" : ""}><input type="checkbox" checked={session.checkedIngredients.includes(index)} onChange={() => toggleIngredient(index)} /><span><strong>{ingredient.name}</strong><small>{quantityLabel(ingredient)}{ingredient.notes ? " · " + ingredient.notes : ""}</small></span></label>)}</div>
        </section>
        <div className="kitchen-footer-actions">
          <button type="button" className="secondary-button" onClick={() => { setSession(emptySession); setNotice("Progresso reiniciado neste dispositivo."); }}>Reiniciar preparo</button>
          {installPrompt && <button type="button" onClick={() => void installApp()}>Instalar Recistep</button>}
        </div>
        {notice && <p className="kitchen-notice" role="status">{notice}</p>}
      </aside>
    </div>
  </section>;
}
