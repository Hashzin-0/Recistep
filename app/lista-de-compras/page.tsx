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
import { SHOPPING_EXTRA_TOOLS, executeShoppingExtraTool, type ShoppingExtraBridge } from "@/lib/voice/shopping-extra-tools";
import type { RecipeSummary } from "@/lib/recipe/recipe-draft";

type ShoppingItem = { id: string; name: string; quantity: number | null; unit: string | null; notes: string | null; is_purchased: boolean };
type ShoppingList = { id: string; title: string; items: ShoppingItem[] };

const SHOPPING_TOOL_GROUPS = [defineToolGroup(SHOPPING_TOOLS), defineToolGroup(SHOPPING_EXTRA_TOOLS)];

const SHOPPING_SYSTEM_INSTRUCTION = [
  "Você é o assistente de voz do Recistep na tela 'Lista de compras'.",
  "Fale em português do Brasil, de forma curta e natural.",
  "Ajude a consultar e editar a lista de compras atual: veja listas e itens, marque itens como comprados, adicione ou remova itens e gere uma lista a partir das receitas salvas.",
  "Para adicionar vários itens de uma vez use addMultipleItems; para marcar tudo como comprado use markAllPurchased; para limpar os comprados use clearPurchased (com confirmação).",
  "Para renomear use renameShoppingList; para excluir a lista use deleteShoppingList sempre com confirmação do usuário.",
  "Identifique a lista e o item pelos nomes que aparecem nas ferramentas; se estiver ambíguo, pergunte antes de alterar.",
  "Confirme em voz alta cada alteração feita e nunca invente itens ou quantidades.",
].join("\n");

