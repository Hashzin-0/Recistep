import { describe, expect, it, vi } from "vitest";
import {
  MANUAL_RECIPE_EDIT_TOOLS,
  MANUAL_RECIPE_SAVE_TOOLS,
  buildManualEditSystemInstruction,
  executeManualRecipeEditTool,
  type ManualRecipeVoiceBridge,
} from "./manual-recipe-tools";
import { createEmptyRecipe } from "@/lib/recipe/recipe-draft";
import type { RecipeExtraction } from "@/lib/schemas/recipe";

type ToolResult = { success?: boolean; error?: string } & Record<string, any>;

function makeBridge(initialDraft = createEmptyRecipe()): {
  bridge: ManualRecipeVoiceBridge;
  commits: RecipeExtraction[];
  save: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  currentDraft: () => RecipeExtraction;
} {
  const commits: RecipeExtraction[] = [];
  const state = { draft: initialDraft };
  const save = vi.fn(async () => undefined);
  const cancel = vi.fn();
  const bridge: ManualRecipeVoiceBridge = {
    get draft() { return state.draft; },
    actions: {
      commit: (next) => { commits.push(next); state.draft = next; },
      save,
      cancel,
    },
  };
  return { bridge, commits, save, cancel, currentDraft: () => state.draft };
}

function run(bridge: ManualRecipeVoiceBridge, name: string, args: Record<string, unknown> = {}) {
  return executeManualRecipeEditTool(bridge, name, args, () => undefined);
}

function failure(result: unknown): string {
  const output = result as ToolResult;
  expect(output.success).toBe(false);
  return output.error ?? "";
}

describe("manual recipe tool declarations", () => {
  it("declares editing and saving tools with names and descriptions", () => {
    for (const tool of [...MANUAL_RECIPE_EDIT_TOOLS, ...MANUAL_RECIPE_SAVE_TOOLS]) {
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
    const names = new Set([...MANUAL_RECIPE_EDIT_TOOLS, ...MANUAL_RECIPE_SAVE_TOOLS].map((tool) => tool.name));
    expect(names.has("saveRecipe")).toBe(true);
    expect(names.has("cancelEditing")).toBe(true);
    expect(names.has("addIngredient")).toBe(true);
  });
});

describe("executeManualRecipeEditTool", () => {
  it("adds an ingredient by delegating to the deterministic editor", async () => {
    const { bridge, commits } = makeBridge();
    bridge.draft.title = "Teste";
    bridge.draft.ingredients = [];
    bridge.draft.steps = [{ position: 0, instruction: "Misture", duration_seconds: null, temperature_value: null, temperature_unit: null, source_evidence: null, confidence: 1 }];
    const before = bridge.draft.ingredients.length;
    const output = (await run(bridge, "addIngredient", { name: "farinha", quantity: 2, unit: "xícara" })) as ToolResult;
    expect(output.success).toBe(true);
    expect(commits).toHaveLength(1);
    expect(bridge.draft.ingredients.length).toBe(before + 1);
    expect(bridge.draft.ingredients.at(-1)?.name).toBe("farinha");
  });

  it("rejects invalid edits without committing", async () => {
    const { bridge, commits } = makeBridge();
    expect(failure(await run(bridge, "updateTitle", { title: "" }))).toBeTruthy();
    expect(commits).toHaveLength(0);
  });

  it("adds a step", async () => {
    const { bridge, commits } = makeBridge();
    bridge.draft.title = "Teste";
    bridge.draft.ingredients = [{ name: "farinha", section: "Ingredientes", quantity: 2, quantity_text: null, quantity_min: null, quantity_max: null, unit: "xícara", unit_normalized: null, notes: null, source_evidence: null, confidence: 1 }];
    bridge.draft.steps = [{ position: 0, instruction: "Misture", duration_seconds: null, duration_text: null, duration_min_seconds: null, duration_max_seconds: null, temperature_value: null, temperature_unit: null, video_start_seconds: null, video_end_seconds: null, source_evidence: null, confidence: 1 }];
    const before = bridge.draft.steps.length;
    const output = (await run(bridge, "addStep", { instruction: "Misture tudo" })) as ToolResult;
    expect(output.success).toBe(true);
    expect(commits).toHaveLength(1);
    expect(bridge.draft.steps.length).toBe(before + 1);
    expect(bridge.draft.steps.at(-1)?.instruction).toBe("Misture tudo");
  });

  it("saves through the host when the user asks", async () => {
    const { bridge, save } = makeBridge();
    const output = (await run(bridge, "saveRecipe")) as ToolResult;
    expect(output.success).toBe(true);
    expect(save).toHaveBeenCalled();
  });

  it("cancels the editing through the host", async () => {
    const { bridge, cancel } = makeBridge();
    const output = (await run(bridge, "cancelEditing")) as ToolResult;
    expect(output.success).toBe(true);
    expect(output.cancelled).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });

  it("fails on unknown tools", async () => {
    const { bridge } = makeBridge();
    expect(failure(await run(bridge, "burnTheKitchen"))).toContain("desconhecida");
  });
});

describe("buildManualEditSystemInstruction", () => {
  it("instructs to ask for the name when the draft is empty", () => {
    const draft = { ...createEmptyRecipe(), title: "", ingredients: [], steps: [] };
    const instruction = buildManualEditSystemInstruction(draft);
    expect(instruction).toContain("praticamente vazia");
    expect(instruction).toContain("Nunca invente");
  });

  it("includes the current draft when it has content", () => {
    const draft = createEmptyRecipe();
    draft.title = "Bolo de fubá";
    draft.servings = 8;
    draft.ingredients.push({ name: "fubá", quantity: 2, unit: "xícara", notes: null, source_evidence: null, confidence: 1 });
    draft.steps.push({ position: 1, instruction: "Misture e asse", duration_seconds: null, temperature_value: null, temperature_unit: null, source_evidence: null, confidence: 1 });
    const instruction = buildManualEditSystemInstruction(draft);
    expect(instruction).toContain("Bolo de fubá");
    expect(instruction).toContain("fubá");
  });
});
