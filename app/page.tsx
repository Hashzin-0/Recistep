"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { ShoppingListPanel } from "@/components/recipe-planner";
import { RecipeEditor } from "@/components/recipe-editor";
import { KitchenMode } from "@/components/kitchen-mode";
import { VoiceAssistantHud, type VoiceControlApi } from "@/components/voice-assistant-hud";
import { defineToolGroup } from "@/lib/voice/function-tool";
import { buildReviewSystemInstruction } from "@/lib/voice/prompts";
import { RECIPE_EDIT_TOOLS, executeRecipeEditTool } from "@/lib/voice/recipe-tools";
import type { ExecuteToolFn } from "@/lib/voice/live-session";
import type { RecipeExtraction } from "@/lib/schemas/recipe";

const REVIEW_TOOL_GROUPS = [defineToolGroup(RECIPE_EDIT_TOOLS)];

type ImportFeedback =
  | { kind: "error"; message: string }
  | { kind: "info"; message: string }
  | null;

type ImportRecord = {
  id: string;
  status: string;
  recipe_id?: string | null;
  error_message?: string | null;
  error_code?: string | null;
  source_metadata?: { title?: string; author_name?: string | null } | null;
  recipe_draft?: RecipeExtraction | null;
};

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "Na fila de processamento",
    processing: "Processando",
    source_content_required: "Aguardando transcrição autorizada",
    review_required: "Rascunho pronto para revisão",
    completed: "Concluída",
    failed: "Falhou",
    cancelled: "Cancelada",
  };
  return labels[status] ?? status;
}

