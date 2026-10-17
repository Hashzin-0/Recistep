import { describe, expect, it, vi } from "vitest";
import type { RecipeExtraction } from "@/lib/schemas/recipe";
import {
  KITCHEN_TOOLS,
  RECIPE_EDIT_TOOLS,
  executeKitchenTool,
  executeRecipeEditTool,
  withToggledIngredient,
  withToggledStep,
  type KitchenVoiceActions,
  type KitchenVoiceBridge,
} from "./recipe-tools";

type ToolResult = { success?: boolean; error?: string } & Record<string, unknown>;

function failure(result: unknown): string {
  const output = result as ToolResult;
  expect(output.success).toBe(false);
  return output.error ?? "";
}

function makeActions(): KitchenVoiceActions {
  return {
    chooseStep: vi.fn(),
    toggleStepComplete: vi.fn(),
    toggleIngredient: vi.fn(),
    startTimer: vi.fn(),
    pauseOrResumeTimer: vi.fn(),
    resetTimer: vi.fn(),
    setNotice: vi.fn(),
  };
}

const NOW = 1_700_000_000_000;

function makeBridge(): { bridge: KitchenVoiceBridge; actions: KitchenVoiceActions } {
  const actions = makeActions();
  const bridge: KitchenVoiceBridge = {
    title: "Bolo de fubá",
    servings: 4,
    ingredients: [
      { name: "Farinha de trigo", quantity: 200, unit: "g", notes: null },
      { name: "Ovos", quantity: null, unit: null, notes: "a gosto" },
      { name: "Sal", quantity: 1, unit: "colher de chá", notes: null },
    ],
    steps: [
      { position: 1, instruction: "Misture os secos", duration_seconds: 300, temperature_value: null, temperature_unit: null },
      { position: 2, instruction: "Bata a massa", duration_seconds: null, temperature_value: null, temperature_unit: null },
      { position: 3, instruction: "Asse", duration_seconds: 1_800, temperature_value: 180, temperature_unit: "C" },
    ],
    session: { completedSteps: [], checkedIngredients: [], currentStep: 1, timer: null },
    timerRemainingSeconds: null,
    now: NOW,
    actions,
  };
  return { bridge, actions };
}

function run(
  bridge: KitchenVoiceBridge,
  name: string,
  args: Record<string, unknown> = {},
): unknown {
  return executeKitchenTool(bridge, name, args, () => undefined);
}

