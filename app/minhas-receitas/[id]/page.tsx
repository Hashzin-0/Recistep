"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { KitchenMode } from "@/components/kitchen-mode";
import { ShoppingListPanel } from "@/components/recipe-planner";
import { apiFetch } from "@/lib/client/api";
import type { RecipeApiData } from "@/lib/recipe/recipe-draft";

function quantityLabel(quantity: number | null, unit: string | null, text: string | null | undefined): string {
  if (text) return text;
  if (quantity === null) return "Quantidade não informada";
  return String(quantity) + (unit ? " " + unit : "");
}

export default function ReceitaDetalhePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { accessToken, signedInEmail, getAccessToken } = useAuth();
  const [data, setData] = useState<RecipeApiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const id = params?.id;

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    setError("");
    try {
      setData(await apiFetch<RecipeApiData>(`/api/v1/recipes/${id}`, accessToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a receita.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => { void load(); }, [load]);

  async function remove() {
    if (!accessToken || !id || !data) return;
    if (!window.confirm(`Excluir a receita "${data.recipe.title}"? Esta ação não pode ser desfeita.`)) return;
    setDeleting(true);
    setError("");
    try {
      await apiFetch(`/api/v1/recipes/${id}`, accessToken, { method: "DELETE" });
      router.push("/minhas-receitas");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a receita.");
      setDeleting(false);
    }
  }

  return (
    <main className="site-shell page-main">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> RECEITA SALVA</div>
          <h1>{data?.recipe.title ?? "Receita"}</h1>
          {data?.recipe.description && <p>{data.recipe.description}</p>}
        </div>
        <Link className="auth-secondary-button" href="/minhas-receitas">← Minhas receitas</Link>
      </section>

      {!signedInEmail && <SignInPrompt message="Entre para abrir esta receita." />}

      {signedInEmail && (
        <>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {loading && !data && <p className="field-hint">Carregando receita…</p>}

          {data && (
            <section className="recipe-detail">
              <div className="recipe-detail-actions">
                <button className="import-button" type="button" onClick={() => setStarted((value) => !value)}>
                  {started ? "Encerrar preparo" : "Iniciar preparo"}
                </button>
                <Link className="auth-secondary-button" href={`/minhas-receitas/${data.id}/editar`}>Editar</Link>
                <button className="link-button danger" type="button" onClick={() => void remove()} disabled={deleting}>
                  {deleting ? "Excluindo…" : "Excluir"}
                </button>
              </div>

              <div className="recipe-detail-columns">
                <div>
                  <strong>Ingredientes</strong>
                  <ul className="recipe-detail-list">
                    {data.recipe.ingredients.map((ingredient, index) => (
                      <li key={index}>
                        <span>{quantityLabel(ingredient.quantity, ingredient.unit, ingredient.quantity_text)}</span> {ingredient.name}
                        {ingredient.notes ? ` — ${ingredient.notes}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Etapas</strong>
                  <ol className="recipe-detail-list">
                    {data.recipe.steps.slice().sort((a, b) => a.position - b.position).map((step) => (
                      <li key={step.position}>
                        {step.instruction}
                        {step.duration_text ? ` (${step.duration_text})` : step.duration_seconds !== null ? ` (${step.duration_seconds}s)` : ""}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <ShoppingListPanel recipeId={data.id} accessToken={accessToken} />

              {started && (
                <KitchenMode
                  recipeId={data.id}
                  title={data.recipe.title}
                  description={data.recipe.description}
                  servings={data.recipe.servings}
                  ingredients={data.recipe.ingredients}
                  steps={data.recipe.steps}
                  getAccessToken={getAccessToken}
                />
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
