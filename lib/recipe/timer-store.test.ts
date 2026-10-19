import { describe, expect, it } from "vitest";
import {
  STANDALONE_TIMER_TITLE,
  createStoredTimer,
  isValidStoredTimer,
  parseStoredTimers,
  serializeStoredTimers,
  sortTimersByUrgency,
  timersForRecipe,
  timersStorageKey,
  toggleStoredTimer,
} from "./timer-store";

function timer(overrides: Partial<Parameters<typeof createStoredTimer>[0]> = {}) {
  return createStoredTimer({
    id: "timer-1",
    durationSeconds: 600,
    recipeId: "recipe-1",
    recipeTitle: "Bolo",
    stepPosition: 2,
    stepNumber: 3,
    stepInstruction: "Asse por 10 minutos.",
    ...overrides,
  }, 1_000_000);
}

describe("timer store", () => {
  it("cria um timer com metadados da receita", () => {
    const created = timer();
    expect(created.id).toBe("timer-1");
    expect(created.endsAt).toBe(1_600_000);
    expect(created.recipeId).toBe("recipe-1");
    expect(created.recipeTitle).toBe("Bolo");
    expect(created.stepNumber).toBe(3);
    expect(isValidStoredTimer(created)).toBe(true);
  });

  it("usa título avulso quando não há receita", () => {
    const created = createStoredTimer({ durationSeconds: 30 }, 1_000);
    expect(created.recipeId).toBeNull();
    expect(created.recipeTitle).toBe(STANDALONE_TIMER_TITLE);
    expect(created.stepNumber).toBeNull();
  });

  it("faz round-trip de serialização", () => {
    const timers = [timer(), timer({ id: "timer-2", recipeTitle: "Torta" })];
    expect(parseStoredTimers(serializeStoredTimers(timers))).toEqual(timers);
  });

  it("ignora JSON inválido e entradas inválidas", () => {
    expect(parseStoredTimers(null)).toEqual([]);
    expect(parseStoredTimers("não é json")).toEqual([]);
    expect(parseStoredTimers(JSON.stringify([{ id: "x" }, null, 42]))).toEqual([]);
    expect(parseStoredTimers(JSON.stringify([{ ...timer(), durationSeconds: 0 }]))).toEqual([]);
  });

  it("remove ids duplicados mantendo a primeira ocorrência", () => {
    const first = timer({ recipeTitle: "Primeiro" });
    const second = timer({ recipeTitle: "Segundo" });
    expect(parseStoredTimers(JSON.stringify([first, second]))).toEqual([first]);
  });

  it("agrupa timers por receita", () => {
    const timers = [timer(), timer({ id: "timer-2", recipeId: "recipe-2" })];
    expect(timersForRecipe(timers, "recipe-1").map((item) => item.id)).toEqual(["timer-1"]);
  });

  it("pausa e retoma preservando o restante", () => {
    const running = timer({ durationSeconds: 60 });
    const paused = toggleStoredTimer(running, 1_020_000);
    expect(paused.endsAt).toBeNull();
    expect(paused.pausedRemainingSeconds).toBe(40);
    const resumed = toggleStoredTimer(paused, 1_100_000);
    expect(resumed.endsAt).toBe(1_140_000);
    expect(resumed.pausedRemainingSeconds).toBeNull();
  });

  it("ordena em andamento, pausado e concluído", () => {
    const running = timer({ id: "running", durationSeconds: 60 });
    const paused = toggleStoredTimer(timer({ id: "paused", durationSeconds: 60 }), 1_010_000);
    const finished = timer({ id: "finished", durationSeconds: 1 });
    const sorted = sortTimersByUrgency([finished, paused, running], 1_020_000);
    expect(sorted.map((item) => item.id)).toEqual(["running", "paused", "finished"]);
  });

  it("separa chaves de armazenamento por conta", () => {
    expect(timersStorageKey("User@Example.com")).toBe("recistep:timers:v1:user@example.com");
    expect(timersStorageKey(null)).toBe("recistep:timers:v1:anon");
  });
});
