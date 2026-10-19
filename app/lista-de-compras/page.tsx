"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { useVoiceAssistantContext, type VoiceContextConfig } from "@/components/voice-assistant-provider";
import { PageTransition } from "@/components/view-transition";
import { apiFetch } from "@/lib/client/api";
import { defineToolGroup } from "@/lib/voice/function-tool";
import type { ExecuteToolFn } from "@/lib/voice/live-session";
import { SHOPPING_TOOLS, executeShoppingTool, type ShoppingVoiceBridge } from "@/lib/voice/shopping-tools";
import type { RecipeSummary } from "@/lib/recipe/recipe-draft";

type ShoppingItem = { id: string; name: string; quantity: number | null; unit: string | null; notes: string | null; is_purchased: boolean; source_recipe_ids?: string[] };
type ShoppingList = { id: string; title: string; items: ShoppingItem[] };

const SHOPPING_TOOL_GROUPS = [defineToolGroup(SHOPPING_TOOLS)];

const SHOPPING_SYSTEM_INSTRUCTION = [
  "Você é o assistente de voz do Recistep na tela 'Lista de compras'.",
  "Fale em português do Brasil, de forma curta e natural.",
  "Ajude a consultar e editar a lista de compras atual: veja listas e itens, marque itens como comprados, adicione ou remova itens e gere uma lista a partir das receitas salvas.",
  "Identifique a lista e o item pelos nomes que aparecem nas ferramentas; se estiver ambíguo, pergunte antes de alterar.",
  "Confirme em voz alta cada alteração feita e nunca invente itens ou quantidades.",
].join("\n");

