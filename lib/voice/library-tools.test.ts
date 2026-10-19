import { describe, expect, it, vi } from "vitest";
import {
  LIBRARY_TOOLS,
  executeLibraryTool,
  type LibraryRecipe,
  type LibraryVoiceActions,
  type LibraryVoiceBridge,
} from "./library-tools";

type ToolResult = { success?: boolean; error?: string } & Record<string, any>;

function failure(result: unknown): string {
  const output = result as ToolResult;
  expect(output.success).toBe(false);
  return output.error ?? "";
}

function recipe(overrides: Partial<LibraryRecipe> = {}): LibraryRecipe {
  return {
    id: "recipe-1",
    title: "Bolo de fubá",
    description: "Receita da vovó",
    ingredients_count: 5,
    steps_count: 3,
    servings: 8,
    total_seconds: 3_600,
    prep_seconds: null,
    source_platform: "youtube",
    ...overrides,
  };
}

function makeBridge(recipes: LibraryRecipe[] = [recipe()]): {
  bridge: LibraryVoiceBridge;
  actions: LibraryVoiceActions;
} {
  const actions: LibraryVoiceActions = { open: vi.fn() };
  return { bridge: { recipes, actions }, actions };
}

function run(bridge: LibraryVoiceBridge, name: string, args: Record<string, unknown> = {}) {
  return executeLibraryTool(bridge, name, args, () => undefined);
}

describe("LIBRARY_TOOLS declarations", () => {
  it("marks every declaration non-blocking with a name and description", () => {
    expect(LIBRARY_TOOLS.length).toBeGreaterThanOrEqual(3);
    for (const tool of LIBRARY_TOOLS) {
      expect(tool.behavior).toBe("NON_BLOCKING");
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});

describe("executeLibraryTool — listRecipes", () => {
  it("summarises every saved recipe", () => {
    const { bridge } = makeBridge([recipe(), recipe({ id: "recipe-2", title: "Pão", total_seconds: 1_200 })]);
    const output = run(bridge, "listRecipes") as ToolResult;

    expect(output.success).toBe(true);
    expect(output.count).toBe(2);
    expect(output.recipes[0]).toMatchObject({ id: "recipe-1", title: "Bolo de fubá", duration_minutes: 60 });
    expect(output.recipes[1].duration_minutes).toBe(20);
  });

  it("explains how to add a recipe when there are none", () => {
    const { bridge } = makeBridge([]);
    const output = run(bridge, "listRecipes") as ToolResult;
    expect(output.success).toBe(true);
    expect(output.count).toBe(0);
    expect(output.hint).toContain("Nenhuma receita");
  });

  it("never invents a duration when the recipe has none", () => {
    const { bridge } = makeBridge([recipe({ total_seconds: null, prep_seconds: null })]);
    const output = run(bridge, "listRecipes") as ToolResult;
    expect(output.recipes[0].duration_minutes).toBeNull();
  });
});

describe("executeLibraryTool — findRecipes", () => {
  it("matches names ignoring case and accents", () => {
    const { bridge } = makeBridge([recipe(), recipe({ id: "recipe-2", title: "Pão de Açúcar" })]);
    const output = run(bridge, "findRecipes", { query: "PAO" }) as ToolResult;
    expect(output.found).toBe(true);
    expect(output.count).toBe(1);
    expect(output.recipes[0].id).toBe("recipe-2");
  });

  it("asks for a name and reports when nothing matches", () => {
    const { bridge } = makeBridge();
    expect(failure(run(bridge, "findRecipes", {}))).toContain("Diga o nome");

    const miss = run(bridge, "findRecipes", { query: "lasanha" }) as ToolResult;
    expect(miss.success).toBe(true);
    expect(miss.found).toBe(false);
    expect(miss.hint).toContain("listRecipes");
  });
});

describe("executeLibraryTool — openRecipe", () => {
  it("opens by id without starting the prep", () => {
    const { bridge, actions } = makeBridge();
    const output = run(bridge, "openRecipe", { recipe_id: "recipe-1" }) as ToolResult;

    expect(actions.open).toHaveBeenCalledWith("recipe-1", false);
    expect(output.opened).toBe(true);
    expect(output.start_prep).toBe(false);
    expect(output.message).toContain("Abrindo");
  });

  it("opens by partial name and starts the prep", () => {
    const { bridge, actions } = makeBridge();
    const output = run(bridge, "openRecipe", { name: "fubá", start_prep: true }) as ToolResult;

    expect(actions.open).toHaveBeenCalledWith("recipe-1", true);
    expect(output.start_prep).toBe(true);
    expect(output.message).toContain("iniciando o preparo");
  });

  it("fails when the recipe cannot be resolved", () => {
    const { bridge, actions } = makeBridge();
    expect(failure(run(bridge, "openRecipe", { name: "pizza" }))).toContain("Não encontrei");
    expect(actions.open).not.toHaveBeenCalled();
  });
});

describe("executeLibraryTool — erros", () => {
  it("fails on unknown tool names", () => {
    const { bridge } = makeBridge();
    expect(failure(run(bridge, "deleteEverything"))).toContain("desconhecida");
  });
});
