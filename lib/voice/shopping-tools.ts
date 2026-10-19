import { declareReadTool, declareTool, type FunctionDeclaration } from "@/lib/voice/function-tool";

// Ferramentas de voz para a tela "Lista de compras": ler listas e itens, marcar
// como comprado, adicionar/remover itens e gerar uma lista a partir de receitas.
// As escritas passam pela rede por ações que a página registra e confirmam o
// estado com os dados retornados pela API.

type SetActionLabel = (label: string | null) => void;

export type ToolOutput = Record<string, unknown> | { success: false; error: string };

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  is_purchased: boolean;
}

export interface ShoppingList {
  id: string;
  title: string;
  items: ShoppingItem[];
}

export interface ShoppingRecipeOption {
  id: string;
  title: string;
}

export interface ShoppingVoiceActions {
  setItemPurchased(listId: string, itemId: string, purchased: boolean): Promise<void>;
  addItem(listId: string, input: { name: string; quantity: number | null; unit: string | null; notes: string | null }): Promise<void>;
  removeItem(listId: string, itemId: string): Promise<void>;
  createListFromRecipes(recipeIds: string[], servings?: number[] | null): Promise<{ id?: string; title?: string } | void>;
}

export interface ShoppingVoiceBridge {
  lists: ShoppingList[];
  recipes: ShoppingRecipeOption[];
  actions: ShoppingVoiceActions;
}

function fail(error: string): ToolOutput {
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

function stringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const raw = args[key];
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveList(bridge: ShoppingVoiceBridge, args: Record<string, unknown>): ShoppingList | null {
  const id = stringArg(args, "list_id") ?? stringArg(args, "id");
  if (id) {
    const byId = bridge.lists.find((list) => list.id === id);
    if (byId) return byId;
  }
  const query = stringArg(args, "list_title") ?? stringArg(args, "list_name") ?? stringArg(args, "list") ?? stringArg(args, "title");
  if (!query) return bridge.lists.length === 1 ? bridge.lists[0] : null;
  const target = normalize(query);
  const exact = bridge.lists.find((list) => normalize(list.title) === target);
  if (exact) return exact;
  const partial = bridge.lists.find((list) => normalize(list.title).includes(target));
  return partial ?? null;
}

function resolveItem(list: ShoppingList, args: Record<string, unknown>): ShoppingItem | null {
  const id = stringArg(args, "item_id") ?? stringArg(args, "id");
  if (id) {
    const byId = list.items.find((item) => item.id === id);
    if (byId) return byId;
  }
  const query = stringArg(args, "name") ?? stringArg(args, "item_name") ?? stringArg(args, "item");
  if (!query) return null;
  const target = normalize(query);
  const exact = list.items.find((item) => normalize(item.name) === target);
  if (exact) return exact;
  const partial = list.items.find((item) => normalize(item.name).includes(target));
  if (partial) return partial;
  const reverse = list.items.find((item) => target.includes(normalize(item.name)));
  return reverse ?? null;
}

function itemPayload(item: ShoppingItem) {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    notes: item.notes,
    quantity_label: item.quantity === null ? "quantidade não informada" : `${item.quantity}${item.unit ? " " + item.unit : ""}`,
    is_purchased: item.is_purchased,
  };
}

function listPayload(list: ShoppingList) {
  return {
    id: list.id,
    title: list.title,
    item_count: list.items.length,
    purchased_count: list.items.filter((item) => item.is_purchased).length,
  };
}

function resolveRecipeIds(bridge: ShoppingVoiceBridge, args: Record<string, unknown>): { ids: string[]; missing: string[] } {
  const ids = stringArrayArg(args, "recipe_ids");
  const names = stringArrayArg(args, "recipe_names");
  const missing: string[] = [];
  const resolved = new Set(ids.filter((id) => bridge.recipes.some((recipe) => recipe.id === id)));
  for (const name of names) {
    const target = normalize(name);
    const match = bridge.recipes.find((recipe) => normalize(recipe.title) === target)
      ?? bridge.recipes.find((recipe) => normalize(recipe.title).includes(target));
    if (match) resolved.add(match.id);
    else missing.push(name);
  }
  return { ids: [...resolved], missing };
}

