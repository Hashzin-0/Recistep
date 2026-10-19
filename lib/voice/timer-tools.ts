import { formatDuration, remainingTimerSeconds } from "@/lib/recipe/cooking-session";
import {
  MAX_TIMER_DURATION_SECONDS,
  sortTimersByUrgency,
  type StoredTimer,
} from "@/lib/recipe/timer-store";
import { declareReadTool, declareTool, type FunctionDeclaration } from "@/lib/voice/function-tool";

type SetActionLabel = (label: string | null) => void;

export type TimerToolOutput = Record<string, unknown> | { success: false; error: string };

export interface TimerVoiceAddInput {
  durationSeconds: number;
  label?: string | null;
  recipeTitle?: string | null;
}

export interface TimerVoiceActions {
  addTimer(input: TimerVoiceAddInput): StoredTimer;
  pauseOrResumeTimer(timerId: string, nowMs: number): StoredTimer | null;
  removeTimer(timerId: string): StoredTimer | null;
}

export interface TimerVoiceBridge {
  timers: StoredTimer[];
  now: number;
  actions: TimerVoiceActions;
}

function fail(error: string): TimerToolOutput {
  return { success: false, error };
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const raw = args[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function resolveTimer(bridge: TimerVoiceBridge, args: Record<string, unknown>): StoredTimer | null {
  const id = stringArg(args, "timer_id") ?? stringArg(args, "id");
  if (id) {
    const byId = bridge.timers.find((timer) => timer.id === id);
    if (byId) return byId;
  }
  const recipe = stringArg(args, "recipe_title") ?? stringArg(args, "recipe");
  const label = stringArg(args, "label") ?? stringArg(args, "name");
  let candidates = bridge.timers;
  if (recipe) {
    const target = normalize(recipe);
    candidates = candidates.filter((timer) => normalize(timer.recipeTitle).includes(target));
  }
  if (label) {
    const target = normalize(label);
    candidates = candidates.filter((timer) =>
      normalize(timer.stepInstruction ?? "").includes(target) || normalize(timer.recipeTitle).includes(target),
    );
  }
  if (!recipe && !label) return bridge.timers.length === 1 ? bridge.timers[0] : null;
  return candidates.length === 1 ? candidates[0] : null;
}

function timerPayload(timer: StoredTimer, nowMs: number) {
  const remaining = remainingTimerSeconds(timer, nowMs);
  return {
    id: timer.id,
    recipe_id: timer.recipeId,
    recipe_title: timer.recipeTitle,
    step_number: timer.stepNumber,
    instruction: timer.stepInstruction,
    running: timer.endsAt !== null && remaining > 0,
    paused: timer.endsAt === null && remaining > 0,
    finished: remaining === 0,
    remaining_seconds: remaining,
    remaining_label: formatDuration(remaining),
    total_seconds: timer.durationSeconds,
    total_label: formatDuration(timer.durationSeconds),
  };
}

export const TIMER_TOOLS: FunctionDeclaration[] = [
  declareReadTool({
    name: "listTimers",
    description:
      "Lista todos os temporizadores do usuário, com id, receita, etapa e tempo restante. Use antes de pausar, retomar ou remover quando não souber o id.",
  }),
  declareTool({
    name: "startTimer",
    description:
      "Inicia um novo temporizador independente. Informe a duração em segundos (ou em minutos). Use label e recipe_title apenas quando o usuário disser a que se refere; nunca invente.",
    properties: {
      duration_seconds: { type: "NUMBER", description: "Duração em segundos (1 a 604800)." },
      minutes: { type: "NUMBER", description: "Alternativa à duração em segundos, em minutos." },
      label: { type: "STRING", description: "Rótulo curto informado pelo usuário, como 'molho' ou 'forno'." },
      recipe_title: { type: "STRING", description: "Nome da receita relacionada, quando o usuário mencionar." },
    },
    required: ["duration_seconds"],
  }),
  declareTool({
    name: "pauseOrResumeTimer",
    description:
      "Pausa um temporizador em andamento ou retoma um pausado. Identifique pelo timer_id retornado por listTimers; sem id, usa recipe_title/label ou o único temporizador existente.",
    properties: {
      timer_id: { type: "STRING", description: "ID do temporizador retornado por listTimers." },
      recipe_title: { type: "STRING", description: "Nome da receita relacionada." },
      label: { type: "STRING", description: "Rótulo do temporizador." },
    },
  }),
  declareTool({
    name: "removeTimer",
    description:
      "Remove um temporizador, inclusive um concluído. Identifique pelo timer_id retornado por listTimers; sem id, usa recipe_title/label ou o único temporizador existente.",
    properties: {
      timer_id: { type: "STRING", description: "ID do temporizador retornado por listTimers." },
      recipe_title: { type: "STRING", description: "Nome da receita relacionada." },
      label: { type: "STRING", description: "Rótulo do temporizador." },
    },
  }),
];

export function executeTimerTool(
  bridge: TimerVoiceBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): TimerToolOutput {
  switch (name) {
    case "listTimers": {
      setActionLabel("Lendo temporizadores");
      if (bridge.timers.length === 0) {
        return { success: true, count: 0, timers: [], hint: "Nenhum temporizador ativo." };
      }
      return {
        success: true,
        count: bridge.timers.length,
        timers: sortTimersByUrgency(bridge.timers, bridge.now).map((timer) => timerPayload(timer, bridge.now)),
      };
    }

    case "startTimer": {
      const seconds = numberArg(args, "duration_seconds") ?? (numberArg(args, "minutes") ?? 0) * 60;
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TIMER_DURATION_SECONDS) {
        return fail("Informe uma duração entre 1 segundo e 7 dias.");
      }
      const recipeTitle = stringArg(args, "recipe_title") ?? stringArg(args, "recipe");
      const label = stringArg(args, "label") ?? stringArg(args, "name");
      setActionLabel(`Iniciando timer de ${formatDuration(Math.ceil(seconds))}`);
      let timer: StoredTimer;
      try {
        timer = bridge.actions.addTimer({ durationSeconds: Math.ceil(seconds), label, recipeTitle });
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Não foi possível iniciar o temporizador.");
      }
      const preview = { ...bridge, timers: [...bridge.timers, timer] };
      return {
        success: true,
        timer: timerPayload(timer, bridge.now),
        message: `Temporizador de ${formatDuration(timer.durationSeconds)} iniciado.`,
        ...(preview.timers.length > 1 ? { total_timers: preview.timers.length } : {}),
      };
    }

    case "pauseOrResumeTimer": {
      const timer = resolveTimer(bridge, args);
      if (!timer) {
        return fail(
          bridge.timers.length === 0
            ? "Não há temporizadores ativos."
            : "Não encontrei esse temporizador. Use listTimers para ver os IDs e as opções.",
        );
      }
      const wasPaused = timer.endsAt === null;
      const updated = bridge.actions.pauseOrResumeTimer(timer.id, bridge.now);
      if (!updated) return fail("Não foi possível alterar esse temporizador.");
      setActionLabel(wasPaused ? "Retomando temporizador" : "Pausando temporizador");
      const preview = { ...bridge, timers: bridge.timers.map((item) => item.id === updated.id ? updated : item) };
      return {
        success: true,
        timer: timerPayload(updated, bridge.now),
        message: wasPaused ? "Temporizador retomado." : "Temporizador pausado.",
        ...(preview.timers.length > 1 ? { total_timers: preview.timers.length } : {}),
      };
    }

    case "removeTimer": {
      const timer = resolveTimer(bridge, args);
      if (!timer) {
        return fail(
          bridge.timers.length === 0
            ? "Não há temporizadores ativos."
            : "Não encontrei esse temporizador. Use listTimers para ver os IDs e as opções.",
        );
      }
      const removed = bridge.actions.removeTimer(timer.id);
      if (!removed) return fail("Não foi possível remover esse temporizador.");
      setActionLabel("Removendo temporizador");
      return {
        success: true,
        removed: timerPayload(removed, bridge.now),
        message: `Temporizador ${formatDuration(removed.durationSeconds)} removido.`,
      };
    }

    default:
      return fail(`Ferramenta de temporizador desconhecida: ${name}`);
  }
}
