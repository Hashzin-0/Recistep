"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { PageTransition } from "@/components/view-transition";
import { KitchenMode } from "@/components/kitchen-mode";
import { VideoDisplay } from "@/components/video-display";
import { ShoppingListPanel } from "@/components/recipe-planner";
import { apiFetch } from "@/lib/client/api";
import type { RecipeApiData } from "@/lib/recipe/recipe-draft";
import { IngredientIllustration } from "@/components/ingredient-illustration";

function quantityLabel(quantity: number | null, unit: string | null, text: string | null | undefined): string {
  if (text) return text;
  if (quantity === null) return "Quantidade não informada";
  return String(quantity) + (unit ? " " + unit : "");
}

export default function ReceitaDetalhePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { accessToken, signedInEmail } = useAuth();
  const [data, setData] = useState<RecipeApiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingAverage, setRatingAverage] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaMessage, setMediaMessage] = useState("");
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("preparo") === "1") setStarted(true);
  }, []);

  useEffect(() => {
    if (!accessToken || !id) return;
    void apiFetch<{ average: number | null; count: number; userRating: number | null }>("/api/v1/recipes/" + id + "/rating", accessToken)
      .then((result) => { setRating(result.userRating); setRatingAverage(result.average); setRatingCount(result.count); })
      .catch(() => undefined);
  }, [accessToken, id]);

  async function saveRating(value: number) {
    if (!accessToken || !id) return;
    setRatingSaving(true); setError("");
    try {
      const result = await apiFetch<{ average: number | null; count: number; userRating: number | null }>("/api/v1/recipes/" + id + "/rating", accessToken, { method: "PUT", body: JSON.stringify({ rating: value }) });
      setRating(result.userRating); setRatingAverage(result.average); setRatingCount(result.count);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a avaliação."); }
    finally { setRatingSaving(false); }
  }

  async function uploadCover(file: File | undefined) {
    if (!file || !accessToken || !id) return;
    setMediaBusy(true); setMediaMessage("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/v1/recipes/" + id + "/cover", { method: "POST", headers: { Authorization: "Bearer " + accessToken }, body: form });
      const result = await response.json() as { cover_image_url?: string; error?: { message?: string } };
      if (!response.ok || !result.cover_image_url) throw new Error(result.error?.message ?? "Não foi possível enviar a foto.");
      setData((current) => current ? { ...current, cover_image_url: result.cover_image_url! } : current);
      setMediaMessage("Capa atualizada.");
    } catch (cause) { setMediaMessage(cause instanceof Error ? cause.message : "Falha ao enviar a capa."); }
    finally { setMediaBusy(false); }
  }

  async function generateFlowchart() {
    if (!accessToken || !id) return;
    setMediaBusy(true); setMediaMessage("");
    try {
      const result = await apiFetch<{ preparation_flowchart_url: string }>("/api/v1/recipes/" + id + "/flowchart", accessToken, { method: "POST", body: JSON.stringify({}) });
      setData((current) => current ? { ...current, preparation_flowchart_url: result.preparation_flowchart_url } : current);
      setMediaMessage("Fluxograma gerado e salvo.");
    } catch (cause) { setMediaMessage(cause instanceof Error ? cause.message : "Não foi possível gerar o fluxograma."); }
    finally { setMediaBusy(false); }
  }

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
    <PageTransition>
    <main className="site-shell page-main">
      <section className="page-heading">
        <div>
          <p className="page-kicker">Receita salva</p>
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
              {data.cover_image_url && <img className="recipe-cover-image" src={data.cover_image_url} alt={"Capa da receita " + data.recipe.title} />}
              <div className="recipe-detail-actions">
                <button className="import-button" type="button" onClick={() => setStarted((value) => !value)}>
                  {started ? "Encerrar preparo" : "Iniciar preparo"}
                </button>
                <Link className="auth-secondary-button" href={`/minhas-receitas/${data.id}/editar`}>Editar</Link>
                <button className="link-button danger" type="button" onClick={() => void remove()} disabled={deleting}>
                  {deleting ? "Excluindo…" : "Excluir"}
                </button>
              </div>

              {data.video_display && <VideoDisplay display={data.video_display} title={data.recipe.title} />}

              <div className="recipe-media-tools">
                <label className="auth-secondary-button recipe-upload-label">
                  {mediaBusy ? "Processando…" : "Adicionar foto/capa"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={mediaBusy} onChange={(event) => { void uploadCover(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                </label>
                <button className="auth-secondary-button" type="button" disabled={mediaBusy} onClick={() => void generateFlowchart()}>Gerar fluxograma do preparo</button>
                {mediaMessage && <p className="field-hint" role="status">{mediaMessage}</p>}
              </div>
              <section className="recipe-rating" aria-label="Avaliação da receita">
                <strong>Avalie esta receita</strong>
                <div className="recipe-rating-stars">
                  {[1, 2, 3, 4, 5].map((star) => <button key={star} type="button" aria-label={star + " de 5 estrelas"} aria-pressed={rating === star} disabled={ratingSaving} onClick={() => void saveRating(star)}>{star <= (rating ?? 0) ? "★" : "☆"}</button>)}
                </div>
                <p className="field-hint">{ratingAverage === null ? "Ainda sem avaliações" : "Média " + ratingAverage.toFixed(1) + " de 5 · " + ratingCount + " avaliação(ões)"}</p>
              </section>
              {data.preparation_flowchart_url && <section className="recipe-flowchart"><strong>Fluxograma do preparo</strong><img src={data.preparation_flowchart_url} alt={"Fluxograma das etapas de " + data.recipe.title} /></section>}
              {(data.recipe.utensils ?? []).length > 0 && (
                <section className="recipe-utensils-list">
                  <strong>Utensílios e equipamentos</strong>
                  <ul className="recipe-detail-list">
                    {data.recipe.utensils.map((utensil, index) => (
                      <li key={index}><strong>{utensil.name}</strong>{utensil.quantity ? " · " + utensil.quantity : ""}{utensil.purpose ? " — " + utensil.purpose : ""}</li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="recipe-detail-columns">
                <div>
                  <strong>Ingredientes por camada</strong>
                  {Array.from(data.recipe.ingredients.reduce((groups, ingredient) => {
                    const section = ingredient.section?.trim() || "Ingredientes";
                    const items = groups.get(section) ?? [];
                    items.push(ingredient);
                    groups.set(section, items);
                    return groups;
                  }, new Map<string, typeof data.recipe.ingredients>())).map(([section, ingredients]) => (
                    <section className="ingredient-layer" key={section}>
                      <h3>{section}</h3>
                      <ul className="recipe-detail-list">
                        {ingredients.map((ingredient, index) => (
                          <li key={index}><span className="ingredient-icon"><IngredientIllustration name={ingredient.name} /></span> <span>{quantityLabel(ingredient.quantity, ingredient.unit, ingredient.quantity_text)}</span> {ingredient.name}{ingredient.notes ? " — " + ingredient.notes : ""}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
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
                  videoDisplay={data.video_display}
                />
              )}
            </section>
          )}
        </>
      )}
    </main>
    </PageTransition>
  );
}
