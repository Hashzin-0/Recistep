import { describe, expect, it, vi } from "vitest";
import {
  MANUAL_RECIPE_EDIT_TOOLS,
  MANUAL_RECIPE_SAVE_TOOLS,
  buildManualEditSystemInstruction,
  executeManualRecipeEditTool,
  type ManualRecipeVoiceBridge,
} from "./manual-recipe-tools";
import { createEmptyRecipe } from "@/lib/recipe/recipe-draft";

type ToolResult = { success?: boolean; error?: string } & Record<string, any>;

function makeBridge(draft = createEmptyRecipe()): {
  bridge: ManualRecipeVoiceBridge;
  commit: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const commit = vi.fn();
  const save = vi.fn(async () => undefined);
  const cancel = vi.fn();
  return { bridge: { draft, actions: { commit, save, cancel } }, commit, save, cancel };
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
    const { bridge, commit } = makeBridge();
    const before = bridge.draft.ingredients.length;
    const output = (await run(bridge, "addIngredient", { name: "farinha", quantity: 2, unit: "xícara" })) as ToolResult;
    expect(output.success).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(bridge.draft.ingredients.length).toBe(before + 1);
    expect(bridge.draft.ingredients.at(-1)?.name).toBe("farinha");
  });

  it("rejects invalid edits without committing", async () => {
    const { bridge, commit } = makeBridge();
    expect(failure(await run(bridge, "updateTitle", { title: "" }))).toBeTruthy();
    expect(commit).not.toHaveBeenCalled();
  });

  it("adds a step", async () => {
    const { bridge, commit } = makeBridge();
    const before = bridge.draft.steps.length;
    const output = (await run(bridge, "addStep", { instruction: "Misture tudo" })) as ToolResult;
    expect(output.success).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
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
    const draft = { ...createEmptyRecipe(), ingredients: [], steps: [] };
    const instruction = buildManualEditSystemInstruction(draft);
    expect(instruction).toContain("praticamente vazia");
    expect(instruction).toContain("Nunca invente");
  });

  it("includes the current draft when it has content", () => {
    const draft = createEmptyRecipe();
    draft.title = "Bolo de fubá";
    draft.servings = 8;
    draft.ingredients.push({ name: "fubá", quantity: 2, unit: "xícara", notes: null, position: 0 });
    draft.steps.push({ instruction: "Misture e asse", position: 0, duration_seconds: null, temperature_value: null, temperature_unit: null, video_start_seconds: null });
    const instruction = buildManualEditSystemInstruction(draft);
    expect(instruction).toContain("Bolo de fubá");
    expect(instruction).toContain("fubá");
  });
});