export const SHOPPING_TOOLS: FunctionDeclaration[] = [
  declareReadTool({
    name: "listShoppingLists",
    description: "Lista as listas de compras do usuário, com id, título e quantos itens estão comprados. Use primeiro quando não souber qual lista usar.",
  }),
  declareTool({
    name: "listShoppingItems",
    description: "Lista os itens de uma lista de compras. Identifique a lista por list_id ou pelo título; sem informar, usa a única lista quando existe apenas uma.",
    properties: {
      list_id: { type: "STRING", description: "ID da lista retornado por listShoppingLists." },
      list_title: { type: "STRING", description: "Título da lista, completo ou parcial." },
    },
  }),
  declareReadTool({
    name: "listAvailableRecipes",
    description: "Lista as receitas salvas que podem ser usadas para gerar uma lista de compras, com id e título.",
  }),
  declareTool({
    name: "setItemPurchased",
    description: "Marca ou desmarca um item como comprado. Identifique a lista e o item pelo nome (parcial funciona) ou pelos ids.",
    properties: {
      list_id: { type: "STRING", description: "ID da lista." },
      list_title: { type: "STRING", description: "Título da lista." },
      item_id: { type: "STRING", description: "ID do item." },
      name: { type: "STRING", description: "Nome do item, completo ou parcial." },
      purchased: { type: "BOOLEAN", description: "true para marcar como comprado; false para desmarcar." },
    },
  }),
  declareTool({
    name: "addShoppingItem",
    description: "Adiciona um novo item à lista de compras. Quantidade e unidade são opcionais; não estime valores que o usuário não informou.",
    properties: {
      list_id: { type: "STRING", description: "ID da lista." },
      list_title: { type: "STRING", description: "Título da lista." },
      name: { type: "STRING", description: "Nome do item (obrigatório)." },
      quantity: { type: "NUMBER", description: "Quantidade, quando informada." },
      unit: { type: "STRING", description: "Unidade da quantidade (ex: 'kg', 'un')." },
      notes: { type: "STRING", description: "Observações opcionais." },
    },
    required: ["name"],
  }),
  declareTool({
    name: "removeShoppingItem",
    description: "Remove um item da lista de compras. Identifique o item pelo nome (parcial funciona) ou pelo id.",
    properties: {
      list_id: { type: "STRING", description: "ID da lista." },
      list_title: { type: "STRING", description: "Título da lista." },
      item_id: { type: "STRING", description: "ID do item." },
      name: { type: "STRING", description: "Nome do item, completo ou parcial." },
    },
  }),
  declareTool({
    name: "createShoppingListFromRecipes",
    description: "Gera uma nova lista de compras a partir de uma ou mais receitas salvas. Identifique as receitas por nome (parcial funciona) ou por id.",
    properties: {
      recipe_ids: { type: "ARRAY", description: "IDs das receitas.", items: { type: "STRING" } },
      recipe_names: { type: "ARRAY", description: "Nomes das receitas.", items: { type: "STRING" } },
    },
  }),
];

