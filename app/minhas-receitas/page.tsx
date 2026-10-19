"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { PageTransition } from "@/components/view-transition";
import { VideoDisplay } from "@/components/video-display";
import { useVoiceAssistantContext, type VoiceContextConfig } from "@/components/voice-assistant-provider";
import { apiFetch } from "@/lib/client/api";
import { defineToolGroup } from "@/lib/voice/function-tool";
import { LIBRARY_TOOLS, executeLibraryTool, type LibraryRecipe, type LibraryVoiceBridge } from "@/lib/voice/library-tools";
import type { ExecuteToolFn } from "@/lib/voice/live-session";
import type { RecipeSummary } from "@/lib/recipe/recipe-draft";
import { buildVideoDisplay, type VideoDisplay as VideoDisplayData } from "@/lib/recipe/video-display";

const LIBRARY_TOOL_GROUPS = [defineToolGroup(LIBRARY_TOOLS)];

const LIBRARY_SYSTEM_INSTRUCTION = [
  "Você é o assistente de voz do Recistep na tela 'Minhas receitas'.",
  "Fale em português do Brasil, de forma curta e natural.",
  "Ajude o usuário com as receitas salvas: liste com listRecipes, procure pelo nome com findRecipes, procure por ingrediente com findRecipesByIngredient e abra a escolhida com openRecipe.",
  "Também dá para abrir a edição (openRecipeEdit) ou criar uma cópia (duplicateRecipe). Para excluir, use deleteRecipe, mas só depois de o usuário confirmar.",
  "Quando o usuário quiser cozinhar, abra a receita com start_prep=true e depois conduza o preparo.",
  "Nunca invente receitas, ingredientes ou tempos que não estejam nos dados listados.",
].join("\n");

function toLibraryRecipe(recipe: RecipeSummary): LibraryRecipe {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    ingredients_count: recipe.ingredients_count,
    steps_count: recipe.steps_count,
    servings: recipe.servings,
    total_seconds: recipe.total_seconds,
    prep_seconds: recipe.prep_seconds,
    source_platform: recipe.source_platform ?? null,
  };
}

