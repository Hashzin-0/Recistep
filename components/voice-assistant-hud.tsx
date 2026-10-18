"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { VoiceOrb } from "@/components/voice-orb";
import type { FunctionDeclarationGroup } from "@/lib/voice/function-tool";
import type { LiveThinkingLevel } from "@/lib/voice/live-config";
import {
  useLiveSession,
  type ExecuteToolFn,
  type LiveSessionConfig,
  type LiveSessionLabels,
  type LiveSessionState,
} from "@/lib/voice/live-session";

// O orb liga/desliga a sessão; o controle separado silencia/reativa o microfone.

export interface VoiceControlApi {
  sendText(text: string): boolean;
  requestDisconnect(): void;
  disconnect(): void;
  state: LiveSessionState;
}

const DEFAULT_LABELS: LiveSessionLabels = {
  obtainingToken: "Obtendo credencial de voz…",
  connecting: "Conectando ao Gemini Live…",
  configuring: "Configurando…",
  ready: "Pronto • Pode falar",
  listening: "Ouvindo…",
  thinking: "Pensando…",
};

const STATUS_TEXT: Record<LiveSessionState["status"], string> = {
  idle: "Assistente de voz desconectado",
  connecting: "Conectando o assistente de voz",
  listening: "Ouvindo você",
  thinking: "Pensando",
  speaking: "Falando",
  error: "Erro de conexão com o assistente de voz",
};

const PRIVACY_NOTE =
  "O áudio vai do seu navegador direto para o Gemini e não é gravado pelo Recistep. Use fones de ouvido para evitar eco.";

export interface VoiceAssistantHudProps {
  contextLabel: string;
  systemInstruction: string;
  toolGroups: FunctionDeclarationGroup[];
  executeTool: ExecuteToolFn;
  getAccessToken: () => Promise<string | null>;
  thinkingLevel?: LiveThinkingLevel;
  /** Permite ao componente pai enviar um aviso ao agente (ex.: timer terminou). */
  apiRef?: RefObject<VoiceControlApi | null>;
}

function orbLabel(state: LiveSessionState): string {
  if (state.status === "connecting") return "Conectando o assistente de voz. Aguarde.";
  if (state.errorMessage) return "Assistente de voz com erro. Toque para tentar de novo.";
  if (state.isMuted) return "Assistente de voz ativo, microfone silenciado. Toque para desligar a sessão.";
  return "Assistente de voz ativo. Toque para desligar a sessão.";
}

function useOrbSize(): number {
  const [size, setSize] = useState(132);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(max-width: 520px)");
    const update = () => setSize(document.getElementById("voice-assistant-slot") ? 56 : query.matches ? 104 : 132);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return size;
}

export function VoiceAssistantHud({
  contextLabel,
  systemInstruction,
  toolGroups,
  executeTool,
  getAccessToken,
  thinkingLevel = "low",
  apiRef,
}: VoiceAssistantHudProps) {
  const [mounted, setMounted] = useState(false);
  const orbSize = useOrbSize();
  const pendingDisconnectRef = useRef(false);
  const disconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleTurnComplete = useCallback(() => {
    if (!pendingDisconnectRef.current) return;
    pendingDisconnectRef.current = false;
    disconnectRef.current?.();
  }, []);

  const config: LiveSessionConfig = useMemo(
    () => ({
      systemInstruction,
      tools: toolGroups,
      temperature: 0.4,
      thinkingLevel,
      labels: DEFAULT_LABELS,
      logPrefix: "RecistepVoice",
      onTurnComplete: handleTurnComplete,
    }),
    [systemInstruction, toolGroups, thinkingLevel, handleTurnComplete],
  );

  const { state, connect, disconnect, toggleMute, sendText } = useLiveSession({
    config,
    executeTool,
    getAccessToken,
  });

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const requestDisconnect = useCallback(() => {
    pendingDisconnectRef.current = true;
  }, []);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { sendText, requestDisconnect, disconnect, state };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, requestDisconnect, sendText, disconnect, state]);

  const supported =
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
  const busy = state.isConnected || state.isConnecting;

  if (!mounted || typeof document === "undefined") return null;

  const statusId = "voice-hud-status";
  const privacyId = "voice-hud-privacy";
  const liveStatus = [
    STATUS_TEXT[state.status],
    state.isMuted ? "microfone silenciado" : null,
    state.currentActionLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const hud = (
    <div className="voice-hud" data-status={state.status}>
      {state.errorMessage && (
        <p className="voice-hud-error" role="alert">
          {state.errorMessage}
        </p>
      )}

      {supported ? (
        <>
          <div className="voice-orb-control">
            <VoiceOrb
              status={state.status}
              userVolume={busy ? state.userVolume : 0}
              agentVolume={busy ? state.agentVolume : 0}
              isMuted={state.isMuted}
              interactive
              size={orbSize}
              label={busy ? orbLabel(state) : "Ativar assistente de voz"}
              onClick={busy ? disconnect : connect}
            />
            {busy && (
              <button
                type="button"
                className="voice-microphone-toggle"
                onClick={toggleMute}
                aria-label={state.isMuted ? "Ativar microfone" : "Silenciar microfone"}
                title={state.isMuted ? "Ativar microfone" : "Silenciar microfone"}
                aria-pressed={state.isMuted}
                aria-describedby={privacyId}
              >
                {state.isMuted ? (
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                    <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M5 11a7 7 0 0 0 12 4.9M19 11a7 7 0 0 1-1.1 3.8M12 19v3m-4 0h8M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                    <rect x="9" y="2.5" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M5 10.5a7 7 0 0 0 14 0M12 17.5v4m-4 0h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="voice-hud-note" role="status">
          Este navegador não permite captura de microfone. Use uma versão recente de Chrome, Edge ou Safari.
        </p>
      )}

      <span id={statusId} className="sr-only" role="status" aria-live="polite">
        {liveStatus}
      </span>
      <span id={privacyId} className="sr-only">
        Assistente de voz no contexto de {contextLabel}. {PRIVACY_NOTE}
      </span>
    </div>
  );

  const headerSlot = document.getElementById("voice-assistant-slot");
  return createPortal(hud, headerSlot ?? document.body);
}