describe("KITCHEN_TOOLS declarations", () => {
  it("marks every kitchen declaration as non-blocking", () => {
    expect(KITCHEN_TOOLS.length).toBeGreaterThan(10);
    for (const tool of KITCHEN_TOOLS) {
      expect(tool.behavior).toBe("NON_BLOCKING");
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("keeps every edit declaration non-blocking as well", () => {
    for (const tool of RECIPE_EDIT_TOOLS) {
      expect(tool.behavior).toBe("NON_BLOCKING");
    }
  });
});

describe("executeKitchenTool — leitura", () => {
  it("summarises the recipe and its progress", () => {
    const { bridge } = makeBridge();
    const output = run(bridge, "getRecipeOverview") as Record<string, any>;

    expect(output.success).toBe(true);
    expect(output.title).toBe("Bolo de fubá");
    expect(output.servings).toBe(4);
    expect(output.ingredient_count).toBe(3);
    expect(output.step_count).toBe(3);
    expect(output.progress.current_step_number).toBe(1);
    expect(output.current_step.instruction).toBe("Misture os secos");
  });

  it("paginates steps and asks for getStep to read the full text", () => {
    const { bridge } = makeBridge();
    const output = run(bridge, "listSteps", { start_number: 2, count: 1 }) as Record<string, any>;

    expect(output.success).toBe(true);
    expect(output.total_steps).toBe(3);
    expect(output.steps).toHaveLength(1);
    expect(output.steps[0].step_number).toBe(2);
    expect(output.steps[0].instruction).toBe("Bata a massa");
    expect(output.hint).toContain("getStep");
  });

  it("filters ingredients without inventing anything when there is no match", () => {
    const { bridge } = makeBridge();
    const hit = run(bridge, "listIngredients", { name: "FARINHA" }) as Record<string, any>;
    expect(hit.success).toBe(true);
    expect(hit.ingredients).toHaveLength(1);
    expect(hit.ingredients[0].name).toBe("Farinha de trigo");

    const miss = run(bridge, "listIngredients", { name: "chocolate" }) as Record<string, any>;
    expect(miss.success).toBe(true);
    expect(miss.found).toBe(false);
    expect(miss.ingredients).toEqual([]);
    expect(miss.hint).toContain("listIngredients");
  });

  it("rejects steps outside the recipe", () => {
    const { bridge } = makeBridge();
    expect(failure(run(bridge, "getStep", { step_number: 9 }))).toContain("não existe");
    expect(failure(run(bridge, "goToStep", { step_number: 0 }))).toContain("não existe");
    expect(failure(run(bridge, "goToStep", {}))).toContain("Informe o número");
  });

  it("exposes the timer as inactive when there is none", () => {
    const { bridge } = makeBridge();
    const output = run(bridge, "getTimerStatus") as Record<string, any>;
    expect(output.timer).toEqual({ active: false });
  });
});

describe("executeKitchenTool — condução do preparo", () => {
  it("selects a step and reports it", () => {
    const { bridge, actions } = makeBridge();
    const output = run(bridge, "goToStep", { step_number: 3 }) as Record<string, any>;

    expect(actions.chooseStep).toHaveBeenCalledWith(3);
    expect(output.success).toBe(true);
    expect(output.step.temperature).toBe("180°C");
    expect(output.message).toContain("Etapa 3");
  });

  it("advances and rewinds inside the recipe bounds", () => {
    const { bridge, actions } = makeBridge();

    run(bridge, "nextStep");
    expect(actions.chooseStep).toHaveBeenLastCalledWith(2);
    run(bridge, "previousStep");
    expect(actions.chooseStep).toHaveBeenLastCalledWith(1);

    const last: KitchenVoiceBridge = { ...bridge, session: { ...bridge.session, currentStep: 3 } };
    run(last, "nextStep");
    expect(actions.chooseStep).toHaveBeenLastCalledWith(3);
  });

  it("marks a step complete and previews the new position", () => {
    const { bridge, actions } = makeBridge();
    const output = run(bridge, "markStepComplete", { step_number: 1 }) as Record<string, any>;

    expect(actions.toggleStepComplete).toHaveBeenCalledWith(1);
    expect(output.success).toBe(true);
    expect(output.current_step_number).toBe(2);
    expect(output.progress.completed_steps).toBe(1);
  });

  it("does not toggle a step that is already complete", () => {
    const { bridge, actions } = makeBridge();
    bridge.session.completedSteps = [1];

    const output = run(bridge, "markStepComplete", { step_number: 1 }) as Record<string, any>;
    expect(actions.toggleStepComplete).not.toHaveBeenCalled();
    expect(output.success).toBe(true);
  });

  it("reopens a step only when it was complete", () => {
    const { bridge, actions } = makeBridge();

    run(bridge, "reopenStep", { step_number: 2 });
    expect(actions.toggleStepComplete).not.toHaveBeenCalled();

    bridge.session.completedSteps = [2];
    run(bridge, "reopenStep", { step_number: 2 });
    expect(actions.toggleStepComplete).toHaveBeenCalledWith(2);
  });

  it("finds ingredients by name ignoring case and accents", () => {
    const { bridge, actions } = makeBridge();
    const output = run(bridge, "setIngredientChecked", { name: "ovos", checked: true }) as Record<string, any>;

    expect(actions.toggleIngredient).toHaveBeenCalledWith(1);
    expect(output.ingredient.name).toBe("Ovos");
    expect(output.ingredient.checked).toBe(true);

    expect(failure(run(bridge, "setIngredientChecked", { name: "erva-doce" }))).toContain("Não encontrei");
  });

  it("keeps the current state when the requested state is already active", () => {
    const { bridge, actions } = makeBridge();
    const output = run(bridge, "setIngredientChecked", { name: "sal", checked: false }) as Record<string, any>;

    expect(actions.toggleIngredient).not.toHaveBeenCalled();
    expect(output.ingredient.checked).toBe(false);
  });
});

describe("executeKitchenTool — temporizador", () => {
  it("starts a timer with explicit minutes and previews the payload", () => {
    const { bridge, actions } = makeBridge();
    const output = run(bridge, "startTimer", { minutes: 10, step_number: 3 }) as Record<string, any>;

    expect(actions.startTimer).toHaveBeenCalledWith(3, 600);
    expect(output.success).toBe(true);
    expect(output.timer.active).toBe(true);
    expect(output.timer.running).toBe(true);
    expect(output.timer.step_number).toBe(3);
    expect(output.message).toContain("10:00");
  });

  it("falls back to the step duration when no time is given", () => {
    const { bridge, actions } = makeBridge();
    run(bridge, "startTimer", { step_number: 1 });
    expect(actions.startTimer).toHaveBeenCalledWith(1, 300);
  });

  it("refuses to guess a duration for a step without one", () => {
    const { bridge, actions } = makeBridge();
    expect(failure(run(bridge, "startTimer", { step_number: 2 }))).toContain("não tem tempo definido");
    expect(actions.startTimer).not.toHaveBeenCalled();
    expect(failure(run(bridge, "startTimer", { step_number: 2, seconds: -5 }))).toContain("não tem tempo definido");
  });

  it("pauses a running timer using the bridge clock", () => {
    const { bridge, actions } = makeBridge();
    bridge.session.timer = { stepPosition: 1, durationSeconds: 600, endsAt: NOW + 600_000, pausedRemainingSeconds: null };
    bridge.timerRemainingSeconds = 600;

    const output = run(bridge, "pauseOrResumeTimer") as Record<string, any>;
    expect(actions.pauseOrResumeTimer).toHaveBeenCalledWith(NOW);
    expect(output.timer.running).toBe(false);
    expect(output.message).toContain("pausado");
  });

  it("resumes a paused timer", () => {
    const { bridge, actions } = makeBridge();
    bridge.session.timer = { stepPosition: 1, durationSeconds: 600, endsAt: null, pausedRemainingSeconds: 120 };
    const output = run(bridge, "pauseOrResumeTimer") as Record<string, any>;
    expect(actions.pauseOrResumeTimer).toHaveBeenCalledWith(NOW);
    expect(output.timer.running).toBe(true);
    expect(output.message).toContain("retomado");
  });

  it("requires an active timer to pause or reset", () => {
    const { bridge, actions } = makeBridge();
    expect(failure(run(bridge, "pauseOrResumeTimer"))).toContain("Não há temporizador");
    expect(failure(run(bridge, "resetTimer"))).toContain("Não há temporizador");
    expect(actions.resetTimer).not.toHaveBeenCalled();
  });

  it("asks the host to end the session when the user is done", () => {
    const { bridge, actions } = makeBridge();
    const output = run(bridge, "stopVoiceGuidance") as Record<string, any>;
    expect(output.success).toBe(true);
    expect(actions.setNotice).toHaveBeenCalled();
  });

  it("fails on unknown tool names", () => {
    const { bridge } = makeBridge();
    expect(failure(run(bridge, "fryEverything"))).toContain("desconhecida");
  });
});

describe("shared session helpers", () => {
  it("moves the current step to the next pending one when completing", () => {
    const { bridge } = makeBridge();
    const next = withToggledStep(bridge.session, bridge.steps, 1);

    expect(next.completedSteps).toEqual([1]);
    expect(next.currentStep).toBe(2);
    expect(withToggledStep(next, bridge.steps, 1).completedSteps).toEqual([]);
  });

  it("toggles ingredient checks without touching the step state", () => {
    const { bridge } = makeBridge();
    const checked = withToggledIngredient(bridge.session, 2);
    expect(checked.checkedIngredients).toEqual([2]);
    expect(checked.currentStep).toBe(bridge.session.currentStep);
    expect(withToggledIngredient(checked, 2).checkedIngredients).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

function makeDraft(): RecipeExtraction {
  return {
    title: "Bolo de fubá",
    description: "Receita da vovó",
    source_language: "pt",
    servings: 4,
    timings: { prep_seconds: null, cook_seconds: null, total_seconds: null },
    ingredients: [
      { name: "Fubá", quantity: 200, unit: "g", notes: null, source_evidence: null, confidence: 1 },
      { name: "Leite", quantity: 500, unit: "ml", notes: null, source_evidence: null, confidence: 1 },
    ],
    steps: [
      { position: 0, instruction: "Misture tudo", duration_seconds: 300, temperature_value: null, temperature_unit: null, source_evidence: null, confidence: 1 },
      { position: 1, instruction: "Asse em forno médio", duration_seconds: 1_800, temperature_value: 180, temperature_unit: "C", source_evidence: null, confidence: 1 },
    ],
    uncertainties: [],
    warnings: [],
  };
}

function editBridge(initialDraft = makeDraft()) {
  const commits: RecipeExtraction[] = [];
  const state = { draft: initialDraft };
  const runTool = (name: string, args: Record<string, unknown> = {}) =>
    executeRecipeEditTool(
      { draft: state.draft, actions: { commit: (next) => { commits.push(next); state.draft = next; } } },
      name,
      args,
      () => undefined,
    );
  return { runTool, commits, currentDraft: () => state.draft };
}

describe("executeRecipeEditTool — leitura", () => {
  it("returns the draft with a truncated view of the content", () => {
    const { runTool } = editBridge();
    const output = runTool("getRecipeDraft") as Record<string, any>;

    expect(output.success).toBe(true);
    expect(output.title).toBe("Bolo de fubá");
    expect(output.ingredient_count).toBe(2);
    expect(output.steps).toHaveLength(2);
    expect(output.steps[1].temperature).toBe("180°C");
  });

  it("lists ingredients and steps with their positions", () => {
    const { runTool } = editBridge();
    const ingredients = runTool("listDraftIngredients") as Record<string, any>;
    expect(ingredients.ingredients[1].index).toBe(1);
    expect(ingredients.ingredients[0].quantity_label).toBe("200 g");

    const steps = runTool("listDraftSteps") as Record<string, any>;
    expect(steps.steps.map((step: any) => step.position)).toEqual([0, 1]);
  });

  it("tells the model that only the user can confirm the recipe", () => {
    const { runTool, commits } = editBridge();
    const output = runTool("confirmRecipe") as Record<string, any>;
    expect(output.success).toBe(true);
    expect(output.hint).toContain("Confirmar receita");
    expect(commits).toHaveLength(0);
  });
});

describe("executeRecipeEditTool — campos", () => {
  it("updates and clears the title and description", () => {
    const { runTool, commits } = editBridge();

    runTool("updateTitle", { title: "  Bolo de fubá da vó  " });
    expect(commits[0].title).toBe("Bolo de fubá da vó");

    runTool("updateDescription", { clear: true });
    expect(commits[1].description).toBeNull();

    expect(failure(runTool("updateTitle", { title: "   " }))).toContain("Informe o novo nome");
    expect(failure(runTool("updateDescription", {}))).toContain("Informe a nova descrição");
  });

  it("refuses a title that does not fit the recipe schema", () => {
    const { runTool, commits } = editBridge();
    expect(failure(runTool("updateTitle", { title: "x".repeat(300) }))).toContain("Alteração recusada");
    expect(commits).toHaveLength(0);
  });

  it("stores unknown servings as null and scales only known servings", () => {
    const { runTool, commits } = editBridge();

    runTool("setServings", { servings: 0 });
    expect(commits.at(-1)!.servings).toBeNull();

    const noServings = makeDraft();
    noServings.servings = null;
    const failed = executeRecipeEditTool(
      { draft: noServings, actions: { commit: vi.fn() } },
      "scaleServings",
      { target: 8 },
      () => undefined,
    );
    expect(failure(failed)).toContain("setServings");
  });

  it("recalculates ingredient quantities for another number of servings", () => {
    const { runTool, commits } = editBridge();
    runTool("scaleServings", { target: 8 });

    const next = commits[0] as RecipeExtraction;
    expect(next.servings).toBe(8);
    expect(next.ingredients[0].quantity).toBe(400);
    expect(next.ingredients[1].quantity).toBe(1_000);
  });

  it("edits one ingredient and rejects non-positive quantities", () => {
    const { runTool, commits } = editBridge();

    runTool("updateIngredient", { index: 0, unit: "xícara", notes: "peneirado" });
    expect(commits[0].ingredients[0]).toMatchObject({ unit: "xícara", notes: "peneirado", quantity: 200 });

    expect(failure(runTool("updateIngredient", { index: 0, quantity: 0 }))).toContain("Alteração recusada");
    expect(failure(runTool("updateIngredient", { index: 9, name: "nada" }))).toContain("não existe");
    expect(commits).toHaveLength(1);
  });

  it("clears a quantity only when asked", () => {
    const { runTool, commits } = editBridge();
    runTool("updateIngredient", { index: 1, clear_quantity: true });
    expect(commits[0].ingredients[1].quantity).toBeNull();
  });

  it("adds and removes ingredients by index", () => {
    const { runTool, commits } = editBridge();

    runTool("addIngredient", { name: "Açúcar", quantity: 100, unit: "g" });
    const withSugar = commits[0] as RecipeExtraction;
    expect(withSugar.ingredients).toHaveLength(3);
    expect(withSugar.ingredients[2]).toMatchObject({ name: "Açúcar", quantity: 100, unit: "g" });

    expect(failure(runTool("addIngredient", { quantity: 5 }))).toContain("Informe o nome");

    runTool("removeIngredient", { index: 2 });
    const removed = commits[1] as RecipeExtraction;
    expect(removed.ingredients).toHaveLength(2);
    expect(failure(runTool("removeIngredient", { index: 4 }))).toContain("não existe");
  });
});

describe("executeRecipeEditTool — etapas", () => {
  it("updates step fields and clears them explicitly", () => {
    const { runTool, commits } = editBridge();

    runTool("updateStep", { position: 0, instruction: "Misture delicadamente", duration_seconds: 600 });
    expect(commits[0].steps[0]).toMatchObject({
      instruction: "Misture delicadamente",
      duration_seconds: 600,
    });

    runTool("updateStep", { position: 0, clear_duration: true, clear_temperature: true });
    expect(commits[1].steps[0].duration_seconds).toBeNull();
    expect(commits[1].steps[0].temperature_value).toBeNull();
  });

  it("rejects unknown temperature units and missing steps", () => {
    const { runTool, commits } = editBridge();
    expect(failure(runTool("updateStep", { position: 0, temperature_unit: "K" }))).toContain("'C' ou 'F'");
    expect(failure(runTool("updateStep", { position: 42, instruction: "x" }))).toContain("não existe");
    expect(commits).toHaveLength(0);
  });

  it("inserts a step after a position and reindexes the rest", () => {
    const { runTool, commits } = editBridge();

    runTool("addStep", { instruction: "Bata as claras", after_position: 0, duration_seconds: 120 });
    const next = commits[0] as RecipeExtraction;

    expect(next.steps.map((step) => step.position)).toEqual([0, 1, 2]);
    expect(next.steps.map((step) => step.instruction)).toEqual(["Misture tudo", "Bata as claras", "Asse em forno médio"]);
    expect(failure(runTool("addStep", {}))).toContain("Informe a instrução");
  });

  it("removes a step but never leaves the recipe without one", () => {
    const { runTool, commits } = editBridge();

    runTool("removeStep", { position: 0 });
    const next = commits[0] as RecipeExtraction;
    expect(next.steps).toHaveLength(1);
    expect(next.steps[0].position).toBe(0);

    expect(failure(runTool("removeStep", { position: 0 }))).toContain("pelo menos uma etapa");
    expect(failure(runTool("removeStep", { position: 99 }))).toContain("não existe");
  });

  it("fails on unknown tool names", () => {
    const { runTool } = editBridge();
    expect(failure(runTool("teleportIngredient"))).toContain("desconhecida");
  });
});
