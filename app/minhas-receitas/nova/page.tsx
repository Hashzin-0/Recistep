"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { PageTransition } from "@/components/view-transition";
import { RecipeEditor } from "@/components/recipe-editor";
import { apiFetch } from "@/lib/client/api";
import { createEmptyRecipe, type RecipeApiData } from "@/lib/recipe/recipe-draft";
import type { RecipeExtraction } from "@/lib/schemas/recipe";

export default function NovaReceitaPage() {
  const router = useRouter();
  const { accessToken, signedInEmail } = useAuth();
  const [draft, setDraft] = useState<RecipeExtraction>(() => createEmptyRecipe());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      setError("Entre para salvar a receita.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await apiFetch<RecipeApiData>("/api/v1/recipes", accessToken, {
        method: "POST",
        body: JSON.stringify(draft),
      });
      router.push(`/minhas-receitas/${data.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a receita.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageTransition>
    <main className="site-shell page-main">
      <section className="page-heading">
        <div>
          <p className="page-kicker">Nova receita</p>
          <h1>Criar receita</h1>
          <p>Descreva a receita do seu jeito. Quantidades e tempos desconhecidos ficam em branco.</p>
        </div>
      </section>

      {!signedInEmail && <SignInPrompt message="Entre para criar e salvar receitas." />}

      {signedInEmail && (
        <form className="recipe-draft" onSubmit={submit}>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          <RecipeEditor value={draft} onChange={setDraft} idPrefix="new" allowStructureEdit />
          <div className="review-actions">
            <button className="auth-secondary-button" type="button" onClick={() => router.push("/minhas-receitas")}>Cancelar</button>
            <button className="import-button" type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar receita"}</button>
          </div>
        </form>
      )}
    </main>
    </PageTransition>
  );
}
