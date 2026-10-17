"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { apiFetch } from "@/lib/client/api";
import type { RecipeSummary } from "@/lib/recipe/recipe-draft";

type ShoppingItem = { id: string; name: string; quantity: number | null; unit: string | null; notes: string | null; is_purchased: boolean };
type ShoppingList = { id: string; title: string; items: ShoppingItem[] };

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
      await apiFetch(`/api/v1/shopping-lists/${list.id}`, accessToken, { method: "DELETE" });
      setLists((previous) => previous.filter((candidate) => candidate.id !== list.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a lista.");
    }
  }

  return (
    <main className="site-shell page-main">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> COMPRAS</div>
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
  );
}