export default function ListaDeComprasPage() {
  const { accessToken, signedInEmail } = useAuth();
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar suas listas.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  function toggleSelected(recipeId: string) {
    setSelected((previous) => previous.includes(recipeId) ? previous.filter((id) => id !== recipeId) : [...previous, recipeId]);
  }

  async function create() {
    if (!accessToken || selected.length === 0) return;
    setCreating(true);
    setError("");
    try {
      const created = await apiFetch<ShoppingList>("/api/v1/shopping-lists", accessToken, {
        method: "POST",
        body: JSON.stringify({ recipe_ids: selected }),
      });
      setLists((previous) => [created, ...previous]);
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

  async function removeList(list: ShoppingList) {
    if (!accessToken) return;
    if (!window.confirm(`Excluir a lista "${list.title}"?`)) return;
    try {
      await deleteListById(list.id);
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

  const createFromRecipes = useCallback(async (recipeIds: string[]) => {
    if (!accessToken) throw new Error("Entre novamente para criar a lista.");
    const created = await apiFetch<ShoppingList>("/api/v1/shopping-lists", accessToken, {
      method: "POST",
      body: JSON.stringify({ recipe_ids: recipeIds }),
    });
    setLists((current) => [created, ...current]);
    return { id: created.id, title: created.title };
  }, [accessToken]);

  const addItems = useCallback(async (
    listId: string,
    items: { name: string; quantity: number | null; unit: string | null; notes: string | null }[],
  ) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    const created: ShoppingItem[] = [];
    for (const input of items) {
      created.push(await apiFetch<ShoppingItem>(`/api/v1/shopping-lists/${listId}/items`, accessToken, {
        method: "POST",
        body: JSON.stringify(input),
      }));
    }
    setLists((current) => current.map((list) => list.id === listId
      ? { ...list, items: [...list.items, ...created] }
      : list));
    return { ok: true, message: `${created.length} itens adicionados.` };
  }, [accessToken]);

  const markAllPurchased = useCallback(async (listId: string) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    const list = lists.find((candidate) => candidate.id === listId);
    if (!list) throw new Error("Lista não encontrada.");
    await Promise.all(list.items.map((item) => apiFetch(`/api/v1/shopping-lists/${listId}/items/${item.id}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify({ is_purchased: true }),
    })));
    setLists((current) => current.map((candidate) => candidate.id === listId
      ? { ...candidate, items: candidate.items.map((item) => ({ ...item, is_purchased: true })) }
      : candidate));
    return { ok: true, message: "Todos os itens marcados como comprados." };
  }, [accessToken, lists]);

  const clearPurchased = useCallback(async (listId: string) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    const list = lists.find((candidate) => candidate.id === listId);
    if (!list) throw new Error("Lista não encontrada.");
    await Promise.all(list.items.filter((item) => item.is_purchased).map((item) => apiFetch(`/api/v1/shopping-lists/${listId}/items/${item.id}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify({ is_purchased: false }),
    })));
    setLists((current) => current.map((candidate) => candidate.id === listId
      ? { ...candidate, items: candidate.items.map((item) => ({ ...item, is_purchased: false })) }
      : candidate));
    return { ok: true, message: "Os itens comprados foram desmarcados." };
  }, [accessToken, lists]);

  const renameList = useCallback(async (listId: string, title: string) => {
    if (!accessToken) throw new Error("Entre novamente para alterar a lista.");
    await apiFetch(`/api/v1/shopping-lists/${listId}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    setLists((current) => current.map((candidate) => candidate.id === listId ? { ...candidate, title } : candidate));
    return { ok: true, message: `Lista renomeada para "${title}".` };
  }, [accessToken]);

  const deleteListById = useCallback(async (listId: string) => {
    if (!accessToken) throw new Error("Entre novamente para excluir a lista.");
    await apiFetch(`/api/v1/shopping-lists/${listId}`, accessToken, { method: "DELETE" });
    setLists((current) => current.filter((candidate) => candidate.id !== listId));
    return { ok: true, message: "Lista excluída." };
  }, [accessToken]);

  const shoppingBridgeRef = useRef<ShoppingVoiceBridge | null>(null);
  const shoppingBridge = useMemo<ShoppingVoiceBridge>(() => ({
    lists,
    recipes: recipes.map((recipe) => ({ id: recipe.id, title: recipe.title })),
    actions: { setItemPurchased, addItem, removeItem, createListFromRecipes: createFromRecipes },
  }), [lists, recipes, setItemPurchased, addItem, removeItem, createFromRecipes]);
  useEffect(() => { shoppingBridgeRef.current = shoppingBridge; }, [shoppingBridge]);

  const shoppingExtraBridgeRef = useRef<ShoppingExtraBridge | null>(null);
  const shoppingExtraBridge = useMemo<ShoppingExtraBridge>(() => ({
    lists,
    actions: { addItems, markAllPurchased, clearPurchased, renameList, deleteList: deleteListById },
  }), [lists, addItems, markAllPurchased, clearPurchased, renameList, deleteListById]);
  useEffect(() => { shoppingExtraBridgeRef.current = shoppingExtraBridge; }, [shoppingExtraBridge]);

  const executeVoiceTool = useCallback<ExecuteToolFn>(async (name, args, setActionLabel) => {
    const bridge = shoppingBridgeRef.current;
    const extra = shoppingExtraBridgeRef.current;
    if (!bridge || !extra) return { success: false, error: "As listas ainda não carregaram." };
    if (["addMultipleItems", "markAllPurchased", "clearPurchased", "renameShoppingList", "deleteShoppingList"].includes(name)) {
      return executeShoppingExtraTool(extra, name, args, setActionLabel);
    }
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
      <section className="page-heading">
        <div>
          <p className="page-kicker">Compras</p>
          <h1>Lista de compras</h1>
          <p>Reúna os ingredientes das suas receitas e marque o que já comprou.</p>
        </div>
      </section>

      {!signedInEmail && <SignInPrompt message="Entre para ver e criar listas de compras." />}

      {signedInEmail && (
        <>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}

          <section className="shopping-builder" aria-label="Criar lista de compras">
            <strong>Escolha receitas para gerar uma lista</strong>
            {recipes.length === 0 && !loading && (
              <p className="field-hint">Você ainda não tem receitas salvas. <Link href="/minhas-receitas/nova">Crie uma receita</Link>.</p>
            )}
            <div className="shopping-recipe-picker">
              {recipes.map((recipe) => (
                <label key={recipe.id} className="shopping-recipe-option">
                  <input type="checkbox" checked={selected.includes(recipe.id)} onChange={() => toggleSelected(recipe.id)} />
                  <span>{recipe.title}</span>
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

          <div className="shopping-lists">
            {lists.map((list) => (
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
          </div>
        </>
      )}
    </main>
    </PageTransition>
  );
}
