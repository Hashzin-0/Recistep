"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioStreamer } from "@/lib/voice/audio-streamer";
import type { FunctionDeclarationGroup } from "@/lib/voice/function-tool";
import {
  DEFAULT_LIVE_MODEL_ID,
  DEFAULT_LIVE_VOICE_NAME,
  toLiveModelResource,
  type LiveStatus,
  type LiveThinkingLevel,
} from "@/lib/voice/live-config";

const SETUP_TIMEOUT_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1_500;

export interface LiveSessionLabels {
  obtainingToken: string;
  connecting: string;
  configuring: string;
  ready: string;
  listening: string;
  thinking: string;
}

export interface LiveSessionConfig {
  systemInstruction: string;
  tools: FunctionDeclarationGroup[];
  temperature?: number;
  thinkingLevel?: LiveThinkingLevel;
  voiceName?: string;
  labels: LiveSessionLabels;
  logPrefix?: string;
  /** Chamado quando o modelo termina de falar; usado para encerrar a sessão. */
  onTurnComplete?: () => void;
}

export type ExecuteToolFn = (
  name: string,
  args: Record<string, unknown>,
  setActionLabel: (label: string | null) => void,
) => Promise<unknown>;

export type GetAccessTokenFn = () => Promise<string | null>;

export interface LiveSessionState {
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  status: LiveStatus;
  errorMessage: string | null;
  lastUserTranscript: string;
  lastAgentTranscript: string;
  currentActionLabel: string | null;
  userVolume: number;
  agentVolume: number;
}

const INITIAL_STATE: LiveSessionState = {
  isConnected: false,
  isConnecting: false,
  isMuted: false,
  status: "idle",
  errorMessage: null,
  lastUserTranscript: "",
  lastAgentTranscript: "",
  currentActionLabel: null,
  userVolume: 0,
  agentVolume: 0,
};

const DEFAULT_LABELS: LiveSessionLabels = {
  obtainingToken: "Obtendo credencial de voz…",
  connecting: "Conectando ao Gemini Live…",
  configuring: "Configurando…",
  ready: "Pronto • Pode falar",
  listening: "Ouvindo…",
  thinking: "Pensando…",
};

interface Credentials {
  token: string;
  expiresAtMs: number;
  model: string;
  voice: string;
  wsBaseUrl: string;
}

interface TokenResponse {
  data?: {
    token?: string;
    expires_at?: string;
    model?: string;
    voice?: string;
    ws_base_url?: string;
  };
  error?: { message?: string };
}

interface FunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

interface LiveMessage {
  error?: { message?: string; code?: number };
  setupComplete?: unknown;
  sessionResumptionUpdate?: { resumable?: boolean; newHandle?: string };
  toolCall?: { functionCalls?: FunctionCall[] };
  toolCallCancellation?: { ids?: string[] };
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string }; text?: string }> };
    inputTranscription?: { text?: string; finished?: boolean };
    outputTranscription?: { text?: string; finished?: boolean };
    interrupted?: boolean;
    turnComplete?: boolean;
    interactionStatus?: "IN_PROGRESS" | "IDLE";
  };
}

