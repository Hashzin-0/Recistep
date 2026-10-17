"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type ImportFeedback =
  | { kind: "error"; message: string }
  | { kind: "info"; message: string }
  | null;

type RecipeDraft = {
  title?: string;
  ingredients?: Array<{ name: string; quantity: number | null; unit: string | null; notes: string | null }>;
  steps?: Array<{ position: number; instruction: string; duration_seconds: number | null }>;
  uncertainties?: string[];
  warnings?: string[];
};

type ImportRecord = {
  id: string;
  status: string;
  error_message?: string | null;
  source_metadata?: { title?: string; author_name?: string | null } | null;
  recipe_draft?: RecipeDraft | null;
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
  const supabase = createBrowserSupabaseClient();
  const [sourceUrl, setSourceUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isSubmittingTranscript, setIsSubmittingTranscript] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ImportFeedback>(null);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [importRecord, setImportRecord] = useState<ImportRecord | null>(null);
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    if (!supabase) {
      setAuthFeedback("Autenticação indisponível: configure as variáveis públicas do Supabase.");
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setAccessToken(data.session?.access_token ?? null);
      setSignedInEmail(data.session?.user.email ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
      setSignedInEmail(session?.user.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

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

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setAuthFeedback("Configure o Supabase para habilitar autenticação.");
      return;
    }
    setIsAuthBusy(true);
    setAuthFeedback(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) {
        setAuthFeedback("Não foi possível entrar. Confira e-mail e senha.");
        return;
      }
      setAuthPassword("");
      setAuthFeedback("Sessão iniciada.");
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function handleSignUp() {
    if (!supabase) {
      setAuthFeedback("Configure o Supabase para habilitar autenticação.");
      return;
    }
    if (!authEmail.trim() || authPassword.length < 8) {
      setAuthFeedback("Informe um e-mail válido e uma senha com pelo menos 8 caracteres.");
      return;
    }
    setIsAuthBusy(true);
    setAuthFeedback(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) {
        setAuthFeedback("Não foi possível criar a conta. Confira os dados e as configurações de Auth.");
        return;
      }
      setAuthPassword("");
      setAuthFeedback(data.session
        ? "Conta criada e sessão iniciada."
        : "Conta criada. Confira seu e-mail para confirmar o cadastro antes de entrar.");
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function handleSignOut() {
    if (!supabase) return;
    setIsAuthBusy(true);
    try {
      await supabase.auth.signOut();
      setAuthFeedback("Sessão encerrada.");
      setActiveImportId(null);
      setImportRecord(null);
      setTranscript("");
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function refreshImportStatus() {
    if (!supabase || !activeImportId) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
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
    if (!supabase || !accessToken) {
      setFeedback({ kind: "info", message: "Entre na sua conta para iniciar uma importação." });
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
    if (!supabase || !activeImportId || !accessToken) {
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
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Recistep, início">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none">
              <path d="M11 8.5h18a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3v-17a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M14 15h12M14 20h8M14 25h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <path d="m24 25 2.5 2.5L32 21" stroke="#D5F06D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <span>reci<span className="brand-light">step</span></span>
        </a>
        <div className="topbar-note"><span className="status-dot" /> Seu próximo prato começa aqui</div>
      </header>

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
          <div className="auth-panel">
            {signedInEmail ? (
              <div className="auth-signed-in">
                <div>
                  <span className="auth-label">CONECTADO</span>
                  <strong>{signedInEmail}</strong>
                </div>
                <button className="auth-secondary-button" type="button" onClick={handleSignOut} disabled={isAuthBusy}>
                  Sair
                </button>
              </div>
            ) : (
              <form className="auth-form" onSubmit={handleSignIn}>
                <div className="auth-panel-title">Entre para salvar suas receitas</div>
                <label htmlFor="auth-email">E-mail</label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  maxLength={254}
                  required
                />
                <label htmlFor="auth-password">Senha</label>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete="current-password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                />
                <div className="auth-actions">
                  <button className="auth-primary-button" type="submit" disabled={isAuthBusy}>
                    {isAuthBusy ? "Aguarde…" : "Entrar"}
                  </button>
                  <button className="auth-secondary-button" type="button" onClick={handleSignUp} disabled={isAuthBusy}>
                    Criar conta
                  </button>
                </div>
              </form>
            )}
            {authFeedback && <p className="auth-feedback" role="status" aria-live="polite">{authFeedback}</p>}
          </div>
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
              {importRecord.error_message && importRecord.status === "failed" && (
                <p className="field-hint">{importRecord.error_message}</p>
              )}
              {importRecord.status === "source_content_required" && (
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
              {importRecord.status === "review_required" && importRecord.recipe_draft && (
                <div className="recipe-draft">
                  <h4>{importRecord.recipe_draft.title ?? "Rascunho de receita"}</h4>
                  <p className="field-hint">Rascunho gerado por IA. Revise os campos antes de considerar a receita confirmada.</p>
                  <strong>Ingredientes</strong>
                  <ul>
                    {(importRecord.recipe_draft.ingredients ?? []).map((ingredient, index) => (
                      <li key={index}>
                        {ingredient.name}
                        {ingredient.quantity !== null && ingredient.quantity !== undefined ? " — " + ingredient.quantity : ""}
                        {ingredient.unit ? " " + ingredient.unit : ""}
                        {ingredient.notes ? " (" + ingredient.notes + ")" : ""}
                      </li>
                    ))}
                  </ul>
                  <strong>Etapas</strong>
                  <ol>
                    {(importRecord.recipe_draft.steps ?? []).slice().sort((a, b) => a.position - b.position).map((step) => (
                      <li key={step.position}>{step.instruction}</li>
                    ))}
                  </ol>
                  {(importRecord.recipe_draft.uncertainties ?? []).length > 0 && (
                    <p className="field-hint">Pontos incertos: {importRecord.recipe_draft.uncertainties?.join(" · ")}</p>
                  )}
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
        <a className="brand footer-brand" href="/" aria-label="Recistep, início">
          <span className="brand-mark" aria-hidden="true"><span>R</span></span>
          <span>reci<span className="brand-light">step</span></span>
        </a>
        <span>Menos improviso. Mais sabor.</span>
        <span className="footer-version">RECISTEP · MVP</span>
      </footer>
    </main>
  );
}
