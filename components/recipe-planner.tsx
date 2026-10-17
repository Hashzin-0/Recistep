"use client";

import { useState } from "react";
import { scaleIngredients } from "@/lib/recipe/scale-portions";

type Ingredient = { name: string; quantity: number | null; unit: string | null; notes: string | null; source_evidence: string | null; confidence: number };
type ShoppingItem = { id: string; name: string; quantity: number | null; unit: string | null; notes: string | null; is_purchased: boolean };
type ShoppingList = { id: string; title: string; items: ShoppingItem[] };

export function PortionScaler({ servings, ingredients, onApply }: { servings: number | null; ingredients: Ingredient[]; onApply: (servings: number, ingredients: Ingredient[]) => void }) {
  const [target, setTarget] = useState<number | null>(servings);
  const [message, setMessage] = useState("");
  function apply() {
    if (!servings || !target || target <= 0) return;
    try {
      const scaled = scaleIngredients(ingredients.map(({ name, quantity, unit }) => ({ name, quantity, unit })), servings, target);
      onApply(target, ingredients.map((ingredient, index) => ({ ...ingredient, quantity: scaled[index].quantity })));
      setMessage("Quantidades recalculadas. Confira os arredondamentos antes de confirmar.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível ajustar as porções."); }
  }
  return <div className="serving-scale">
    <div><label htmlFor="target-servings">Ajustar para porções</label><input id="target-servings" type="number" min="0.1" max="500" step="any" value={target ?? ""} onChange={(event) => setTarget(event.target.value === "" ? null : Number(event.target.value))} /></div>
    <button className="secondary-button" type="button" disabled={!servings || !target || target <= 0} onClick={apply}>Recalcular quantidades</button>
    {message && <p className="field-hint" role="status">{message}</p>}
  </div>;
}

export function ShoppingListPanel({ recipeId, accessToken }: { recipeId: string; accessToken: string | null }) {
  const [list, setList] = useState<ShoppingList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    if (!accessToken) { setError("Entre novamente para criar a lista."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/shopping-lists", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ recipe_ids: [recipeId] }) });
      const body = await response.json() as { data?: ShoppingList; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Não foi possível gerar a lista.");
      setList(body.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha de conexão."); }
    finally { setBusy(false); }
  }
  async function toggle(item: ShoppingItem, checked: boolean) {
    if (!list || !accessToken) return;
    const previous = list;
    setList({ ...list, items: list.items.map((candidate) => candidate.id === item.id ? { ...candidate, is_purchased: checked } : candidate) });
    try {
      const response = await fetch("/api/v1/shopping-lists/" + list.id + "/items/" + item.id, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken }, body: JSON.stringify({ is_purchased: checked }) });
      if (!response.ok) throw new Error("update failed");
    } catch { setList(previous); setError("Não foi possível salvar o estado do item."); }
  }
  return <section className="shopping-list-panel" aria-label="Lista de compras">
    <button className="import-button" type="button" onClick={() => void create()} disabled={busy || !accessToken}>{busy ? "Gerando lista…" : list ? "Atualizar lista de compras" : "Gerar lista de compras"}</button>
    {error && <p role="alert" className="feedback-error">{error}</p>}
    {list && <>
      <h4>{list.title}</h4>
      <p className="field-hint">Itens agrupados apenas por nome e unidade compatíveis. Quantidades desconhecidas não são somadas.</p>
      {list.items.map((item) => <label className={"shopping-list-item" + (item.is_purchased ? " is-purchased" : "")} key={item.id}>
        <input type="checkbox" checked={item.is_purchased} onChange={(event) => void toggle(item, event.target.checked)} />
        <span><strong>{item.name}</strong><small>{item.quantity === null ? "Quantidade não informada" : item.quantity + (item.unit ? " " + item.unit : "")}{item.notes ? " · " + item.notes : ""}</small></span>
      </label>)}
      <p className="field-hint">{list.items.filter((item) => item.is_purchased).length} de {list.items.length} itens comprados</p>
    </>}
  </section>;
}
