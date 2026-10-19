import { describe, expect, it, vi } from "vitest";
import {
  SHOPPING_TOOLS,
  executeShoppingTool,
  type ShoppingVoiceActions,
  type ShoppingVoiceBridge,
  type ShoppingList,
} from "./shopping-tools";

type ToolResult = { success?: boolean; error?: string } & Record<string, any>;

function failure(result: unknown): string {
  const output = result as ToolResult;
  expect(output.success).toBe(false);
  return output.error ?? "";
}

function list(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: "list-1",
    title: "Bolo",
    items: [
      { id: "item-1", name: "Farinha de trigo", quantity: 200, unit: "g", notes: null, is_purchased: false },
      { id: "item-2", name: "Ovos", quantity: null, unit: null, notes: "a gosto", is_purchased: true },
    ],
    ...overrides,
  };
}

function makeActions(): ShoppingVoiceActions {
  return {
    setItemPurchased: vi.fn(async () => undefined),
    addItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    createListFromRecipes: vi.fn(async () => ({ id: "list-new", title: "Pão" })),
  };
}

function makeBridge(lists: ShoppingList[] = [list()]): {
  bridge: ShoppingVoiceBridge;
  actions: ShoppingVoiceActions;
} {
  const actions = makeActions();
  return {
    bridge: {
      lists,
      recipes: [
        { id: "recipe-1", title: "Bolo de fubá" },
        { id: "recipe-2", title: "Pão caseiro" },
      ],
      actions,
    },
    actions,
  };
}

function run(bridge: ShoppingVoiceBridge, name: string, args: Record<string, unknown> = {}) {
  return executeShoppingTool(bridge, name, args, () => undefined);
}

describe("SHOPPING_TOOLS declarations", () => {
  it("marks every declaration non-blocking with a name and description", () => {
    expect(SHOPPING_TOOLS.length).toBeGreaterThanOrEqual(6);
    for (const tool of SHOPPING_TOOLS) {
      expect(tool.behavior).toBe("NON_BLOCKING");
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});

describe("executeShoppingTool — leitura", () => {
  it("summarises lists and their purchase progress", async () => {
    const { bridge } = makeBridge();
    const output = (await run(bridge, "listShoppingLists")) as ToolResult;
    expect(output.success).toBe(true);
    expect(output.count).toBe(1);
    expect(output.lists[0]).toMatchObject({ id: "list-1", item_count: 2, purchased_count: 1 });
  });

  it("explains how to create the first list", async () => {
    const { bridge } = makeBridge([]);
    const output = (await run(bridge, "listShoppingLists")) as ToolResult;
    expect(output.count).toBe(0);
    expect(output.hint).toContain("createShoppingListFromRecipes");
  });

  it("lists items using the only list without naming it", async () => {
    const { bridge } = makeBridge();
    const output = (await run(bridge, "listShoppingItems")) as ToolResult;
    expect(output.items).toHaveLength(2);
    expect(output.items[0]).toMatchObject({ name: "Farinha de trigo", quantity_label: "200 g" });
    expect(output.items[1]).toMatchObject({ quantity_label: "quantidade não informada", is_purchased: true });
  });

  it("matches a list by partial title ignoring accents", async () => {
    const { bridge } = makeBridge([list(), list({ id: "list-2", title: "Pão", items: [] })]);
    const output = (await run(bridge, "listShoppingItems", { list_title: "pao" })) as ToolResult;
    expect(output.list.id).toBe("list-2");
  });

  it("fails when the list cannot be resolved", async () => {
    const { bridge } = makeBridge();
    expect(failure(await run(bridge, "listShoppingItems", { list_title: "abacaxi" }))).toContain("Não encontrei essa lista");
  });

  it("lists the available recipes for building lists", async () => {
    const { bridge } = makeBridge();
    const output = (await run(bridge, "listAvailableRecipes")) as ToolResult;
    expect(output.count).toBe(2);
    expect(output.recipes[0]).toEqual({ id: "recipe-1", title: "Bolo de fubá" });
  });
});

describe("executeShoppingTool — escritas", () => {
  it("marks an item as purchased by name", async () => {
    const { bridge, actions } = makeBridge();
    const output = (await run(bridge, "setItemPurchased", { name: "farinha" })) as ToolResult;

    expect(actions.setItemPurchased).toHaveBeenCalledWith("list-1", "item-1", true);
    expect(output.item.is_purchased).toBe(true);
    expect(output.message).toContain("comprado");
  });

  it("unmarks a purchased item when asked", async () => {
    const { bridge, actions } = makeBridge();
    await run(bridge, "setItemPurchased", { name: "Ovos", purchased: false });
    expect(actions.setItemPurchased).toHaveBeenCalledWith("list-1", "item-2", false);
  });

  it("adds an item with the quantity that was informed", async () => {
    const { bridge, actions } = makeBridge();
    const output = (await run(bridge, "addShoppingItem", { name: "Açúcar", quantity: 2, unit: "kg" })) as ToolResult;

    expect(actions.addItem).toHaveBeenCalledWith("list-1", { name: "Açúcar", quantity: 2, unit: "kg", notes: null });
    expect(output.success).toBe(true);
    expect(output.message).toContain("Açúcar");
  });

  it("never invents a quantity for a new item", async () => {
    const { bridge, actions } = makeBridge();
    await run(bridge, "addShoppingItem", { name: "Sal" });
    expect(actions.addItem).toHaveBeenCalledWith("list-1", { name: "Sal", quantity: null, unit: null, notes: null });
  });

  it("requires a name to add an item", async () => {
    const { bridge, actions } = makeBridge();
    expect(failure(await run(bridge, "addShoppingItem", { quantity: 2 }))).toContain("Informe o nome");
    expect(actions.addItem).not.toHaveBeenCalled();
  });

  it("removes an item by name", async () => {
    const { bridge, actions } = makeBridge();
    const output = (await run(bridge, "removeShoppingItem", { name: "Ovos" })) as ToolResult;
    expect(actions.removeItem).toHaveBeenCalledWith("list-1", "item-2");
    expect(output.removed).toBe("Ovos");
  });

  it("generates a list from recipe names and reports the misses", async () => {
    const { bridge, actions } = makeBridge();
    const output = (await run(bridge, "createShoppingListFromRecipes", { recipe_names: ["bolo", "lasanha"] })) as ToolResult;

    expect(actions.createListFromRecipes).toHaveBeenCalledWith(["recipe-1"]);
    expect(output.missing).toEqual(["lasanha"]);
    expect(output.list).toMatchObject({ id: "list-new" });
  });

  it("fails when no recipe can be resolved", async () => {
    const { bridge, actions } = makeBridge();
    expect(failure(await run(bridge, "createShoppingListFromRecipes", {}))).toContain("Informe ao menos uma receita");
    expect(actions.createListFromRecipes).not.toHaveBeenCalled();
  });

  it("fails on unknown tool names", async () => {
    const { bridge } = makeBridge();
    expect(failure(await run(bridge, "burnTheKitchen"))).toContain("desconhecida");
  });
});
