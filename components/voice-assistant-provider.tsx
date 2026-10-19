"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/auth-provider";
import { VoiceAssistantHud } from "@/components/voice-assistant-hud";
import type { FunctionDeclarationGroup } from "@/lib/voice/function-tool";
import type { LiveThinkingLevel } from "@/lib/voice/live-config";
import {
  useLiveSession,
  type ExecuteToolFn,
  type LiveSessionConfig,
  type LiveSessionLabels,
} from "@/lib/voice/live-session";

// Assistente de voz único e global. Cada tela registra o seu contexto (key,
// instrução, ferramentas e executor); o provider mantém a sessão e a HUD.

export interface VoiceContextConfig {
  /** Identidade estável da tela; trocar o key reconfigura a sessão ativa. */
  key: string;
  contextLabel: string;
  systemInstruction: string;
  toolGroups: FunctionDeclarationGroup[];
  executeTool: ExecuteToolFn;
  thinkingLevel?: LiveThinkingLevel;
}

export interface VoiceAssistantControls {
  connect(): void;
  disconnect(): void;
  requestDisconnect(): void;
  sendText(text: string): boolean;
}

interface VoiceAssistantContextValue {
  register(id: symbol, config: VoiceContextConfig): () => void;
  controls: VoiceAssistantControls;
}

const VoiceAssistantContext = createContext<VoiceAssistantContextValue | null>(null);

const DEFAULT_LABELS: LiveSessionLabels = {
  obtainingToken: "Obtendo credencial de voz…",
  connecting: "Conectando ao Gemini Live…",
  configuring: "Configurando…",
  ready: "Pronto • Pode falar",
  listening: "Ouvindo…",
  thinking: "Pensando…",
};

const DEFAULT_SYSTEM_INSTRUCTION = [
  "Você é o assistente de voz do Recistep, um aplicativo que organiza receitas e ajuda no preparo.",
  "Fale em português do Brasil, de forma curta e natural.",
  "Ajude com dúvidas de culinária e explique o que dá para fazer na tela atual do aplicativo.",
  "Nunca invente quantidades, unidades, temperaturas, porções, tempos ou dados de uma receita que você não leu.",
].join("\n");

const defaultExecuteTool: ExecuteToolFn = async (name) => ({
  success: false,
  error: `A ferramenta ${name} não está disponível nesta tela.`,
});

const DEFAULT_CONFIG: VoiceContextConfig = {
  key: "default",
  contextLabel: "Assistente de voz",
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
  toolGroups: [],
  executeTool: defaultExecuteTool,
  thinkingLevel: "low",
};

const RECONNECT_DEBOUNCE_MS = 400;

export function VoiceAssistantProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, signedInEmail } = useAuth();
  const [registrations, setRegistrations] = useState<{ id: symbol; config: VoiceContextConfig }[]>([]);

  const register = useCallback((id: symbol, config: VoiceContextConfig) => {
    setRegistrations((previous) => [...previous.filter((entry) => entry.id !== id), { id, config }]);
    return () => {
      setRegistrations((previous) => previous.filter((entry) => entry.id !== id));
    };
  }, []);

  const active = registrations.length > 0 ? registrations[registrations.length - 1].config : DEFAULT_CONFIG;

  const pendingDisconnectRef = useRef(false);
  const disconnectRef = useRef<() => void>(() => {});
  const handleTurnComplete = useCallback(() => {
    if (!pendingDisconnectRef.current) return;
    pendingDisconnectRef.current = false;
    disconnectRef.current();
  }, []);

  const liveConfig = useMemo<LiveSessionConfig>(() => ({
    systemInstruction: active.systemInstruction,
    tools: active.toolGroups,
    temperature: 0.4,
    thinkingLevel: active.thinkingLevel ?? "low",
    labels: DEFAULT_LABELS,
    logPrefix: "RecistepVoice",
    onTurnComplete: handleTurnComplete,
  }), [active.systemInstruction, active.toolGroups, active.thinkingLevel, handleTurnComplete]);

  const session = useLiveSession({ config: liveConfig, executeTool: active.executeTool, getAccessToken });

  useEffect(() => {
    disconnectRef.current = session.disconnect;
  }, [session.disconnect]);

  const requestDisconnect = useCallback(() => {
    pendingDisconnectRef.current = true;
  }, []);

  const controls = useMemo<VoiceAssistantControls>(() => ({
    connect: session.connect,
    disconnect: session.disconnect,
    requestDisconnect,
    sendText: session.sendText,
  }), [session.connect, session.disconnect, requestDisconnect, session.sendText]);

  const value = useMemo<VoiceAssistantContextValue>(() => ({ register, controls }), [register, controls]);

  // Troca de tela enquanto a sessão está ligada exige um novo setup, porque a
  // Live API fixa instrução e ferramentas no handshake.
  const activeKey = active.key;
  const activeKeyRef = useRef(activeKey);
  const reconnect = session.reconnect;
  useEffect(() => {
    if (activeKeyRef.current === activeKey) return;
    activeKeyRef.current = activeKey;
    if (!session.state.isConnected && !session.state.isConnecting) return;
    const timer = setTimeout(() => reconnect(), RECONNECT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [activeKey, reconnect, session.state.isConnected, session.state.isConnecting]);

  useEffect(() => {
    if (!signedInEmail && (session.state.isConnected || session.state.isConnecting)) session.disconnect();
  }, [signedInEmail, session.state.isConnected, session.state.isConnecting, session.disconnect]);

  return (
    <VoiceAssistantContext.Provider value={value}>
      {children}
      {signedInEmail && (
        <VoiceAssistantHud
          state={session.state}
          contextLabel={active.contextLabel}
          onActivate={session.connect}
          onDisconnect={session.disconnect}
          onToggleMute={session.toggleMute}
        />
      )}
    </VoiceAssistantContext.Provider>
  );
}

/**
 * Registra o contexto de voz da tela atual. O `config` deve ser memoizado
 * (ex.: useMemo) para não re-registrar a cada render.
 */
export function useVoiceAssistantContext(config: VoiceContextConfig): void {
  const context = useContext(VoiceAssistantContext);
  if (!context) throw new Error("useVoiceAssistantContext precisa estar dentro de VoiceAssistantProvider.");
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol("voice-context");
  const id = idRef.current;
  const { register } = context;
  useEffect(() => register(id, config), [register, id, config]);
}

export function useVoiceAssistantControls(): VoiceAssistantControls {
  const context = useContext(VoiceAssistantContext);
  if (!context) throw new Error("useVoiceAssistantControls precisa estar dentro de VoiceAssistantProvider.");
  return context.controls;
}
