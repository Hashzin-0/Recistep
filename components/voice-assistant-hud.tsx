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

// HUD flutuante do assistente de voz: um orb no canto inferior direito.
// Conectado, mostra só o orb (clique encerra, segurar silencia); desconectado,
// mostra o orb parado com o botão de ativar. O texto fica só para leitores de
// tela, porque a resposta principal é o áudio.

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
  if (state.isMuted) {
    return "Assistente de voz ativo com o microfone silenciado. Toque para encerrar a conversa; segure para reativar o microfone.";
  }
  return "Assistente de voz ativo. Toque para encerrar a conversa; segure para silenciar o microfone.";
}

function useOrbSize(): number {
  const [size, setSize] = useState(132);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(max-width: 520px)");
    const update = () => setSize(query.matches ? 104 : 132);
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
        busy ? (
          <VoiceOrb
            status={state.status}
            userVolume={state.userVolume}
            agentVolume={state.agentVolume}
            isMuted={state.isMuted}
            interactive
            size={orbSize}
            label={orbLabel(state)}
            onClick={disconnect}
            onLongPress={toggleMute}
          />
        ) : (
          <div className="voice-hud-idle">
            <VoiceOrb
              status={state.status}
              userVolume={0}
              agentVolume={0}
              isMuted={false}
              size={orbSize}
            />
            <button type="button" className="import-button" onClick={connect} aria-describedby={privacyId}>
              Ativar assistente de voz
            </button>
          </div>
        )
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

  return createPortal(hud, document.body);
}