export default function HomePage() {
  const { supabase, accessToken, getAccessToken } = useAuth();
  const [sourceUrl, setSourceUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingTranscript, setIsSubmittingTranscript] = useState(false);
  const [feedback, setFeedback] = useState<ImportFeedback>(null);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [importRecord, setImportRecord] = useState<ImportRecord | null>(null);
  const [transcript, setTranscript] = useState("");
  const [reviewDraft, setReviewDraft] = useState<RecipeExtraction | null>(null);
  const [streamDraft, setStreamDraft] = useState<RecipeExtraction | null>(null);
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [isConfirmingRecipe, setIsConfirmingRecipe] = useState(false);
  const reviewVoiceApiRef = useRef<VoiceControlApi | null>(null);
  const reviewDraftRef = useRef(reviewDraft);
  useEffect(() => { reviewDraftRef.current = reviewDraft; }, [reviewDraft]);

  const reviewSystemInstruction = useMemo(
    () => (reviewDraft ? buildReviewSystemInstruction(reviewDraft) : ""),
    [reviewDraft],
  );

  const executeReviewTool = useCallback<ExecuteToolFn>(async (name, args, setActionLabel) => {
    const draft = reviewDraftRef.current;
    if (!draft) return { success: false, error: "Não há receita em revisão agora." };
    return executeRecipeEditTool(
      {
        draft: draft as RecipeExtraction,
        actions: { commit: (next) => setReviewDraft(next) },
      },
      name,
      args,
      setActionLabel,
    );
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // PWA installation is optional; the core application remains usable without a service worker.
      });
    }
  }, []);

  useEffect(() => {
    if (!supabase || !accessToken || !activeImportId ||
      !["queued", "processing"].includes(importRecord?.status ?? "")) return;

    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/v1/imports/" + activeImportId, {
          headers: { Authorization: "Bearer " + accessToken },
          cache: "no-store",
        });
        if (!response.ok || stopped) return;
        const body = await response.json() as { data?: ImportRecord };
        if (body.data && !stopped) setImportRecord(body.data);
      } catch {
        // Status polling is best-effort; the manual refresh action remains available.
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [supabase, accessToken, activeImportId, importRecord?.status]);

  useEffect(() => {
    if (!supabase || !accessToken || !activeImportId ||
      !["queued", "processing"].includes(importRecord?.status ?? "")) return;

    setStreamDraft(null);
    let stopped = false;
    const controller = new AbortController();

    const parseBlock = (block: string) => {
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) return;
      let payload: unknown;
      try { payload = JSON.parse(data); } catch { return; }
      if (stopped) return;

      if (event === "partial") {
        setStreamDraft(payload as RecipeExtraction);
      } else if (event === "done") {
        const draft = payload as RecipeExtraction;
        if (draft && (draft.title || draft.ingredients?.length || draft.steps?.length)) {
          setImportRecord((previous) => previous ? {
            ...previous,
            status: "review_required",
            recipe_draft: draft,
            error_code: null,
            error_message: null,
          } : previous);
        }
        setStreamDraft(null);
        controller.abort();
      } else if (event === "error") {
        const err = payload as { code?: string; message?: string; status?: string };
        setImportRecord((previous) => previous ? {
          ...previous,
          status: (err.status as ImportRecord["status"]) ?? "failed",
          error_code: err.code ?? null,
          error_message: err.message ?? null,
        } : previous);
        setStreamDraft(null);
        controller.abort();
      } else if (event === "status") {
        const st = payload as { status?: string };
        if (st.status && !["queued", "processing"].includes(st.status)) {
          setImportRecord((previous) => previous ? { ...previous, status: st.status as ImportRecord["status"] } : previous);
        }
      }
    };

    void (async () => {
      try {
        const response = await fetch("/api/v1/imports/" + activeImportId + "/stream", {
          headers: { Authorization: "Bearer " + accessToken },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || !response.body || stopped) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) if (block.trim()) parseBlock(block);
        }
      } catch {
        // The stream is best-effort; status polling remains as a fallback.
      }
    })();

    return () => {
      stopped = true;
      controller.abort();
      setStreamDraft(null);
    };
  }, [supabase, accessToken, activeImportId, importRecord?.status]);

  useEffect(() => {
    if (importRecord?.status === "review_required" && importRecord.recipe_draft) {
      setReviewDraft(importRecord.recipe_draft);
      setStreamDraft(null);
    } else if (importRecord?.status === "completed") {
      setReviewDraft(null);
      setStreamDraft(null);
    }
  }, [importRecord?.id, importRecord?.status, importRecord?.recipe_draft]);

  async function saveRecipeReview() {
    if (!activeImportId || !reviewDraft) return;
    const token = await getAccessToken();
    if (!token) {
      setFeedback({ kind: "error", message: "Entre novamente para salvar a revisão." });
      return;
    }
    setIsSavingReview(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/v1/imports/" + activeImportId + "/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(reviewDraft),
      });
      const body = await response.json() as { data?: { recipe_draft: RecipeExtraction }; error?: { message?: string } };
      if (!response.ok || !body.data) {
        setFeedback({ kind: "error", message: body.error?.message ?? "Não foi possível salvar a revisão." });
        return;
      }
      setImportRecord((previous) => previous ? { ...previous, recipe_draft: body.data!.recipe_draft } : previous);
      setFeedback({ kind: "info", message: "Revisão salva. A receita ainda não foi confirmada." });
    } catch {
      setFeedback({ kind: "error", message: "Falha de conexão ao salvar a revisão." });
    } finally {
      setIsSavingReview(false);
    }
  }

  async function confirmRecipe() {
    if (!activeImportId || !reviewDraft) return;
    const token = await getAccessToken();
    if (!token) {
      setFeedback({ kind: "error", message: "Entre novamente para confirmar a receita." });
      return;
    }
    setIsConfirmingRecipe(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/v1/imports/" + activeImportId + "/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(reviewDraft),
      });
      const body = await response.json() as {
        data?: { recipe_id: string; status: string; already_confirmed?: boolean };
        error?: { message?: string };
      };
      if (!response.ok || !body.data) {
        setFeedback({ kind: "error", message: body.error?.message ?? "Não foi possível confirmar a receita." });
        return;
      }
      setImportRecord((previous) => previous ? {
        ...previous,
        status: "completed",
        recipe_id: body.data!.recipe_id,
        recipe_draft: reviewDraft,
      } : previous);
      reviewVoiceApiRef.current?.disconnect();
      setFeedback({ kind: "info", message: body.data.already_confirmed ? "Esta receita já estava confirmada." : "Receita confirmada e salva com ingredientes e etapas." });
    } catch {
      setFeedback({ kind: "error", message: "Falha de conexão ao confirmar a receita." });
    } finally {
      setIsConfirmingRecipe(false);
    }
  }

  async function refreshImportStatus() {
    if (!activeImportId) return;
    const token = await getAccessToken();
    if (!token) {
      setFeedback({ kind: "error", message: "Entre novamente para consultar esta importação." });
      return;
    }
    try {
      const response = await fetch("/api/v1/imports/" + activeImportId, {
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
      });
      const body = await response.json() as {
        data?: ImportRecord;
        error?: { message?: string };
      };
      if (!response.ok || !body.data) {
        setFeedback({ kind: "error", message: body.error?.message ?? "Não foi possível consultar o estado." });
        return;
      }
      setImportRecord(body.data);
    } catch {
      setFeedback({ kind: "error", message: "Não foi possível consultar o estado agora." });
    }
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (!supabase) {
      setFeedback({ kind: "error", message: "O login não está disponível: configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no ambiente de produção e gere um novo deploy." });
      return;
    }
    if (!accessToken) {
      setFeedback({ kind: "info", message: "Entre com Google primeiro. Depois, cole o link e toque em “Analisar link” novamente." });
      return;
    }
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/imports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ source_url: sourceUrl, locale: "pt-BR" }),
      });

      const body: {
        error?: { message?: string; code?: string };
        data?: ImportRecord;
      } = await response.json();

      if (!response.ok) {
        setFeedback({
          kind: response.status === 503 ? "info" : "error",
          message: body.error?.message ?? "Não foi possível iniciar esta importação.",
        });
        return;
      }

      if (body.data?.id) {
        setActiveImportId(body.data.id);
        setImportRecord(body.data);
        setTranscript("");
        setFeedback({ kind: "info", message: "Importação registrada. Acompanhe o estado abaixo." });
      } else {
        setFeedback({ kind: "error", message: "O servidor não retornou um identificador de importação." });
      }
    } catch {
      setFeedback({
        kind: "error",
        message: "Não foi possível conectar ao servidor. Verifique sua conexão.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTranscriptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeImportId || !accessToken) {
      setFeedback({ kind: "error", message: "Entre na sua conta e selecione uma importação válida." });
      return;
    }
    if (transcript.trim().length < 80 || transcript.trim().length > 80_000) {
      setFeedback({ kind: "error", message: "A transcrição deve conter entre 80 e 80.000 caracteres." });
      return;
    }

    setIsSubmittingTranscript(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/v1/imports/" + activeImportId + "/transcript", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
        },
        body: JSON.stringify({ transcript }),
      });
      const body = await response.json() as {
        data?: { id: string; status: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.data) {
        setFeedback({ kind: "error", message: body.error?.message ?? "Não foi possível enviar a transcrição." });
        return;
      }
      setImportRecord((previous) => previous ? { ...previous, status: "queued", error_message: null } : previous);
      setTranscript("");
      setFeedback({ kind: "info", message: "Transcrição enviada. A extração está na fila." });
    } catch {
      setFeedback({ kind: "error", message: "Não foi possível enviar a transcrição agora." });
    } finally {
      setIsSubmittingTranscript(false);
    }
  }

  return (
    <main className="site-shell page-main">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> SUA COZINHA, MAIS ORGANIZADA</div>
          <h1>Do vídeo à mesa.<br /><em>Sem perder</em> nenhum passo.</h1>
          <p className="hero-description">
            Transforme receitas que você encontra por aí em ingredientes organizados,
            etapas claras e um preparo que cabe na sua rotina.
          </p>
          <div className="hero-points">
            <span><span className="check">✓</span> Ingredientes reunidos</span>
            <span><span className="check">✓</span> Tempos por etapa</span>
            <span><span className="check">✓</span> Lista de compras</span>
          </div>
        </div>

        <div className="import-card">
          <div className="card-kicker">IMPORTAR RECEITA</div>
          <h2>Encontrou algo gostoso?</h2>
          <p className="card-description">Cole o link do vídeo para começar a organizar a receita.</p>
          <SignInPrompt message="Entre para importar e salvar suas receitas." />
          <form onSubmit={handleImport}>
            <label htmlFor="source-url">Link do vídeo</label>
            <div className="url-field">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path d="M10 13.5a4 4 0 0 0 5.66 0l3-3A4 4 0 0 0 13 4.84l-1.72 1.72" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                <path d="M14 10.5a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 19.16l1.72-1.72" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
              <input
                id="source-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://..."
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                maxLength={2048}
                required
                aria-describedby="supported-sources"
              />
              <button className="import-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Verificando…" : "Analisar link"}
                {!isSubmitting && <span aria-hidden="true">↗</span>}
              </button>
            </div>
            <p className="field-hint" id="supported-sources">
              YouTube, TikTok e Instagram. A análise depende do acesso permitido à fonte.
            </p>
          </form>

          <Link className="manual-create-link" href="/minhas-receitas/nova">
            Ou crie uma receita manualmente →
          </Link>

          {feedback && (
            <div className={`feedback feedback-${feedback.kind}`} role="status" aria-live="polite">
              <span aria-hidden="true">{feedback.kind === "error" ? "!" : "i"}</span>
              {feedback.message}
            </div>
          )}

          {activeImportId && importRecord && (
            <section className="import-status" aria-labelledby="import-status-heading">
              <div className="import-status-heading">
                <div>
                  <span className="auth-label">IMPORTAÇÃO</span>
                  <h3 id="import-status-heading">{statusLabel(importRecord.status)}</h3>
                </div>
                <button className="auth-secondary-button" type="button" onClick={refreshImportStatus}>
                  Atualizar
                </button>
              </div>
              {importRecord.source_metadata?.title && (
                <p className="source-metadata-title">{importRecord.source_metadata.title}</p>
              )}
              {importRecord.error_message && ["failed", "source_content_required"].includes(importRecord.status) && (
                <p className="field-hint">{importRecord.error_message}</p>
              )}
              {["queued", "processing"].includes(importRecord.status) && streamDraft && (
                <div className="recipe-draft stream-preview" aria-live="polite">
                  <h4>{streamDraft.title || "Decifrando receita…"}</h4>
                  {streamDraft.ingredients.length > 0 && (
                    <>
                      <span className="auth-label">INGREDIENTES ({streamDraft.ingredients.length})</span>
                      <ul>
                        {streamDraft.ingredients.map((ingredient, index) => (
                          <li key={index}>
                            {ingredient.quantity_text || (ingredient.quantity != null ? String(ingredient.quantity) : "")}
                            {ingredient.unit ? ` ${ingredient.unit}` : ""} {ingredient.name}
                            {ingredient.notes ? ` — ${ingredient.notes}` : ""}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {streamDraft.steps.length > 0 && (
                    <>
                      <span className="auth-label">MODO DE PREPARO ({streamDraft.steps.length})</span>
                      <ol>
                        {streamDraft.steps.map((step) => (
                          <li key={step.position}>
                            {step.instruction}
                            {step.duration_text ? ` (${step.duration_text})` : ""}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  {streamDraft.ingredients.length === 0 && streamDraft.steps.length === 0 && (
                    <p className="field-hint">Lendo a fonte e montando a receita em tempo real…</p>
                  )}
                </div>
              )}
              {(importRecord.status === "source_content_required" ||
                (importRecord.status === "failed" && ["PROCESSING_FAILED", "GEMINI_PROCESSING_FAILED"].includes(importRecord.error_code ?? ""))) && (
                <form className="transcript-form" onSubmit={handleTranscriptSubmit}>
                  <label htmlFor="source-transcript">Transcrição autorizada do vídeo</label>
                  <textarea
                    id="source-transcript"
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                    minLength={80}
                    maxLength={80000}
                    rows={5}
                    placeholder="Cole aqui a transcrição falada ou o texto da receita que você tem direito de usar."
                    required
                  />
                  <p className="field-hint">O Recistep não baixa o vídeo nem contorna restrições. A transcrição é apagada após o processamento terminal.</p>
                  <button className="import-button transcript-submit" type="submit" disabled={isSubmittingTranscript}>
                    {isSubmittingTranscript ? "Enviando…" : "Extrair receita"}
                  </button>
                </form>
              )}
              {importRecord.status === "review_required" && reviewDraft && (
                <div className="recipe-draft">
                  <h4>Revise sua receita</h4>
                  <p className="field-hint">Os campos são editáveis. A receita só será salva como confirmada após você selecionar “Confirmar receita”. Quantidades e tempos ausentes continuam desconhecidos.</p>
                  {/* O assistente de voz fica fixo na hero, não dentro do rascunho. */}
                  <RecipeEditor value={reviewDraft} onChange={setReviewDraft} idPrefix="review" />
                  <div className="review-actions">
                    <button className="auth-secondary-button" type="button" onClick={saveRecipeReview} disabled={isSavingReview || isConfirmingRecipe}>{isSavingReview ? "Salvando…" : "Salvar revisão"}</button>
                    <button className="import-button" type="button" onClick={confirmRecipe} disabled={isSavingReview || isConfirmingRecipe}>{isConfirmingRecipe ? "Confirmando…" : "Confirmar receita"}</button>
                  </div>
                  {reviewDraft.uncertainties.length > 0 && <p className="field-hint">Pontos incertos: {reviewDraft.uncertainties.join(" · ")}</p>}
                  {reviewDraft.warnings.length > 0 && <p className="field-hint">Avisos: {reviewDraft.warnings.join(" · ")}</p>}
                </div>
              )}
              {importRecord.status === "completed" && importRecord.recipe_id && (
                <div className="recipe-draft">
                  <h4>Receita confirmada</h4>
                  <p className="field-hint">A receita e seus ingredientes e etapas foram persistidos no banco de dados.</p>
                  <strong>{importRecord.recipe_draft?.title ?? "Receita salva"}</strong>
                  <p className="field-hint"><Link href={"/minhas-receitas/" + importRecord.recipe_id}>Abrir em Minhas receitas →</Link></p>
                  <ShoppingListPanel recipeId={importRecord.recipe_id} accessToken={accessToken} />
                  {importRecord.recipe_draft && <KitchenMode recipeId={importRecord.recipe_id} title={importRecord.recipe_draft.title} description={importRecord.recipe_draft.description} servings={importRecord.recipe_draft.servings} ingredients={importRecord.recipe_draft.ingredients} steps={importRecord.recipe_draft.steps} getAccessToken={getAccessToken} />}
                </div>
              )}
            </section>
          )}

          <div className="supported-divider"><span /> FEITO PARA RECEITAS REAIS <span /></div>
          <div className="source-list" aria-label="Plataformas reconhecidas">
            <span className="source-chip"><span className="source-icon youtube">▶</span> YouTube</span>
            <span className="source-chip"><span className="source-icon tiktok">♪</span> TikTok</span>
            <span className="source-chip"><span className="source-icon instagram">◎</span> Instagram</span>
          </div>
          <p className="privacy-note"><span aria-hidden="true">↗</span> Não contornamos conteúdo privado nem restrições das plataformas.</p>
        </div>
        <VoiceAssistantHud
          contextLabel={reviewDraft ? "Edição da receita" : "Assistente de cozinha"}
          systemInstruction={reviewSystemInstruction || "Você é o assistente de voz do Recistep. Fale em português do Brasil, ajude com dúvidas sobre receitas e explique que ferramentas de edição ficam disponíveis quando uma receita estiver em revisão. Não invente dados de uma receita que ainda não foi importada."}
          toolGroups={reviewDraft ? REVIEW_TOOL_GROUPS : []}
          executeTool={executeReviewTool}
          getAccessToken={getAccessToken}
          thinkingLevel="low"
          apiRef={reviewVoiceApiRef}
        />
      </section>

      <section className="workflow" aria-labelledby="workflow-heading">
        <div className="section-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> DO LINK AO PREPARO</div>
            <h2 id="workflow-heading">Tudo no seu tempo.</h2>
          </div>
          <p>Uma receita bem organizada deixa espaço para aproveitar o que importa: cozinhar.</p>
        </div>
        <div className="workflow-grid">
          <article className="workflow-card">
            <div className="step-number">01 <span>·</span> ORGANIZE</div>
            <div className="workflow-icon icon-ingredients" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none"><path d="M8 17h32l-3 23H11L8 17Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M13 17c1-6 5-9 11-9s10 3 11 9" stroke="currentColor" strokeWidth="1.8"/><path d="M17 25v8m7-8v8m7-8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </div>
            <h3>Ingredientes sem surpresa</h3>
            <p>Veja quantidades, unidades e o que falta comprar antes de começar.</p>
          </article>
          <article className="workflow-card">
            <div className="step-number">02 <span>·</span> PLANEJE</div>
            <div className="workflow-icon icon-time" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="26" r="15" stroke="currentColor" strokeWidth="1.8"/><path d="M24 17v10l7 4M18 5h12M24 5v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h3>Tempo para cada etapa</h3>
            <p>Separe preparo, descanso e forno para saber o que vem a seguir.</p>
          </article>
          <article className="workflow-card">
            <div className="step-number">03 <span>·</span> COZINHE</div>
            <div className="workflow-icon icon-cook" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none"><path d="M10 21h28l-3 20H13l-3-20Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M15 21v-4a9 9 0 0 1 18 0v4M19 9l-2-4m12 4 2-4M18 29h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </div>
            <h3>Um passo de cada vez</h3>
            <p>Acompanhe o preparo sem precisar voltar ao vídeo a cada minuto.</p>
          </article>
        </div>
      </section>

      <footer className="footer">
        <Link className="brand footer-brand" href="/" aria-label="Recistep, início">
          <span className="brand-mark" aria-hidden="true"><span>R</span></span>
          <span>reci<span className="brand-light">step</span></span>
        </Link>
        <span>Menos improviso. Mais sabor.</span>
        <span className="footer-version">RECISTEP · MVP</span>
      </footer>
    </main>
  );
}
