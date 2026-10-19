import { describe, expect, it, vi } from "vitest";
import { createStoredTimer, toggleStoredTimer, type StoredTimer } from "@/lib/recipe/timer-store";
import { TIMER_TOOLS, executeTimerTool, type TimerVoiceBridge } from "./timer-tools";

function makeTimer(overrides: Partial<Parameters<typeof createStoredTimer>[0]> = {}): StoredTimer {
  return createStoredTimer({
    id: "timer-1",
    durationSeconds: 600,
    recipeId: "recipe-1",
    recipeTitle: "Bolo",
    stepPosition: 1,
    stepNumber: 2,
    stepInstruction: "Leve ao forno.",
    ...overrides,
  }, 1_000_000);
}

function makeBridge(timers: StoredTimer[] = [makeTimer()], now = 1_100_000): TimerVoiceBridge {
  return {
    timers,
    now,
    actions: {
      addTimer: vi.fn((input) => createStoredTimer({ ...input, id: "timer-new" }, now)),
      pauseOrResumeTimer: vi.fn((timerId, nowMs) => {
        const timer = timers.find((item) => item.id === timerId);
        return timer ? toggleStoredTimer(timer, nowMs) : null;
      }),
      removeTimer: vi.fn((timerId) => timers.find((item) => item.id === timerId) ?? null),
    },
  };
}

describe("timer voice tools", () => {
  it("declara as ferramentas de listar, iniciar, pausar/retomar e remover", () => {
    expect(TIMER_TOOLS.map((tool) => tool.name)).toEqual([
      "listTimers",
      "startTimer",
      "pauseOrResumeTimer",
      "removeTimer",
    ]);
  });

  it("lista timers com status e tempo restante", () => {
    const bridge = makeBridge();
    const output = executeTimerTool(bridge, "listTimers", {}, vi.fn());
    expect(output).toMatchObject({
      success: true,
      count: 1,
      timers: [{ id: "timer-1", recipe_title: "Bolo", running: true, remaining_seconds: 500 }],
    });
  });

  it("inicia timer avulso convertendo minutos", () => {
    const bridge = makeBridge();
    const output = executeTimerTool(bridge, "startTimer", { minutes: 2, label: "molho" }, vi.fn());
    expect(bridge.actions.addTimer).toHaveBeenCalledWith({ durationSeconds: 120, label: "molho", recipeTitle: null });
    expect(output).toMatchObject({ success: true, timer: { id: "timer-new", total_seconds: 120 } });
  });

  it("rejeita duração inválida", () => {
    const bridge = makeBridge();
    const output = executeTimerTool(bridge, "startTimer", { duration_seconds: 0 }, vi.fn());
    expect(output).toEqual({ success: false, error: "Informe uma duração entre 1 segundo e 7 dias." });
    expect(bridge.actions.addTimer).not.toHaveBeenCalled();
  });

  it("pausa o timer informado e retorna o novo estado", () => {
    const bridge = makeBridge();
    const output = executeTimerTool(bridge, "pauseOrResumeTimer", { timer_id: "timer-1" }, vi.fn());
    expect(bridge.actions.pauseOrResumeTimer).toHaveBeenCalledWith("timer-1", 1_100_000);
    expect(output).toMatchObject({ success: true, message: "Temporizador pausado.", timer: { paused: true, remaining_seconds: 500 } });
  });

  it("remove o timer pelo rótulo", () => {
    const bridge = makeBridge();
    const output = executeTimerTool(bridge, "removeTimer", { label: "forno" }, vi.fn());
    expect(bridge.actions.removeTimer).toHaveBeenCalledWith("timer-1");
    expect(output).toMatchObject({ success: true, message: "Temporizador 10:00 removido." });
  });

  it("pede a lista quando há mais de um timer e nenhum critério", () => {
    const bridge = makeBridge([
      makeTimer(),
      makeTimer({ id: "timer-2", recipeTitle: "Torta" }),
    ]);
    const output = executeTimerTool(bridge, "removeTimer", {}, vi.fn());
    expect(output).toEqual({
      success: false,
      error: "Não encontrei esse temporizador. Use listTimers para ver os IDs e as opções.",
    });
  });
});
