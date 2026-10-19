"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { PageTransition } from "@/components/view-transition";
import { apiFetch } from "@/lib/client/api";
import type { RecipeSummary } from "@/lib/recipe/recipe-draft";

function formatMinutes(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export default function MinhasReceitasPage() {
  const { accessToken, signedInEmail } = useAuth();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      setRecipes(await apiFetch<RecipeSummary[]>("/api/v1/recipes", accessToken));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar suas receitas.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  async function remove(id: string, title: string) {
    if (!accessToken) return;
    if (!window.confirm(`Excluir a receita "${title}"? Esta ação não pode ser desfeita.`)) return;
    setBusyId(id);
    setError("");
    try {
      await apiFetch(`/api/v1/recipes/${id}`, accessToken, { method: "DELETE" });
      setRecipes((previous) => previous.filter((recipe) => recipe.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a receita.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageTransition>
    <main className="site-shell page-main">
      <section className="page-heading">
        <div>
          <p className="page-kicker">Sua coleção</p>
          <h1>Minhas receitas</h1>
          <p>Somente você tem acesso às receitas salvas aqui. Abra, inicie o preparo, edite ou exclua.</p>
        </div>
        <Link className="import-button" href="/minhas-receitas/nova">Criar receita manualmente</Link>
      </section>

      {!signedInEmail && <SignInPrompt message="Entre para ver suas receitas salvas." />}

      {signedInEmail && (
        <section aria-label="Receitas salvas">
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {loading && recipes.length === 0 && <p className="field-hint">Carregando receitas…</p>}
          {!loading && recipes.length === 0 && !error && (
            <div className="empty-state">
              <p>Você ainda não salvou nenhuma receita.</p>
              <p className="field-hint">Importe de um link na aba Receitas ou crie uma receita manualmente.</p>
            </div>
          )}
          <div className="recipe-grid">
            {recipes.map((recipe) => {
              const total = formatMinutes(recipe.total_seconds) ?? formatMinutes(recipe.prep_seconds);
              return (
                <article className="recipe-card" key={recipe.id}>
                  <div>
                    <h3>{recipe.title}</h3>
                    {recipe.description && <p className="recipe-card-description">{recipe.description}</p>}
                    <p className="recipe-card-meta">
                      {recipe.ingredients_count} ingredientes · {recipe.steps_count} etapas
                      {recipe.servings ? ` · ${recipe.servings} porções` : ""}
                      {total ? ` · ${total}` : ""}
                    </p>
                    {recipe.source_url && <p className="field-hint"><a href={recipe.source_url} target="_blank" rel="noreferrer">Fonte original ↗</a></p>}
                  </div>
                  <div className="recipe-card-actions">
                    <Link className="import-button" href={`/minhas-receitas/${recipe.id}`}>Abrir</Link>
                    <Link className="auth-secondary-button" href={`/minhas-receitas/${recipe.id}/editar`}>Editar</Link>
                    <button className="link-button danger" type="button" onClick={() => void remove(recipe.id, recipe.title)} disabled={busyId === recipe.id}>
                      {busyId === recipe.id ? "Excluindo…" : "Excluir"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
    </PageTransition>
  );
}
