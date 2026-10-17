"use client";

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { FunctionDeclarationGroup } from "@/lib/voice/function-tool";
import type { LiveThinkingLevel } from "@/lib/voice/live-config";
import {
  useLiveSession,
  type ExecuteToolFn,
  type LiveSessionConfig,
  type LiveSessionLabels,
  type LiveSessionState,
} from "@/lib/voice/live-session";

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
  idle: "Desconectado",
  connecting: "Conectando…",
  listening: "Ouvindo você",
  thinking: "Pensando…",
  speaking: "Falando…",
  error: "Erro de conexão",
};

export interface VoiceAgentPanelProps {
  contextLabel: string;
  systemInstruction: string;
  toolGroups: FunctionDeclarationGroup[];
  executeTool: ExecuteToolFn;
  getAccessToken: () => Promise<string | null>;
  thinkingLevel?: LiveThinkingLevel;
  /** Permite ao componente pai enviar um aviso ao agente (ex.: timer terminou). */
  apiRef?: RefObject<VoiceControlApi | null>;
}

export function VoiceAgentPanel({
  contextLabel,
  systemInstruction,
  toolGroups,
  executeTool,
  getAccessToken,
  thinkingLevel = "low",
  apiRef,
}: VoiceAgentPanelProps) {
  const pendingDisconnectRef = useRef(false);
  const disconnectRef = useRef<(() => void) | null>(null);

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

  return (
    <section className="voice-panel" aria-label={`Assistente de voz — ${contextLabel}`}>
      <div className="kitchen-section-title">
        <h4>Assistente de voz</h4>
        <span>{contextLabel}</span>
      </div>

      {!supported && (
        <p className="kitchen-notice" role="status">
          Este navegador não permite captura de microfone. Use uma versão recente de Chrome, Edge ou Safari.
        </p>
      )}

      {supported && (
        <>
          <div className="voice-status-row">
            <span className={"voice-dot voice-dot-" + state.status} aria-hidden="true" />
            <span className="voice-status-text" role="status" aria-live="polite">
              {STATUS_TEXT[state.status]}
            </span>
          </div>

          {state.currentActionLabel && <p className="field-hint">{state.currentActionLabel}</p>}

          {state.errorMessage && (
            <p className="kitchen-notice voice-error" role="alert">
              {state.errorMessage}
            </p>
          )}

          <div className="voice-actions">
            {!busy ? (
              <button type="button" className="import-button" onClick={connect}>
                Ativar assistente de voz
              </button>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={disconnect}
                disabled={state.isConnecting}
              >
                {state.isConnecting ? "Conectando…" : "Encerrar conversa"}
              </button>
            )}
            {busy && (
              <button type="button" onClick={toggleMute}>
                {state.isMuted ? "Ativar microfone" : "Silenciar microfone"}
              </button>
            )}
          </div>

          {state.lastUserTranscript && (
            <p className="voice-transcript voice-transcript-user">
              <span>Você:</span> {state.lastUserTranscript}
            </p>
          )}

          {state.lastAgentTranscript && (
            <div className="voice-transcript">
              <span className="voice-transcript-label">O assistente está dizendo</span>
              <p>{state.lastAgentTranscript}</p>
            </div>
          )}

          <p className="field-hint">
            O áudio vai do seu navegador direto para o Gemini e não é gravado pelo Recistep.
            Use fones de ouvido para evitar eco, e mantenha a tela visível durante o preparo.
          </p>
        </>
      )}
    </section>
  );
}
