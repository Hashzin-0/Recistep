import { describe, expect, it, vi } from "vitest";
import {
  RECIPE_DETAIL_TOOLS,
  executeRecipeDetailTool,
  type RecipeDetail,
  type RecipeDetailVoiceActions,
  type RecipeDetailVoiceBridge,
} from "./recipe-detail-tools";

type ToolResult = { success?: boolean; error?: string } & Record<string, any>;

function failure(result: unknown): string {
  const output = result as ToolResult;
  expect(output.success).toBe(false);
  return output.error ?? "";
}

function recipe(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    id: "recipe-1",
    title: "Bolo de fubá",
    description: "Receita da vovó",
    servings: 8,
    ingredients_count: 5,
    steps_count: 3,
    total_seconds: 3_600,
    rating: 4,
    rating_count: 2,
    has_cover: true,
    has_flowchart: false,
    source_platform: "youtube",
    ...overrides,
  };
}

function makeBridge(overrides: Partial<RecipeDetail> = {}): {
  bridge: RecipeDetailVoiceBridge;
  actions: RecipeDetailVoiceActions;
} {
  const actions: RecipeDetailVoiceActions = {
    rate: vi.fn(async () => undefined),
    startFlowchart: vi.fn(),
    createShoppingList: vi.fn(async () => ({ id: "list-1", title: "Bolo de fubá" })),
    deleteRecipe: vi.fn(async () => undefined),
    openEdit: vi.fn(),
    startPrep: vi.fn(),
  };
  return { bridge: { recipe: recipe(overrides), actions }, actions };
}

function run(bridge: RecipeDetailVoiceBridge, name: string, args: Record<string, unknown> = {}) {
  return executeRecipeDetailTool(bridge, name, args, () => undefined);
}

describe("RECIPE_DETAIL_TOOLS declarations", () => {
  it("marks every declaration non-blocking with a name and description", () => {
    expect(RECIPE_DETAIL_TOOLS.length).toBeGreaterThanOrEqual(7);
    for (const tool of RECIPE_DETAIL_TOOLS) {
      expect(tool.behavior).toBe("NON_BLOCKING");
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});

describe("executeRecipeDetailTool", () => {
  it("summarises the open recipe", async () => {
    const { bridge } = makeBridge();
    const output = (await run(bridge, "getRecipeDetails")) as ToolResult;
    expect(output.recipe).toMatchObject({
      title: "Bolo de fubá",
      ingredients_count: 5,
      steps_count: 3,
      duration: "1 h 0 min",
      rating: 4,
      has_flowchart: false,
    });
  });

  it("saves a rating through the host", async () => {
    const { bridge, actions } = makeBridge();
    const output = (await run(bridge, "rateRecipe", { rating: 5 })) as ToolResult;
    expect(actions.rate).toHaveBeenCalledWith(5);
    expect(output.rating).toBe(5);
  });

  it("rejects ratings outside 1..5", async () => {
    const { bridge, actions } = makeBridge();
    expect(failure(await run(bridge, "rateRecipe", { rating: 9 }))).toContain("1 a 5");
    expect(actions.rate).not.toHaveBeenCalled();
  });

  it("starts the prep through the host", async () => {
    const { bridge, actions } = makeBridge();
    const output = (await run(bridge, "startPrep")) as ToolResult;
    expect(actions.startPrep).toHaveBeenCalled();
    expect(output.started).toBe(true);
  });

  it("kicks off the flowchart without waiting and asks to announce later", async () => {
    const { bridge, actions } = makeBridge();
    const output = (await run(bridge, "generateFlowchart")) as ToolResult;
    expect(actions.startFlowchart).toHaveBeenCalled();
    expect(output.message).toContain("segundo plano");
  });

  it("creates a shopping list and reports its title", async () => {
    const { bridge, actions } = makeBridge();
    const output = (await run(bridge, "createShoppingList")) as ToolResult;
    expect(actions.createShoppingList).toHaveBeenCalled();
    expect(output.message).toContain("Bolo de fubá");
  });

  it("opens the edit screen", async () => {
    const { bridge, actions } = makeBridge();
    await run(bridge, "openRecipeEdit");
    expect(actions.openEdit).toHaveBeenCalled();
  });

  it("asks for confirmation before deleting", async () => {
    const { bridge, actions } = makeBridge();
    const preview = (await run(bridge, "deleteRecipe")) as ToolResult;
    expect(preview.needs_confirmation).toBe(true);
    expect(actions.deleteRecipe).not.toHaveBeenCalled();

    await run(bridge, "deleteRecipe", { confirm: true });
    expect(actions.deleteRecipe).toHaveBeenCalled();
  });

  it("fails on unknown tool names", async () => {
    const { bridge } = makeBridge();
    expect(failure(await run(bridge, "burnTheKitchen"))).toContain("desconhecida");
  });
});
