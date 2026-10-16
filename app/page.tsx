"use client";

import { FormEvent, useState } from "react";

type ImportFeedback =
  | { kind: "error"; message: string }
  | { kind: "info"; message: string }
  | null;

export default function HomePage() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<ImportFeedback>(null);

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_url: sourceUrl, locale: "pt-BR" }),
      });

      const body: {
        error?: { message?: string; code?: string };
      } = await response.json();

      if (!response.ok) {
        setFeedback({
          kind: response.status === 503 ? "info" : "error",
          message:
            body.error?.message ??
            "Não foi possível validar esse link. Tente novamente.",
        });
        return;
      }

      setFeedback({ kind: "info", message: "Solicitação recebida." });
    } catch {
      setFeedback({
        kind: "error",
        message: "Não foi possível conectar ao servidor. Verifique sua conexão.",
      });
    } finally {
      setIsSubmitting(false);
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