function formatMinutes(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function recipeCover(recipe: RecipeSummary): string | null {
  return recipe.cover_image_url || recipe.source_thumbnail_url || null;
}

function recipeVideo(recipe: RecipeSummary): VideoDisplayData | null {
  return buildVideoDisplay({
    platform: recipe.source_platform,
    sourceUrl: recipe.source_url,
    thumbnailUrl: recipe.source_thumbnail_url,
    videoUrl: recipe.source_video_url,
    title: recipe.title,
  });
}

export default function MinhasReceitasPage() {
  const { accessToken, signedInEmail } = useAuth();
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [videoModal, setVideoModal] = useState<{ title: string; display: VideoDisplayData } | null>(null);

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

  useEffect(() => {
    if (!videoModal) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setVideoModal(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [videoModal]);

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

  const libraryBridgeRef = useRef<LibraryVoiceBridge | null>(null);
  const openRecipe = useCallback((recipeId: string, startPrep: boolean) => {
    router.push("/minhas-receitas/" + recipeId + (startPrep ? "?preparo=1" : ""));
  }, [router]);
  const openEdit = useCallback((recipeId: string) => {
    router.push("/minhas-receitas/" + recipeId + "/editar");
  }, [router]);
  const deleteRecipe = useCallback(async (recipeId: string) => {
    if (!accessToken) throw new Error("Entre novamente para excluir a receita.");
    await apiFetch(`/api/v1/recipes/${recipeId}`, accessToken, { method: "DELETE" });
    setRecipes((previous) => previous.filter((recipe) => recipe.id !== recipeId));
  }, [accessToken]);
  const duplicateRecipe = useCallback(async (recipeId: string) => {
    if (!accessToken) throw new Error("Entre novamente para duplicar a receita.");
    const created = await apiFetch<{ id: string; recipe: { title: string } }>(`/api/v1/recipes/${recipeId}/duplicate`, accessToken, { method: "POST" });
    await load();
    return { id: created.id, title: created.recipe?.title };
  }, [accessToken, load]);
  const searchByIngredient = useCallback(async (term: string) => {
    if (!accessToken) throw new Error("Entre novamente para buscar por ingrediente.");
    const results = await apiFetch<RecipeSummary[]>("/api/v1/recipes?ingredient=" + encodeURIComponent(term), accessToken);
    return results.map(toLibraryRecipe);
  }, [accessToken]);

  const libraryBridge = useMemo<LibraryVoiceBridge>(
    () => ({
      recipes: recipes.map(toLibraryRecipe),
      actions: { open: openRecipe, openEdit, deleteRecipe, duplicateRecipe, searchByIngredient },
    }),
    [recipes, openRecipe, openEdit, deleteRecipe, duplicateRecipe, searchByIngredient],
  );
  useEffect(() => { libraryBridgeRef.current = libraryBridge; }, [libraryBridge]);

  const executeVoiceTool = useCallback<ExecuteToolFn>(async (name, args, setActionLabel) => {
    const bridge = libraryBridgeRef.current;
    if (!bridge) return { success: false, error: "A lista de receitas ainda não carregou." };
    return executeLibraryTool(bridge, name, args, setActionLabel);
  }, []);

  const voiceContext = useMemo<VoiceContextConfig>(() => ({
    key: "library",
    contextLabel: "Minhas receitas",
    systemInstruction: LIBRARY_SYSTEM_INSTRUCTION,
    toolGroups: LIBRARY_TOOL_GROUPS,
    executeTool: executeVoiceTool,
    thinkingLevel: "low",
  }), [executeVoiceTool]);

  useVoiceAssistantContext(voiceContext);

  return (
    <PageTransition>
    <main className="site-shell page-main">
      <section className="page-heading">
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
              const cover = recipeCover(recipe);
              const video = recipeVideo(recipe);
              return (
                <article className="recipe-card recipe-card-horizontal" key={recipe.id}>
                  <div className="recipe-card-media">
                    {cover ? (
                      <img className="recipe-card-cover" src={cover} alt={`Capa da receita ${recipe.title}`} loading="lazy" />
                    ) : (
                      <div className="recipe-card-cover recipe-card-cover-empty" aria-hidden="true" />
                    )}
                  </div>
                  <div className="recipe-card-body">
                    <div>
                      <h3>{recipe.title}</h3>
                      {recipe.description && <p className="recipe-card-description">{recipe.description}</p>}
                      <p className="recipe-card-meta">
                        {recipe.ingredients_count} ingredientes · {recipe.steps_count} etapas
                        {recipe.servings ? ` · ${recipe.servings} porções` : ""}
                        {total ? ` · ${total}` : ""}
                      </p>
                    </div>
                    <div className="recipe-card-footer">
                      <div className="recipe-card-actions">
                        <Link className="import-button" href={`/minhas-receitas/${recipe.id}`}>Abrir</Link>
                        <Link className="auth-secondary-button" href={`/minhas-receitas/${recipe.id}/editar`}>Editar</Link>
                        <button className="link-button danger" type="button" onClick={() => void remove(recipe.id, recipe.title)} disabled={busyId === recipe.id}>
                          {busyId === recipe.id ? "Excluindo…" : "Excluir"}
                        </button>
                      </div>
                      {video && (
                        <div className="recipe-card-video">
                          <span className="recipe-card-video-label">Ver vídeo</span>
                          <button className="recipe-card-video-button" type="button" onClick={() => setVideoModal({ title: recipe.title, display: video })} aria-label={`Ver vídeo de ${recipe.title} no site`}>▶</button>
                          <a className="recipe-card-video-button" href={video.watch_url} target="_blank" rel="noreferrer noopener" aria-label={`Abrir vídeo de ${recipe.title} em ${video.platform}`}>↗</a>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {videoModal && (
            <div className="recipe-video-modal-backdrop" role="presentation" onClick={() => setVideoModal(null)}>
              <div className="recipe-video-modal" role="dialog" aria-modal="true" aria-label={`Vídeo de ${videoModal.title}`} onClick={(event) => event.stopPropagation()}>
                <div className="recipe-video-modal-header">
                  <strong className="recipe-video-modal-title">{videoModal.title}</strong>
                  <button className="link-button" type="button" onClick={() => setVideoModal(null)} aria-label="Fechar vídeo">Fechar</button>
                </div>
                <VideoDisplay display={videoModal.display} title={videoModal.title} />
              </div>
            </div>
          )}
        </section>
      )}
    </main>
    </PageTransition>
  );
}
