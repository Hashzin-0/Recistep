import { formatVideoClock, type VideoController } from "@/lib/recipe/video-player";
import type { VideoDisplay } from "@/lib/recipe/video-display";
import { declareReadTool, declareTool, type FunctionDeclaration } from "@/lib/voice/function-tool";

// Ferramentas de voz para controlar a reprodução do vídeo original durante o
// preparo. O controlador é obtido por uma ponte que o React registra; todas as
// ações degradam para uma falha explícita quando o vídeo não é controlável.

type SetActionLabel = (label: string | null) => void;

export type VideoToolOutput = Record<string, unknown> | { success: false; error: string };

export interface VideoStep {
  position: number;
  instruction: string;
  video_start_seconds: number | null;
  video_end_seconds: number | null;
}

export interface VideoVoiceBridge {
  display: VideoDisplay | null;
  steps: VideoStep[];
  currentStepPosition: number;
  getController(): VideoController | null;
  chooseStep(position: number): void;
  setNotice(message: string): void;
}

function fail(error: string): VideoToolOutput {
  return { success: false, error };
}

function intArg(args: Record<string, unknown>, key: string): number | null {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stepNumber(bridge: VideoVoiceBridge, position: number): number {
  return bridge.steps.findIndex((step) => step.position === position) + 1;
}

function readStep(bridge: VideoVoiceBridge, number: number): VideoStep | null {
  const index = number - 1;
  if (!Number.isInteger(index) || index < 0 || index >= bridge.steps.length) return null;
  return bridge.steps[index];
}

function controllerOrNull(bridge: VideoVoiceBridge): VideoController | null {
  const controller = bridge.getController();
  if (!controller) return null;
  return controller.getState().controllable ? controller : null;
}

const NO_CONTROL_ERROR =
  "Este vídeo não é controlável pelo aplicativo (a plataforma faz a reprodução). Use os controles na tela.";

function initialPrompt(bridge: VideoVoiceBridge): string {
  const controller = controllerOrNull(bridge);
  if (!bridge.display) return "Esta receita não tem vídeo de origem.";
  if (!controller) return NO_CONTROL_ERROR;
  return "";
}

export const VIDEO_TOOLS: FunctionDeclaration[] = [
  declareReadTool({
    name: "getVideoStatus",
    description:
      "Informa se a receita tem vídeo de origem, se ele é controlável, se está tocando, o tempo atual, a duração e se a etapa atual tem um tempo marcado no vídeo. Use antes de prometer qualquer controle.",
  }),
  declareTool({
    name: "playVideo",
    description: "Reproduz o vídeo de origem a partir do ponto atual.",
  }),
  declareTool({
    name: "pauseVideo",
    description: "Pausa o vídeo de origem.",
  }),
  declareTool({
    name: "toggleVideo",
    description: "Alterna entre reproduzir e pausar o vídeo de origem.",
  }),
  declareTool({
    name: "seekVideoToStep",
    description:
      "Vai direto ao trecho do vídeo onde a etapa acontece, pelo tempo marcado. Sem step_number, usa a etapa atual. Só funciona quando a etapa tem tempo de vídeo registrado.",
    properties: { step_number: { type: "NUMBER", description: "Número da etapa (1 = primeira etapa)." } },
  }),
  declareTool({
    name: "nextVideoStep",
    description: "Avança para a próxima etapa que tem um tempo marcado no vídeo e reproduz a partir dele.",
  }),
  declareTool({
    name: "previousVideoStep",
    description: "Volta para a etapa anterior que tem um tempo marcado no vídeo e reproduz a partir dele.",
  }),
  declareTool({
    name: "replayVideoStep",
    description: "Reinicia o trecho do vídeo da etapa atual (ou da etapa informada) desde o começo dela.",
    properties: { step_number: { type: "NUMBER", description: "Número da etapa (1 = primeira etapa)." } },
  }),
  declareTool({
    name: "seekVideoBy",
    description:
      "Adianta ou retrocede o vídeo em segundos. Use segundos positivos para adiantar e negativos para retroceder.",
    properties: { seconds: { type: "NUMBER", description: "Segundos a avançar (positivo) ou retroceder (negativo)." } },
    required: ["seconds"],
  }),
  declareTool({
    name: "replayLastSeconds",
    description:
      "Retrocede alguns segundos e retoma a reprodução, para rever um trecho que acabou de passar. Sem valor, usa 15 segundos.",
    properties: { seconds: { type: "NUMBER", description: "Quantos segundos retroceder (5 a 120)." } },
  }),
  declareTool({
    name: "setVideoPlaybackRate",
    description: "Ajusta a velocidade de reprodução do vídeo (0,25x a 2x).",
    properties: { rate: { type: "NUMBER", description: "Velocidade desejada, por exemplo 0.5, 1, 1.5 ou 2." } },
    required: ["rate"],
  }),
];

function stepVideoPayload(bridge: VideoVoiceBridge, step: VideoStep) {
  return {
    step_number: stepNumber(bridge, step.position),
    has_video_time: step.video_start_seconds !== null,
    video_start_seconds: step.video_start_seconds,
    video_start_label: step.video_start_seconds === null ? null : formatVideoClock(step.video_start_seconds),
    video_end_seconds: step.video_end_seconds,
  };
}

function statePayload(bridge: VideoVoiceBridge, controller: VideoController) {
  const state = controller.getState();
  return {
    controllable: state.controllable,
    playing: state.playing,
    current_time: state.current_time,
    current_time_label: formatVideoClock(state.current_time),
    duration: state.duration,
    duration_label: state.duration > 0 ? formatVideoClock(state.duration) : null,
    playback_rate: state.playback_rate,
  };
}

export function executeVideoTool(
  bridge: VideoVoiceBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): VideoToolOutput {
  const controller = controllerOrNull(bridge);

  switch (name) {
    case "getVideoStatus": {
      setActionLabel("Conferindo o vídeo");
      const current = bridge.steps.find((step) => step.position === bridge.currentStepPosition) ?? null;
      if (!bridge.display) {
        return { success: true, has_video: false, hint: "Esta receita não tem vídeo de origem." };
      }
      return {
        success: true,
        has_video: true,
        platform: bridge.display.platform,
        ...(controller ? statePayload(bridge, controller) : { controllable: false, playing: false, current_time: 0, current_time_label: "00:00", duration: null, playback_rate: 1 }),
        current_step: current ? stepVideoPayload(bridge, current) : null,
      };
    }

    case "playVideo":
    case "pauseVideo":
    case "toggleVideo":
    case "seekVideoBy":
    case "replayLastSeconds":
    case "setVideoPlaybackRate": {
      const unavailable = initialPrompt(bridge);
      if (unavailable) return fail(unavailable);
      if (!controller || !bridge.display) return fail(NO_CONTROL_ERROR);

      if (name === "playVideo") {
        controller.play();
        setActionLabel("Reproduzindo o vídeo");
        return { success: true, ...statePayload(bridge, controller), message: "Vídeo reproduzindo." };
      }
      if (name === "pauseVideo") {
        controller.pause();
        setActionLabel("Pausando o vídeo");
        return { success: true, ...statePayload(bridge, controller), message: "Vídeo pausado." };
      }
      if (name === "toggleVideo") {
        controller.toggle();
        setActionLabel("Alternando o vídeo");
        return { success: true, ...statePayload(bridge, controller), message: "Reprodução alternada." };
      }
      if (name === "seekVideoBy") {
        const seconds = intArg(args, "seconds");
        if (seconds === null || seconds === 0) return fail("Informe quantos segundos avançar ou retroceder.");
        controller.seekBy(seconds);
        setActionLabel(seconds > 0 ? "Adiantando o vídeo" : "Retrocedendo o vídeo");
        return { success: true, ...statePayload(bridge, controller), message: seconds > 0 ? `Adiantado ${seconds}s.` : `Retrocedido ${Math.abs(seconds)}s.` };
      }
      if (name === "replayLastSeconds") {
        const raw = intArg(args, "seconds");
        const seconds = clamp(raw ?? 15, 5, 120);
        controller.seekBy(-seconds);
        controller.play();
        setActionLabel("Repetindo o trecho");
        return { success: true, ...statePayload(bridge, controller), message: `Retrocedido ${seconds}s e retomando.` };
      }
      const rate = intArg(args, "rate");
      if (rate === null || rate <= 0) return fail("Informe uma velocidade válida (0,25x a 2x).");
      const wanted = clamp(rate, 0.25, 2);
      controller.setRate(wanted);
      setActionLabel(`Velocidade ${wanted}x`);
      return { success: true, ...statePayload(bridge, controller), message: `Velocidade ajustada para ${wanted}x.` };
    }

    case "seekVideoToStep":
    case "replayVideoStep":
    case "nextVideoStep":
    case "previousVideoStep": {
      const unavailable = initialPrompt(bridge);
      if (unavailable) return fail(unavailable);
      if (!controller) return fail(NO_CONTROL_ERROR);

      if (name === "nextVideoStep" || name === "previousVideoStep") {
        const withTime = bridge.steps.filter((step) => step.video_start_seconds !== null);
        if (withTime.length === 0) return fail("Nenhuma etapa tem tempo de vídeo marcado.");
        const currentIndex = withTime.findIndex((step) => step.position === bridge.currentStepPosition);
        const base = currentIndex === -1 ? (name === "nextVideoStep" ? -1 : withTime.length) : currentIndex;
        const targetIndex = name === "nextVideoStep" ? base + 1 : base - 1;
        const target = withTime[targetIndex];
        if (!target || target.video_start_seconds === null) return fail("Não há outro trecho de vídeo nessa direção.");
        bridge.chooseStep(target.position);
        controller.seek(target.video_start_seconds);
        controller.play();
        setActionLabel(`Etapa ${stepNumber(bridge, target.position)} no vídeo`);
        return {
          success: true,
          step: stepVideoPayload(bridge, target),
          ...statePayload(bridge, controller),
          message: `Vídeo na etapa ${stepNumber(bridge, target.position)} (${formatVideoClock(target.video_start_seconds)}).`,
        };
      }

      const requested = intArg(args, "step_number") ?? stepNumber(bridge, bridge.currentStepPosition);
      const step = readStep(bridge, requested);
      if (!step) return fail(`Etapa ${requested} não existe. A receita tem ${bridge.steps.length} etapas.`);
      if (step.video_start_seconds === null) {
        return fail(`A etapa ${requested} não tem tempo de vídeo marcado.`);
      }
      bridge.chooseStep(step.position);
      controller.seek(step.video_start_seconds);
      if (name === "replayVideoStep") controller.play();
      setActionLabel(`Etapa ${requested} no vídeo`);
      return {
        success: true,
        step: stepVideoPayload(bridge, step),
        ...statePayload(bridge, controller),
        message: `Vídeo posicionado em ${formatVideoClock(step.video_start_seconds)} (etapa ${requested}).`,
      };
    }

    default:
      return fail(`Ferramenta de vídeo desconhecida: ${name}`);
  }
}
