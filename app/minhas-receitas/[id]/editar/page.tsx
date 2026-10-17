"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { RecipeEditor } from "@/components/recipe-editor";
import { apiFetch } from "@/lib/client/api";
import type { RecipeApiData } from "@/lib/recipe/recipe-draft";
import type { RecipeExtraction } from "@/lib/schemas/recipe";

export default function EditarReceitaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { accessToken, signedInEmail } = useAuth();
  const [draft, setDraft] = useState<RecipeExtraction | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = params?.id;

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<RecipeApiData>(`/api/v1/recipes/${id}`, accessToken);
      setDraft(data.recipe);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a receita.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !id || !draft) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch<RecipeApiData>(`/api/v1/recipes/${id}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      router.push(`/minhas-receitas/${id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a receita.");
      setSaving(false);
    }
  }

  return (
    <main className="site-shell page-main">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> EDITAR RECEITA</div>
          <h1>Editar receita</h1>
          <p>As alterações substituem ingredientes e etapas salvos anteriormente.</p>
        </div>
      </section>

      {!signedInEmail && <SignInPrompt message="Entre para editar esta receita." />}

      {signedInEmail && (
        <>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {loading && !draft && <p className="field-hint">Carregando receita…</p>}
          {draft && (
            <form className="recipe-draft" onSubmit={submit}>
              <RecipeEditor value={draft} onChange={setDraft} idPrefix="edit" allowStructureEdit />
              <div className="review-actions">
                <button className="auth-secondary-button" type="button" onClick={() => router.push(`/minhas-receitas/${id}`)}>Cancelar</button>
                <button className="import-button" type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar alterações"}</button>
              </div>
            </form>
          )}
        </>
      )}
    </main>
  );
}
