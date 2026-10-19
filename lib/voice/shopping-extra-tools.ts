import { declareTool, type FunctionDeclaration } from "@/lib/voice/function-tool";
import type { ShoppingList } from "@/lib/voice/shopping-tools";

// Ferramentas de voz extras para a tela "Lista de compras": adicionar vários
// itens de uma vez, marcar tudo como comprado, limpar os comprados, renomear e
// excluir uma lista. Ações destrutivas pedem confirmação antes de executar.

type SetActionLabel = (label: string | null) => void;

export type ToolOutput = Record<string, unknown> | { success: false; error: string };

export interface ShoppingExtraVoiceActions {
  addItems(listId: string, items: { name: string; quantity: number | null; unit: string | null; notes: string | null }[]): Promise<{ ok: boolean; message: string }>;
  markAllPurchased(listId: string): Promise<{ ok: boolean; message: string }>;
  clearPurchased(listId: string): Promise<{ ok: boolean; message: string }>;
  renameList(listId: string, title: string): Promise<{ ok: boolean; message: string }>;
  deleteList(listId: string): Promise<{ ok: boolean; message: string }>;
}

export interface ShoppingExtraBridge {
  lists: ShoppingList[];
  actions: ShoppingExtraVoiceActions;
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

function stringListArg(args: Record<string, unknown>, key: string): string[] {
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

function resolveList(bridge: ShoppingExtraBridge, args: Record<string, unknown>): ShoppingList | null {
  const id = stringArg(args, "list_id") ?? stringArg(args, "id");
  if (id) {
    const byId = bridge.lists.find((list) => list.id === id);
    if (byId) return byId;
  }
  const query = stringArg(args, "list_title") ?? stringArg(args, "list_name") ?? stringArg(args, "list");
  if (!query) return bridge.lists.length === 1 ? bridge.lists[0] : null;
  const target = normalize(query);
  const exact = bridge.lists.find((list) => normalize(list.title) === target);
  if (exact) return exact;
  const partial = bridge.lists.find((list) => normalize(list.title).includes(target));
  return partial ?? null;
}

function listPayload(list: ShoppingList) {
  return {
    id: list.id,
    title: list.title,
    item_count: list.items.length,
    purchased_count: list.items.filter((item) => item.is_purchased).length,
  };
}

export const SHOPPING_EXTRA_TOOLS: FunctionDeclaration[] = [
  declareTool({
    name: "addMultipleItems",
    description:
      "Adiciona vários itens de uma vez à lista. Informe listas paralelas: names (obrigatório), quantities, units e notes. Quantidades e unidades podem ficar vazias; nunca estime.",
    properties: {
      list_id: { type: "STRING", description: "ID da lista." },
      list_title: { type: "STRING", description: "Título da lista." },
      names: { type: "ARRAY", description: "Nomes dos itens, na ordem.", items: { type: "STRING" } },
      quantities: { type: "ARRAY", description: "Quantidades na mesma ordem (use null quando não souber).", items: { type: "NUMBER" } },
      units: { type: "ARRAY", description: "Unidades na mesma ordem (use null quando não souber).", items: { type: "STRING" } },
      notes: { type: "ARRAY", description: "Observações na mesma ordem (use null quando não houver).", items: { type: "STRING" } },
    },
    required: ["names"],
  }),
  declareTool({
    name: "markAllPurchased",
    description: "Marca todos os itens de uma lista como comprados.",
    properties: {
      list_id: { type: "STRING", description: "ID da lista." },
      list_title: { type: "STRING", description: "Título da lista." },
    },
  }),
  declareTool({
    name: "clearPurchased",
    description: "Desmarca todos os itens comprados de uma lista. Ação destrutiva: confirme com o usuário e exija confirm=true.",
    properties: {
      list_id: { type: "STRING", description: "ID da lista." },
      list_title: { type: "STRING", description: "Título da lista." },
      confirm: { type: "BOOLEAN", description: "true somente depois que o usuário confirmar." },
    },
  }),
  declareTool({
    name: "renameShoppingList",
    description: "Renomeia uma lista de compras. Identifique a lista pelo título atual ou pelo id.",
    properties: {
      list_id: { type: "STRING", description: "ID da lista." },
      list_title: { type: "STRING", description: "Título atual da lista." },
      new_title: { type: "STRING", description: "Novo título da lista." },
    },
    required: ["new_title"],
  }),
  declareTool({
    name: "deleteShoppingList",
    description: "Exclui uma lista de compras e todos os seus itens. Ação destrutiva: confirme com o usuário e exija confirm=true.",
    properties: {
      list_id: { type: "STRING", description: "ID da lista." },
      list_title: { type: "STRING", description: "Título da lista." },
      confirm: { type: "BOOLEAN", description: "true somente depois que o usuário confirmar a exclusão." },
    },
  }),
];

export async function executeShoppingExtraTool(
  bridge: ShoppingExtraBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): Promise<ToolOutput> {
  switch (name) {
    case "addMultipleItems": {
      const list = resolveList(bridge, args);
      if (!list) return fail("Não encontrei essa lista. Use listShoppingLists para ver as opções.");
      const names = stringListArg(args, "names");
      if (names.length === 0) return fail("Informe ao menos um item em names.");
      const quantities = args.quantities;
      const units = args.units;
      const notes = args.notes;
      const items = names.map((itemName, index) => ({
        name: itemName,
        quantity: Array.isArray(quantities) ? optionalNumber(quantities[index]) : null,
        unit: Array.isArray(units) && typeof units[index] === "string" && units[index].trim() ? units[index].trim() : null,
        notes: Array.isArray(notes) && typeof notes[index] === "string" && notes[index].trim() ? notes[index].trim() : null,
      }));
      setActionLabel(`Adicionando ${items.length} itens`);
      const result = await bridge.actions.addItems(list.id, items);
      return result.ok ? { success: true, list: listPayload(list), added: items.length, message: result.message } : fail(result.message);
    }

    case "markAllPurchased": {
      const list = resolveList(bridge, args);
      if (!list) return fail("Não encontrei essa lista. Use listShoppingLists para ver as opções.");
      setActionLabel(`Marcando ${list.title} como comprado`);
      const result = await bridge.actions.markAllPurchased(list.id);
      return result.ok ? { success: true, list: listPayload(list), message: result.message } : fail(result.message);
    }

    case "clearPurchased": {
      const list = resolveList(bridge, args);
      if (!list) return fail("Não encontrei essa lista. Use listShoppingLists para ver as opções.");
      if (args.confirm !== true) {
        return {
          success: true,
          needs_confirmation: true,
          question: `Desmarcar todos os itens comprados da lista "${list.title}"?`,
        };
      }
      setActionLabel(`Limpando os comprados de ${list.title}`);
      const result = await bridge.actions.clearPurchased(list.id);
      return result.ok ? { success: true, list: listPayload(list), message: result.message } : fail(result.message);
    }

    case "renameShoppingList": {
      const list = resolveList(bridge, args);
      if (!list) return fail("Não encontrei essa lista. Use listShoppingLists para ver as opções.");
      const newTitle = stringArg(args, "new_title");
      if (!newTitle) return fail("Diga o novo título da lista.");
      setActionLabel(`Renomeando ${list.title}`);
      const result = await bridge.actions.renameList(list.id, newTitle);
      return result.ok ? { success: true, list: { ...listPayload(list), title: newTitle }, message: result.message } : fail(result.message);
    }

    case "deleteShoppingList": {
      const list = resolveList(bridge, args);
      if (!list) return fail("Não encontrei essa lista. Use listShoppingLists para ver as opções.");
      if (args.confirm !== true) {
        return {
          success: true,
          needs_confirmation: true,
          question: `Excluir a lista "${list.title}" e todos os seus itens? Esta ação não pode ser desfeita.`,
        };
      }
      setActionLabel(`Excluindo ${list.title}`);
      const result = await bridge.actions.deleteList(list.id);
      return result.ok ? { success: true, deleted: true, list: listPayload(list), message: result.message } : fail(result.message);
    }

    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}