export function useLiveSession({
  config,
  executeTool,
  getAccessToken,
}: {
  config: LiveSessionConfig;
  executeTool: ExecuteToolFn;
  getAccessToken: GetAccessTokenFn;
}) {
  const [state, setState] = useState<LiveSessionState>(INITIAL_STATE);

  const wsRef = useRef<WebSocket | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const configRef = useRef(config);
  const executeToolRef = useRef(executeTool);
  const getAccessTokenRef = useRef(getAccessToken);
  const isMutedRef = useRef(false);
  const stateRef = useRef(state);

  const credentialsRef = useRef<Credentials | null>(null);
  const resumptionHandleRef = useRef<string | null>(null);
  const setupCompletedRef = useRef(false);
  const manualCloseRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolBusyRef = useRef(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    executeToolRef.current = executeTool;
  }, [executeTool]);
  useEffect(() => {
    getAccessTokenRef.current = getAccessToken;
  }, [getAccessToken]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    isMutedRef.current = state.isMuted;
  }, [state.isMuted]);

  const clearSetupTimer = useCallback(() => {
    if (setupTimerRef.current) {
      clearTimeout(setupTimerRef.current);
      setupTimerRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const setActionLabel = useCallback((label: string | null) => {
    setState((previous) => (previous.currentActionLabel === label ? previous : { ...previous, currentActionLabel: label }));
  }, []);

  const setStatus = useCallback((status: LiveStatus) => {
    setState((previous) => (previous.status === status ? previous : { ...previous, status }));
  }, []);

  const fail = useCallback((message: string) => {
    clearSetupTimer();
    setState((previous) => ({
      ...previous,
      isConnecting: false,
      isConnected: false,
      status: "error",
      errorMessage: message,
      currentActionLabel: null,
      userVolume: 0,
      agentVolume: 0,
    }));
  }, [clearSetupTimer]);

  const disconnect = useCallback(() => {
    manualCloseRef.current = true;
    reconnectAttemptsRef.current = 0;
    clearSetupTimer();
    clearReconnectTimer();
    const socket = wsRef.current;
    wsRef.current = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // Socket already closed.
      }
    }
    streamerRef.current?.stopRecording();
    streamerRef.current?.stopPlayback();
    credentialsRef.current = null;
    setupCompletedRef.current = false;
    setState((previous) => ({
      ...previous,
      isConnected: false,
      isConnecting: false,
      status: "idle",
      errorMessage: null,
      currentActionLabel: null,
      userVolume: 0,
      agentVolume: 0,
      lastAgentTranscript: "",
      lastUserTranscript: "",
    }));
  }, [clearReconnectTimer, clearSetupTimer]);

  const requestCredentials = useCallback(async (): Promise<Credentials> => {
    const accessToken = await getAccessTokenRef.current();
    if (!accessToken) {
      throw new Error("Entre na sua conta para usar o assistente de voz.");
    }

    const response = await fetch("/api/v1/voice/token", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !payload.data?.token) {
      throw new Error(payload.error?.message ?? "Não foi possível obter a credencial de voz.");
    }

    const expiresAtMs = payload.data.expires_at ? Date.parse(payload.data.expires_at) : Date.now();
    return {
      token: payload.data.token,
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now(),
      model: payload.data.model ?? "",
      voice: payload.data.voice ?? "",
      wsBaseUrl: payload.data.ws_base_url ?? "",
    };
  }, []);

  const sendToolResponse = useCallback(
    (socket: WebSocket, calls: FunctionCall[]) => {
      // Toda tool precisa de resposta: sem `name` o servidor descarta o retorno
      // e o modelo responde com um erro genérico para o usuário.
      void Promise.all(
        calls.map(async (call) => {
          let output: unknown;
          try {
            if (!call.name) throw new Error("Ferramenta sem nome.");
            output = await executeToolRef.current(call.name, call.args ?? {}, setActionLabel);
          } catch (error) {
            output = {
              success: false,
              error: error instanceof Error ? error.message : "Erro interno ao executar a ferramenta.",
            };
          }
          return {
            id: call.id,
            name: call.name,
            response: { output, scheduling: "WHEN_IDLE" },
          };
        }),
      )
        .then((functionResponses) => {
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
        })
        .catch((error: unknown) => {
          console.error("Falha ao montar toolResponse:", error);
        });
    },
    [setActionLabel],
  );

  const openSocket = useCallback(
    async (options?: { reuseCredentials?: boolean; resume?: boolean }) => {
      const log = configRef.current.logPrefix ?? "Live";
      manualCloseRef.current = false;

      setState((previous) => ({
        ...previous,
        isConnecting: true,
        errorMessage: null,
        status: "connecting",
        currentActionLabel: configRef.current.labels.obtainingToken ?? DEFAULT_LABELS.obtainingToken,
      }));

      // O streamer é criado uma única vez: o AudioContext de saída é reutilizado
      // nas reconexões, sem abrir contextos novos nem depender de novo gesto.
      streamerRef.current?.stopRecording();
      if (!streamerRef.current) streamerRef.current = new AudioStreamer();

      try {
        const canReuse =
          Boolean(options?.reuseCredentials) &&
          credentialsRef.current !== null &&
          credentialsRef.current.expiresAtMs > Date.now() + 5_000;
        if (!canReuse) credentialsRef.current = await requestCredentials();

        const credentials = credentialsRef.current;
        if (!credentials || !credentials.wsBaseUrl) throw new Error("O servidor não informou o endpoint de voz.");

        const labels = configRef.current.labels;
        setActionLabel(labels.connecting ?? DEFAULT_LABELS.connecting);

        const separator = credentials.wsBaseUrl.includes("?") ? "&" : "?";
        const socket = new WebSocket(
          `${credentials.wsBaseUrl}${separator}access_token=${encodeURIComponent(credentials.token)}`,
        );
        wsRef.current = socket;
        setupCompletedRef.current = false;

        const streamer = streamerRef.current ?? new AudioStreamer();
        streamerRef.current = streamer;

        socket.onopen = () => {
          if (wsRef.current !== socket) return;
          setActionLabel(configRef.current.labels.configuring ?? DEFAULT_LABELS.configuring);
          const current = configRef.current;

          socket.send(
            JSON.stringify({
              setup: {
                model: toLiveModelResource(credentials.model || DEFAULT_LIVE_MODEL_ID),
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  temperature: current.temperature ?? 0.4,
                  thinkingConfig: { thinkingLevel: current.thinkingLevel ?? "low" },
                  speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: credentials.voice || DEFAULT_LIVE_VOICE_NAME } },
                  },
                },
                systemInstruction: { parts: [{ text: current.systemInstruction }] },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                tools: current.tools,
                sessionResumption: resumptionHandleRef.current ? { handle: resumptionHandleRef.current } : {},
                realtimeInputConfig: {
                  automaticActivityDetection: {
                    disabled: false,
                    silenceDurationMs: 2_000,
                    prefixPaddingMs: 500,
                    endOfSpeechSensitivity: "END_SENSITIVITY_UNSPECIFIED",
                    startOfSpeechSensitivity: "START_SENSITIVITY_UNSPECIFIED",
                  },
                  activityHandling: "ACTIVITY_HANDLING_UNSPECIFIED",
                  turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY",
                },
              },
            }),
          );

          setupTimerRef.current = setTimeout(() => {
            if (setupCompletedRef.current) return;
            console.error(`[${log}] setupComplete não recebido em ${SETUP_TIMEOUT_MS}ms`);
            manualCloseRef.current = true;
            try {
              socket.close();
            } catch {
              // Ignore.
            }
            fail("Tempo esgotado aguardando a configuração da voz com o Gemini.");
          }, SETUP_TIMEOUT_MS);
        };

        socket.onmessage = async (event: MessageEvent) => {
          if (wsRef.current !== socket) return;
          try {
            const raw = event.data instanceof Blob ? await event.data.text() : event.data;
            if (typeof raw !== "string") return;
            const message = JSON.parse(raw) as LiveMessage;
            const labelsNow = configRef.current.labels;

            if (message.error) {
              const detail = message.error.message ?? String(message.error.code ?? "");
              console.error(`[${log}] erro do Gemini Live: ${detail}`);
              manualCloseRef.current = true;
              clearSetupTimer();
              fail(`Gemini recusou a sessão de voz: ${detail}`);
              try {
                socket.close();
              } catch {
                // Ignore.
              }
              return;
            }

            const resumption = message.sessionResumptionUpdate;
            if (resumption?.resumable && resumption.newHandle) {
              resumptionHandleRef.current = resumption.newHandle;
            }

            if (message.setupComplete !== undefined && setupCompletedRef.current === false) {
              clearSetupTimer();
              setupCompletedRef.current = true;
              reconnectAttemptsRef.current = 0;
              setState((previous) => ({
                ...previous,
                isConnected: true,
                isConnecting: false,
                status: "listening",
                errorMessage: null,
                currentActionLabel: labelsNow.ready ?? DEFAULT_LABELS.ready,
              }));

              const streamer = streamerRef.current;
              if (streamer) {
                try {
                  await streamer.startRecording(
                    (base64Pcm) => {
                      if (socket.readyState === WebSocket.OPEN && !isMutedRef.current) {
                        socket.send(
                          JSON.stringify({
                            realtimeInput: {
                              audio: { mimeType: "audio/pcm;rate=16000", data: base64Pcm },
                            },
                          }),
                        );
                      }
                    },
                    (volume) => setState((previous) => ({ ...previous, userVolume: volume })),
                    (volume) => setState((previous) => ({ ...previous, agentVolume: volume })),
                  );
                } catch {
                  manualCloseRef.current = true;
                  fail("Permissão de microfone negada. Libere o microfone no navegador para conversar.");
                  try {
                    socket.close();
                  } catch {
                    // Ignore.
                  }
                  return;
                }
              }
            }

            const content = message.serverContent;

            if (content?.inputTranscription?.text) {
              setState((previous) => ({ ...previous, lastUserTranscript: content.inputTranscription!.text || previous.lastUserTranscript }));
            }
            if (content?.outputTranscription?.text) {
              setState((previous) => ({ ...previous, lastAgentTranscript: content.outputTranscription!.text || previous.lastAgentTranscript }));
            }

            const parts = content?.modelTurn?.parts;
            if (parts?.length) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  setStatus("speaking");
                  await streamerRef.current?.playPcmChunk(part.inlineData.data);
                }
                if (part.text) {
                  setState((previous) => ({ ...previous, lastAgentTranscript: part.text! }));
                }
              }
            }

            if (content?.interrupted) {
              streamerRef.current?.stopPlayback();
              setStatus("listening");
              setActionLabel(labelsNow.listening ?? DEFAULT_LABELS.listening);
            }

            if (content?.turnComplete) {
              setActionLabel(null);
              if (!streamerRef.current?.isPlaying()) setStatus("listening");
              configRef.current.onTurnComplete?.();
            }

            if (content?.interactionStatus === "IN_PROGRESS") {
              setStatus("thinking");
              if (!toolBusyRef.current) {
                setActionLabel(labelsNow.thinking ?? DEFAULT_LABELS.thinking);
              }
            } else if (content?.interactionStatus === "IDLE" && !streamerRef.current?.isPlaying()) {
              setStatus("listening");
              setActionLabel(labelsNow.listening ?? DEFAULT_LABELS.listening);
            }

            if (message.toolCall?.functionCalls?.length) {
              setStatus("thinking");
              toolBusyRef.current = true;
              try {
                sendToolResponse(socket, message.toolCall.functionCalls);
              } finally {
                toolBusyRef.current = false;
              }
            }
          } catch (error) {
            console.error(`[${log}] falha ao processar mensagem:`, error);
          }
        };

        socket.onerror = () => {
          if (wsRef.current !== socket) return;
          console.error(`[${log}] erro no WebSocket`);
          clearSetupTimer();
          if (!setupCompletedRef.current) fail("Erro na conexão de voz com o Gemini.");
        };

        socket.onclose = (event) => {
          if (wsRef.current !== socket) return;
          clearSetupTimer();
          streamerRef.current?.stopRecording();
          streamerRef.current?.stopPlayback();

          const wasSetup = setupCompletedRef.current;
          setupCompletedRef.current = false;

          if (manualCloseRef.current) {
            setState((previous) => ({
              ...previous,
              isConnected: false,
              isConnecting: false,
              status: previous.status === "error" ? "error" : "idle",
              currentActionLabel: null,
              userVolume: 0,
              agentVolume: 0,
            }));
            return;
          }

          const canRetry =
            wasSetup &&
            reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS &&
            credentialsRef.current !== null &&
            credentialsRef.current.expiresAtMs > Date.now();

          if (canRetry) {
            reconnectAttemptsRef.current += 1;
            setState((previous) => ({
              ...previous,
              isConnected: false,
              isConnecting: true,
              status: "connecting",
              currentActionLabel: "Reconectando…",
            }));
            const attempt = reconnectAttemptsRef.current;
            reconnectTimerRef.current = setTimeout(() => {
              if (manualCloseRef.current) return;
              void openSocket({ reuseCredentials: true, resume: true }).catch((error: unknown) => {
                if (attempt >= MAX_RECONNECT_ATTEMPTS) {
                  fail(error instanceof Error ? error.message : "Não foi possível reconectar a voz.");
                }
              });
            }, RECONNECT_DELAY_MS * attempt);
            if (event.code !== 1000) {
              console.warn(`[${log}] reconexão ${attempt}/${MAX_RECONNECT_ATTEMPTS}: code=${event.code}`);
            }
            return;
          }

          setState((previous) => ({
            ...previous,
            isConnected: false,
            isConnecting: false,
            status: previous.status === "error" ? "error" : "idle",
            currentActionLabel: null,
            userVolume: 0,
            agentVolume: 0,
          }));
        };
      } catch (error) {
        fail(error instanceof Error ? error.message : "Falha ao iniciar a conversa de voz.");
      }
    },
    [clearSetupTimer, fail, requestCredentials, sendToolResponse, setActionLabel, setStatus],
  );

  const connect = useCallback(() => {
    if (stateRef.current.isConnected || stateRef.current.isConnecting) return;
    reconnectAttemptsRef.current = 0;
    void openSocket();
  }, [openSocket]);

  const toggleMute = useCallback(() => {
    setState((previous) => ({ ...previous, isMuted: !previous.isMuted }));
  }, []);

  /**
   * Envia texto como se fosse o usuário falando. Usado pelo modo cozinha para
   * avisar o agente quando um temporizador termina.
   */
  const sendText = useCallback((text: string): boolean => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !text.trim()) return false;
    socket.send(JSON.stringify({ realtimeInput: { text } }));
    return true;
  }, []);

  const toggleConnection = useCallback(() => {
    if (stateRef.current.isConnected || stateRef.current.isConnecting) disconnect();
    else connect();
  }, [connect, disconnect]);

  useEffect(() => {
    return () => {
      manualCloseRef.current = true;
      clearSetupTimer();
      clearReconnectTimer();
      const socket = wsRef.current;
      wsRef.current = null;
      if (socket) {
        try {
          socket.close();
        } catch {
          // Ignore.
        }
      }
      streamerRef.current?.dispose();
      streamerRef.current = null;
    };
  }, [clearReconnectTimer, clearSetupTimer]);

  return {
    state,
    connect,
    disconnect,
    toggleMute,
    toggleConnection,
    sendText,
    setActionLabel,
    setStatus,
  };
}