export async function executeShoppingTool(
  bridge: ShoppingVoiceBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): Promise<ToolOutput> {
  switch (name) {
    case "listShoppingLists": {
      setActionLabel("Lendo suas listas");
      if (bridge.lists.length === 0) {
        return {
          success: true,
          count: 0,
          lists: [],
          hint: "Nenhuma lista ainda. Use createShoppingListFromRecipes para gerar uma.",
        };
      }
      return { success: true, count: bridge.lists.length, lists: bridge.lists.map(listPayload) };
    }

    case "listShoppingItems": {
      const list = resolveList(bridge, args);
      if (!list) {
        return fail(
          bridge.lists.length === 0
            ? "Não há listas de compras. Use createShoppingListFromRecipes para criar uma."
            : "Não encontrei essa lista. Use listShoppingLists para ver as listas disponíveis.",
        );
      }
      setActionLabel(`Lendo ${list.title}`);
      return { success: true, list: listPayload(list), items: list.items.map(itemPayload) };
    }

    case "listAvailableRecipes": {
      setActionLabel("Lendo suas receitas");
      return {
        success: true,
        count: bridge.recipes.length,
        recipes: bridge.recipes.map((recipe) => ({ id: recipe.id, title: recipe.title })),
      };
    }

    case "setItemPurchased": {
      const list = resolveList(bridge, args);
      if (!list) return fail("Não encontrei essa lista. Use listShoppingLists para ver as opções.");
      const item = resolveItem(list, args);
      if (!item) return fail("Não encontrei esse item na lista.");
      const purchased = args.purchased === undefined || args.purchased === null ? true : Boolean(args.purchased);
      setActionLabel(purchased ? `Marcando ${item.name}` : `Desmarcando ${item.name}`);
      await bridge.actions.setItemPurchased(list.id, item.id, purchased);
      return {
        success: true,
        item: { ...itemPayload(item), is_purchased: purchased },
        message: purchased ? `${item.name} marcado como comprado.` : `${item.name} desmarcado.`,
      };
    }

    case "addShoppingItem": {
      const list = resolveList(bridge, args);
      if (!list) {
        return fail(
          bridge.lists.length === 0
            ? "Não há listas de compras. Use createShoppingListFromRecipes para criar uma antes de adicionar itens."
            : "Não encontrei essa lista. Use listShoppingLists para ver as opções.",
        );
      }
      const itemName = stringArg(args, "name");
      if (!itemName) return fail("Informe o nome do item.");
      const input = {
        name: itemName,
        quantity: optionalNumber(args.quantity),
        unit: stringArg(args, "unit"),
        notes: stringArg(args, "notes"),
      };
      setActionLabel(`Adicionando ${itemName}`);
      await bridge.actions.addItem(list.id, input);
      return {
        success: true,
        added: itemName,
        quantity: input.quantity,
        unit: input.unit,
        message: `${itemName} adicionado à lista ${list.title}.`,
      };
    }

    case "removeShoppingItem": {
      const list = resolveList(bridge, args);
      if (!list) return fail("Não encontrei essa lista. Use listShoppingLists para ver as opções.");
      const item = resolveItem(list, args);
      if (!item) return fail("Não encontrei esse item na lista.");
      setActionLabel(`Removendo ${item.name}`);
      await bridge.actions.removeItem(list.id, item.id);
      return { success: true, removed: item.name, message: `${item.name} removido da lista.` };
    }

    case "createShoppingListFromRecipes": {
      const { ids, missing } = resolveRecipeIds(bridge, args);
      if (ids.length === 0) {
        return fail(
          missing.length > 0
            ? `Não encontrei: ${missing.join(", ")}. Use listAvailableRecipes para ver os nomes exatos.`
            : "Informe ao menos uma receita pelo nome ou pelo id.",
        );
      }
      setActionLabel("Gerando a lista de compras");
      const createdLists: Array<{ id?: string; title?: string } | void> = [];
      for (const id of ids) {
        const created = await bridge.actions.createListFromRecipes([id]);
        if (created) createdLists.push(created);
      }
      const title = (createdLists[0] && typeof createdLists[0] === "object" && "title" in createdLists[0] ? createdLists[0].title : null) ?? "lista de compras";
      return {
        success: true,
        recipe_ids: ids,
        lists: createdLists,
        list: createdLists[0] ?? null,
        missing,
        message: `${createdLists.length} lista(s) gerada(s) a partir de ${ids.length} receita(s).`,
      };
    }

    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}
