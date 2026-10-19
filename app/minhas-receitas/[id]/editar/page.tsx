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
  const [coverBusy, setCoverBusy] = useState(false);
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

  async function uploadCover(file: File | undefined) {
    if (!file || !accessToken || !id || !draft) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setError("Envie uma imagem JPG, PNG ou WebP de até 8 MB.");
      return;
    }
    setCoverBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/v1/recipes/" + id + "/cover", { method: "POST", headers: { Authorization: "Bearer " + accessToken }, body: form });
      const result = await response.json() as { cover_image_url?: string; error?: { message?: string } };
      if (!response.ok || !result.cover_image_url) throw new Error(result.error?.message ?? "Não foi possível enviar a capa.");
      setDraft((current) => current ? { ...current, cover_image_url: result.cover_image_url! } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar a capa.");
    } finally {
      setCoverBusy(false);
    }
  }

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
              <section className="recipe-cover-editor">
                <strong>Foto de capa</strong>
                {draft.cover_image_url ? <img className="recipe-cover-image" src={draft.cover_image_url} alt={"Capa de " + draft.title} /> : <p className="field-hint">Nenhuma capa adicionada.</p>}
                <div className="recipe-detail-actions">
                  <label className="auth-secondary-button recipe-upload-label">
                    {coverBusy ? "Enviando…" : draft.cover_image_url ? "Substituir capa" : "Adicionar capa"}
                    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={coverBusy} onChange={(event) => { void uploadCover(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
                  </label>
                  {draft.cover_image_url && <button className="link-button danger" type="button" disabled={coverBusy} onClick={() => setDraft((current) => current ? { ...current, cover_image_url: null } : current)}>Remover capa</button>}
                </div>
                <p className="field-hint">JPG, PNG ou WebP · até 8 MB. A remoção é aplicada ao salvar as alterações.</p>
              </section>
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
