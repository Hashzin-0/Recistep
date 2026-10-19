"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { VoiceOrb } from "@/components/voice-orb";
import type { LiveSessionState } from "@/lib/voice/live-session";

// A HUD apresenta o assistente: um botão de ondas sonoras quando inativo e o
// orb animado quando a sessão está ativa. O orb é a única parte animada, para
// não manter canvas em loop em dispositivos fracos.

export interface VoiceAssistantHudProps {
  state: LiveSessionState;
  contextLabel: string;
  onActivate: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
}

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

function orbLabel(state: LiveSessionState): string {
  if (state.status === "connecting") return "Conectando o assistente de voz. Aguarde.";
  if (state.errorMessage) return "Assistente de voz com erro. Toque para tentar de novo.";
  if (state.isMuted) return "Assistente de voz ativo, microfone silenciado. Toque para desligar a sessão.";
  return "Assistente de voz ativo. Toque para desligar a sessão.";
}

function activateLabel(state: LiveSessionState): string {
  return state.errorMessage ? "Tentar novamente o assistente de voz" : "Ativar assistente de voz";
}

function useOrbSize(): number {
  const [size, setSize] = useState(132);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(max-width: 520px)");
    const update = () => {
      const inHeader = Boolean(document.getElementById("voice-assistant-slot"));
      setSize(inHeader ? (query.matches ? 44 : 56) : query.matches ? 104 : 132);
    };
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

function SoundWaveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <circle cx="6" cy="12" r="1.8" fill="currentColor" />
      <path d="M10 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M13.2 5.5a9 9 0 0 1 0 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16.4 2.5a13 13 0 0 1 0 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function VoiceAssistantHud({
  state,
  contextLabel,
  onActivate,
  onDisconnect,
  onToggleMute,
}: VoiceAssistantHudProps) {
  const [mounted, setMounted] = useState(false);
  const orbSize = useOrbSize();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  const supported =
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
  const active = state.isConnected || state.isConnecting;

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
    <div className="voice-hud" data-status={state.status} data-active={active ? "true" : "false"}>
      {state.errorMessage && (
        <p className="voice-hud-error" role="alert">
          {state.errorMessage}
        </p>
      )}

      {supported ? (
        active ? (
          <div className="voice-orb-control">
            <VoiceOrb
              status={state.status}
              userVolume={state.userVolume}
              agentVolume={state.agentVolume}
              isMuted={state.isMuted}
              interactive
              size={orbSize}
              label={orbLabel(state)}
              onClick={onDisconnect}
              onLongPress={onToggleMute}
            />
            <button
              type="button"
              className="voice-microphone-toggle"
              onClick={onToggleMute}
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
          </div>
        ) : (
          <button
            type="button"
            className="voice-activate-button"
            onClick={onActivate}
            aria-label={activateLabel(state)}
            title={activateLabel(state)}
            aria-describedby={privacyId}
          >
            <SoundWaveIcon />
          </button>
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

  const headerSlot = document.getElementById("voice-assistant-slot");
  return createPortal(hud, headerSlot ?? document.body);
}