export default function ListaDeComprasPage() {
  const { accessToken, signedInEmail } = useAuth();
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [portions, setPortions] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<"separate" | "combined">("separate");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      const [listsData, recipesData] = await Promise.all([
        apiFetch<ShoppingList[]>("/api/v1/shopping-lists", accessToken),
        apiFetch<RecipeSummary[]>("/api/v1/recipes", accessToken),
      ]);
      setLists(listsData);
      setRecipes(recipesData);
      setPortions((previous) => {
        const next = { ...previous };
        for (const recipe of recipesData) {
          if (next[recipe.id] === undefined) next[recipe.id] = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;
        }
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar suas listas.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  const usedRecipeIds = useMemo(() => new Set(lists.flatMap((list) => list.items.flatMap((item) => item.source_recipe_ids ?? []))), [lists]);
  const availableRecipes = useMemo(() => recipes.filter((recipe) => !usedRecipeIds.has(recipe.id)), [recipes, usedRecipeIds]);

  type CombinedItem = {
    key: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
    is_purchased: boolean;
    refs: { list: ShoppingList; item: ShoppingItem }[];
  };

  const combinedItems = useMemo<CombinedItem[]>(() => {
    const groups = new Map<string, CombinedItem>();
    for (const list of lists) {
      for (const item of list.items) {
        const nameKey = item.name.trim().toLowerCase().replace(/\s+/g, " ");
        const unitKey = (item.unit ?? "").trim().toLowerCase();
        const key = nameKey + "\u0000" + unitKey;
        const existing = groups.get(key);
        if (existing) {
          if (item.quantity !== null && existing.quantity !== null) {
            existing.quantity = existing.quantity + item.quantity;
          } else if (item.quantity !== null && existing.quantity === null) {
            // keep unknown if any unknown? preserve null to avoid inventing
            existing.quantity = null;
          }
          if (item.notes && !existing.notes?.includes(item.notes)) {
            existing.notes = existing.notes ? existing.notes + "; " + item.notes : item.notes;
          }
          existing.is_purchased = existing.is_purchased && item.is_purchased;
          existing.refs.push({ list, item });
        } else {
          groups.set(key, {
            key,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            notes: item.notes,
            is_purchased: item.is_purchased,
            refs: [{ list, item }],
          });
        }
      }
    }
    return [...groups.values()];
  }, [lists]);

  function toggleSelected(recipeId: string) {
    setSelected((previous) => previous.includes(recipeId) ? previous.filter((id) => id !== recipeId) : [...previous, recipeId]);
  }

  async function create() {
    if (!accessToken || selected.length === 0) return;
    setCreating(true);
    setError("");
    try {
      const createdLists: ShoppingList[] = [];
      for (const recipeId of selected) {
        const created = await apiFetch<ShoppingList>("/api/v1/shopping-lists", accessToken, {
          method: "POST",
          body: JSON.stringify({ recipe_ids: [recipeId], servings: [portions[recipeId] ?? 1] }),
        });
        createdLists.push(created);
      }
      setLists((previous) => [...createdLists, ...previous]);
      setSelected([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a lista.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleItem(list: ShoppingList, item: ShoppingItem, checked: boolean) {
    if (!accessToken) return;
    const previous = lists;
    setLists((current) => current.map((candidate) => candidate.id === list.id
      ? { ...candidate, items: candidate.items.map((entry) => entry.id === item.id ? { ...entry, is_purchased: checked } : entry) }
      : candidate));
    try {
      await apiFetch(`/api/v1/shopping-lists/${list.id}/items/${item.id}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ is_purchased: checked }),
      });
    } catch {
      setLists(previous);
      setError("Não foi possível salvar o estado do item.");
    }
  }

  async function toggleCombinedItem(item: CombinedItem, checked: boolean) {
    if (!accessToken) return;
    await Promise.all(item.refs.map((ref) => toggleItem(ref.list, ref.item, checked)));
  }

  async function removeList(list: ShoppingList) {
    if (!accessToken) return;
    if (!window.confirm(`Excluir a lista "${list.title}"?`)) return;
    try {
      await apiFetch(`/api/v1/shopping-lists/${list.id}`, accessToken, { method: "DELETE" });
      setLists((previous) => previous.filter((candidate) => candidate.id !== list.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a lista.");
    }
  }

  const setItemPurchased = useCallback(async (listId: string, itemId: string, purchased: boolean) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    await apiFetch(`/api/v1/shopping-lists/${listId}/items/${itemId}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify({ is_purchased: purchased }),
    });
    setLists((current) => current.map((list) => list.id === listId
      ? { ...list, items: list.items.map((item) => item.id === itemId ? { ...item, is_purchased: purchased } : item) }
      : list));
  }, [accessToken]);

  const addItem = useCallback(async (
    listId: string,
    input: { name: string; quantity: number | null; unit: string | null; notes: string | null },
  ) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    const created = await apiFetch<ShoppingItem>(`/api/v1/shopping-lists/${listId}/items`, accessToken, {
      method: "POST",
      body: JSON.stringify(input),
    });
    setLists((current) => current.map((list) => list.id === listId ? { ...list, items: [...list.items, created] } : list));
  }, [accessToken]);

  const removeItem = useCallback(async (listId: string, itemId: string) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    await apiFetch(`/api/v1/shopping-lists/${listId}/items/${itemId}`, accessToken, { method: "DELETE" });
    setLists((current) => current.map((list) => list.id === listId ? { ...list, items: list.items.filter((item) => item.id !== itemId) } : list));
  }, [accessToken]);

  const setItemsPurchased = useCallback(async (listId: string, itemIds: string[], purchased: boolean) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    await Promise.all(itemIds.map((itemId) => apiFetch(`/api/v1/shopping-lists/${listId}/items/${itemId}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify({ is_purchased: purchased }),
    })));
    setLists((current) => current.map((list) => list.id === listId
      ? { ...list, items: list.items.map((item) => itemIds.includes(item.id) ? { ...item, is_purchased: purchased } : item) }
      : list));
  }, [accessToken]);

  const removeItems = useCallback(async (listId: string, itemIds: string[]) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    await Promise.all(itemIds.map((itemId) => apiFetch(`/api/v1/shopping-lists/${listId}/items/${itemId}`, accessToken, { method: "DELETE" })));
    setLists((current) => current.map((list) => list.id === listId
      ? { ...list, items: list.items.filter((item) => !itemIds.includes(item.id)) }
      : list));
  }, [accessToken]);

  const renameList = useCallback(async (listId: string, title: string) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    await apiFetch(`/api/v1/shopping-lists/${listId}`, accessToken, { method: "PATCH", body: JSON.stringify({ title }) });
    setLists((current) => current.map((list) => list.id === listId ? { ...list, title } : list));
  }, [accessToken]);

  const deleteList = useCallback(async (listId: string) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    await apiFetch(`/api/v1/shopping-lists/${listId}`, accessToken, { method: "DELETE" });
    setLists((current) => current.filter((list) => list.id !== listId));
  }, [accessToken]);

  const createFromRecipes = useCallback(async (recipeIds: string[], servings?: number[] | null) => {
    if (!accessToken) throw new Error("Entre novamente para criar a lista.");
    const created = await apiFetch<ShoppingList>("/api/v1/shopping-lists", accessToken, {
      method: "POST",
      body: JSON.stringify({ recipe_ids: recipeIds, servings: servings ?? undefined }),
    });
    setLists((current) => [created, ...current]);
    return { id: created.id, title: created.title };
  }, [accessToken]);

  const shoppingBridgeRef = useRef<ShoppingVoiceBridge | null>(null);
  const shoppingBridge = useMemo<ShoppingVoiceBridge>(() => ({
    lists,
    recipes: availableRecipes.map((recipe) => ({ id: recipe.id, title: recipe.title })),
    actions: {
      setItemPurchased,
      setItemsPurchased,
      addItem,
      removeItem,
      removeItems,
      renameList,
      deleteList,
      createListFromRecipes: createFromRecipes,
    },
  }), [lists, availableRecipes, setItemPurchased, setItemsPurchased, addItem, removeItem, removeItems, renameList, deleteList, createFromRecipes]);
  useEffect(() => { shoppingBridgeRef.current = shoppingBridge; }, [shoppingBridge]);

  const executeVoiceTool = useCallback<ExecuteToolFn>(async (name, args, setActionLabel) => {
    const bridge = shoppingBridgeRef.current;
    if (!bridge) return { success: false, error: "As listas ainda não carregaram." };
    return executeShoppingTool(bridge, name, args, setActionLabel);
  }, []);

  const voiceContext = useMemo<VoiceContextConfig>(() => ({
    key: "shopping",
    contextLabel: "Lista de compras",
    systemInstruction: SHOPPING_SYSTEM_INSTRUCTION,
    toolGroups: SHOPPING_TOOL_GROUPS,
    executeTool: executeVoiceTool,
    thinkingLevel: "low",
  }), [executeVoiceTool]);

  useVoiceAssistantContext(voiceContext);

  return (
    <PageTransition>
    <main className="site-shell page-main">
      {!signedInEmail && <SignInPrompt message="Entre para ver e criar listas de compras." />}

      {signedInEmail && (
        <>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}

          <section className="shopping-builder" aria-label="Criar lista de compras">
            <strong>Escolha receitas para gerar uma lista</strong>
            {recipes.length === 0 && !loading && (
              <p className="field-hint">Você ainda não tem receitas salvas. <Link href="/minhas-receitas/nova">Crie uma receita</Link>.</p>
            )}
            {recipes.length > 0 && availableRecipes.length === 0 && !loading && (
              <p className="field-hint">Todas as receitas já têm lista de compras gerada.</p>
            )}
            <div className="shopping-recipe-picker">
              {availableRecipes.map((recipe) => (
                <label key={recipe.id} className="shopping-recipe-option">
                  <input type="checkbox" checked={selected.includes(recipe.id)} onChange={() => toggleSelected(recipe.id)} />
                  <span>{recipe.title}</span>
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    value={portions[recipe.id] ?? (recipe.servings && recipe.servings > 0 ? recipe.servings : 1)}
                    onChange={(event) => setPortions((previous) => ({ ...previous, [recipe.id]: Number(event.target.value) }))}
                    aria-label={`Porções para ${recipe.title}`}
                  />
                </label>
              ))}
            </div>
            <button className="import-button" type="button" onClick={() => void create()} disabled={creating || selected.length === 0}>
              {creating ? "Gerando lista…" : "Gerar lista de compras"}
            </button>
          </section>

          {loading && lists.length === 0 && <p className="field-hint">Carregando listas…</p>}
          {!loading && lists.length === 0 && (
            <div className="empty-state">
              <p>Nenhuma lista de compras ainda.</p>
              <p className="field-hint">Escolha uma ou mais receitas acima para criar a primeira.</p>
            </div>
          )}

           <div className="shopping-view-toggle" role="group" aria-label="Modo de visualização">
             <button type="button" className={viewMode === "separate" ? "import-button" : "secondary-button"} aria-pressed={viewMode === "separate"} onClick={() => setViewMode("separate")}>Listas separadas</button>
             <button type="button" className={viewMode === "combined" ? "import-button" : "secondary-button"} aria-pressed={viewMode === "combined"} onClick={() => setViewMode("combined")}>Lista única</button>
           </div>

           <div className="shopping-lists">
            {viewMode === "separate" && lists.map((list) => (
              <section className="shopping-list-panel" key={list.id} aria-label={list.title}>
                <div className="shopping-list-heading">
                  <h3>{list.title}</h3>
                  <button className="link-button danger" type="button" onClick={() => void removeList(list)}>Excluir</button>
                </div>
                {list.items.map((item) => (
                  <label className={"shopping-list-item" + (item.is_purchased ? " is-purchased" : "")} key={item.id}>
                    <input type="checkbox" checked={item.is_purchased} onChange={(event) => void toggleItem(list, item, event.target.checked)} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.quantity === null ? "Quantidade não informada" : item.quantity + (item.unit ? " " + item.unit : "")}{item.notes ? " · " + item.notes : ""}</small>
                    </span>
                  </label>
                ))}
                <p className="field-hint">{list.items.filter((item) => item.is_purchased).length} de {list.items.length} itens comprados</p>
              </section>
            ))}

            {viewMode === "combined" && (
              <section className="shopping-list-panel" aria-label="Lista combinada">
                <div className="shopping-list-heading">
                  <h3>Lista combinada</h3>
                </div>
                {combinedItems.map((item) => (
                  <label className={"shopping-list-item" + (item.is_purchased ? " is-purchased" : "")} key={item.key}>
                    <input type="checkbox" checked={item.is_purchased} onChange={(event) => void toggleCombinedItem(item, event.target.checked)} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.quantity === null ? "Quantidade não informada" : item.quantity + (item.unit ? " " + item.unit : "")}{item.notes ? " · " + item.notes : ""}</small>
                    </span>
                  </label>
                ))}
                <p className="field-hint">{combinedItems.filter((item) => item.is_purchased).length} de {combinedItems.length} itens comprados</p>
              </section>
            )}
          </div>
        </>
      )}
    </main>
    </PageTransition>
  );
}
