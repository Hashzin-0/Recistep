"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { CardSwap } from "@/components/card-swap";
import { ShoppingListPanel } from "@/components/recipe-planner";
import { RecipeEditor } from "@/components/recipe-editor";
import { KitchenMode } from "@/components/kitchen-mode";
import { useVoiceAssistantContext, useVoiceAssistantControls, type VoiceContextConfig } from "@/components/voice-assistant-provider";
import { VoiceTranscriptInput } from "@/components/voice-transcript-input";
import { PageTransition } from "@/components/view-transition";
import { defineToolGroup } from "@/lib/voice/function-tool";
import { buildReviewSystemInstruction } from "@/lib/voice/prompts";
import { buildImportSystemInstruction } from "@/lib/voice/import-tools";
import { RECIPE_EDIT_TOOLS, executeRecipeEditTool } from "@/lib/voice/recipe-tools";
import type { ImportVoiceActions, ImportVoiceBridge } from "@/lib/voice/import-tools";
import { IMPORT_TOOLS, executeImportTool as runImportVoiceTool } from "@/lib/voice/import-tools";
import { buildVideoDisplay } from "@/lib/recipe/video-display";
import type { ExecuteToolFn } from "@/lib/voice/live-session";
import type { RecipeExtraction } from "@/lib/schemas/recipe";

const REVIEW_TOOL_GROUPS = [defineToolGroup(RECIPE_EDIT_TOOLS)];
const IMPORT_TOOL_GROUPS = [defineToolGroup(IMPORT_TOOLS)];

const HOME_SYSTEM_INSTRUCTION = [
  "Você é o assistente de voz do Recistep. Fale em português do Brasil, de forma curta e natural.",
  "Ajude a importar receitas de links (YouTube, TikTok, Instagram), arquivos e transcrições ditadas.",
  "Quando uma receita estiver em revisão, as ferramentas de edição ficam disponíveis; antes disso, apenas oriente o usuário.",
  "Nunca invente dados de uma receita que ainda não foi importada.",
].join("\n");

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
  source_url?: string | null;
  platform?: "youtube" | "tiktok" | "instagram" | null;
  source_metadata?: { title?: string; author_name?: string | null; thumbnail_url?: string | null; media_url?: string | null } | null;
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

const ACTIVE_IMPORT_STATUSES: string[] = [
  "queued",
  "processing",
  "source_content_required",
  "review_required",
];

const ACTIVE_IMPORT_STORAGE_PREFIX = "recistep:active-import:";

function activeImportStorageKey(email: string | null): string {
  return ACTIVE_IMPORT_STORAGE_PREFIX + (email?.trim().toLowerCase() || "anon");
}

function readStoredImportId(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredImportId(key: string, id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(key, id);
    else window.localStorage.removeItem(key);
  } catch {
    // Persisting the active import is best-effort; the UI still works without it.
  }
}

export default function HomePage() {
  const { supabase, accessToken, getAccessToken, signedInEmail } = useAuth();
  const [sourceUrl, setSourceUrl] = useState("");
  const [convertCupsToGrams, setConvertCupsToGrams] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingTranscript, setIsSubmittingTranscript] = useState(false);
  const [selectedRecipeFile, setSelectedRecipeFile] = useState<File | null>(null);
  const [isExtractingFile, setIsExtractingFile] = useState(false);
  const [feedback, setFeedback] = useState<ImportFeedback>(null);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [importRecord, setImportRecord] = useState<ImportRecord | null>(null);
  const [transcript, setTranscript] = useState("");
  const [voiceRecipeTranscript, setVoiceRecipeTranscript] = useState("");
  const [voiceRecipeDraft, setVoiceRecipeDraft] = useState<RecipeExtraction | null>(null);
  const [isExtractingVoiceRecipe, setIsExtractingVoiceRecipe] = useState(false);
  const [isSavingVoiceRecipe, setIsSavingVoiceRecipe] = useState(false);
  const [voiceRecipeMessage, setVoiceRecipeMessage] = useState<string | null>(null);
  const [voiceSavedRecipeId, setVoiceSavedRecipeId] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<RecipeExtraction | null>(null);
  const [streamDraft, setStreamDraft] = useState<RecipeExtraction | null>(null);
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [isConfirmingRecipe, setIsConfirmingRecipe] = useState(false);
  const [isCancellingImport, setIsCancellingImport] = useState(false);
  const reviewDraftRef = useRef(reviewDraft);
  useEffect(() => { reviewDraftRef.current = reviewDraft; }, [reviewDraft]);
  const voiceControls = useVoiceAssistantControls();

  const reviewSystemInstruction = useMemo(
    () => (reviewDraft ? buildReviewSystemInstruction(reviewDraft) : ""),
    [reviewDraft],
  );

  const completedVideoDisplay = useMemo(() => {
    if (!importRecord || importRecord.status !== "completed") return null;
    const meta = importRecord.source_metadata ?? {};
    return buildVideoDisplay({
      platform: importRecord.platform ?? null,
      sourceUrl: importRecord.source_url ?? null,
      thumbnailUrl: meta.thumbnail_url ?? null,
      videoUrl: meta.media_url ?? null,
      title: importRecord.recipe_draft?.title ?? meta.title ?? null,
      authorName: meta.author_name ?? null,
    });
  }, [importRecord]);

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

  const voiceStartImport = useCallback(async (url: string) => {
    if (!accessToken) return { ok: false, message: "Entre com Google para importar." };
    setSourceUrl(url);
    setFeedback(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/imports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ source_url: url, locale: "pt-BR", convert_cups_to_grams: convertCupsToGrams }),
      });
      const body = await response.json() as { data?: ImportRecord; error?: { message?: string } };
      if (!response.ok || !body.data?.id) {
        const message = body.error?.message ?? "Não foi possível iniciar esta importação.";
        setFeedback({ kind: response.status === 503 ? "info" : "error", message });
        return { ok: false, message };
      }
      setActiveImportId(body.data.id);
      setImportRecord(body.data);
      setTranscript("");
      setFeedback({ kind: "info", message: "Importação registrada. Acompanhe o estado abaixo." });
      return { ok: true, message: "Importação registrada; o estado aparece na tela." };
    } catch {
      const message = "Não foi possível conectar ao servidor. Verifique sua conexão.";
      setFeedback({ kind: "error", message });
      return { ok: false, message };
    } finally {
      setIsSubmitting(false);
    }
  }, [accessToken]);

  const voiceStartTranscript = useCallback(async (text: string) => {
    if (!accessToken) return { ok: false, message: "Entre com Google para criar a receita." };
    setIsExtractingVoiceRecipe(true);
    setVoiceRecipeMessage(null);
    setVoiceSavedRecipeId(null);
    try {
      const response = await fetch("/api/v1/recipes/extract-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ transcript: text, locale: "pt-BR", convert_cups_to_grams: convertCupsToGrams }),
      });
      const body = await response.json() as { data?: RecipeExtraction; error?: { message?: string } };
      if (!response.ok || !body.data) {
        const message = body.error?.message ?? "Não foi possível transformar a fala em receita.";
        setVoiceRecipeMessage(message);
        return { ok: false, message };
      }
      setVoiceRecipeDraft(body.data);
      setVoiceRecipeMessage("Rascunho criado. Revise ingredientes, quantidades e etapas antes de salvar.");
      return { ok: true, message: "Rascunho criado na tela; o usuário pode revisar e salvar em Minhas receitas." };
    } catch {
      const message = "Falha de conexão ao gerar a receita. O texto continua disponível para tentar novamente.";
      setVoiceRecipeMessage(message);
      return { ok: false, message };
    } finally {
      setIsExtractingVoiceRecipe(false);
    }
  }, [accessToken]);

  const voiceRetryImport = useCallback(async () => {
    const url = importRecord?.source_url ?? sourceUrl.trim();
    if (!url) return { ok: false, message: "Não há um link anterior para tentar de novo." };
    return voiceStartImport(url);
  }, [importRecord?.source_url, sourceUrl, voiceStartImport]);

  const voiceDismissImport = useCallback(() => {
    setActiveImportId(null);
    setImportRecord(null);
    setReviewDraft(null);
    setStreamDraft(null);
    setTranscript("");
    setFeedback(null);
  }, []);

  const voiceOpenReview = useCallback(() => {
    if (importRecord?.recipe_draft) setReviewDraft(importRecord.recipe_draft);
  }, [importRecord?.recipe_draft]);

  const importBridge = useMemo<ImportVoiceBridge>(() => ({
    state: {
      activeImportId,
      status: importRecord?.status ?? null,
      sourceUrl: importRecord?.source_url ?? (sourceUrl.trim() || null),
      hasDraft: Boolean(importRecord?.recipe_draft),
    },
    actions: {
      startImportByUrl: voiceStartImport,
      startImportFromTranscript: voiceStartTranscript,
      retryImport: voiceRetryImport,
      dismissImport: voiceDismissImport,
      openReview: voiceOpenReview,
    } satisfies ImportVoiceActions,
  }), [activeImportId, importRecord, sourceUrl, voiceStartImport, voiceStartTranscript, voiceRetryImport, voiceDismissImport, voiceOpenReview]);

  const importBridgeRef = useRef(importBridge);
  useEffect(() => { importBridgeRef.current = importBridge; }, [importBridge]);

  const executeImportTool = useCallback<ExecuteToolFn>(async (name, args, setActionLabel) => {
    const current = importBridgeRef.current;
    if (!current) return { success: false, error: "Estado de importação indisponível." };
    return runImportVoiceTool(current, name, args, setActionLabel);
  }, []);

  const importSystemInstruction = useMemo(
    () => buildImportSystemInstruction({
      status: importRecord?.status ?? null,
      hasDraft: Boolean(importRecord?.recipe_draft),
      sourceUrl: importRecord?.source_url ?? null,
    }),
    [importRecord?.status, importRecord?.recipe_draft, importRecord?.source_url],
  );

  const voiceContext = useMemo<VoiceContextConfig>(() => (
    reviewDraft
      ? {
          key: "review",
          contextLabel: "Edição da receita",
          systemInstruction: reviewSystemInstruction,
          toolGroups: REVIEW_TOOL_GROUPS,
          executeTool: executeReviewTool,
          thinkingLevel: "low",
        }
      : {
          key: "home",
          contextLabel: "Importar receita",
          systemInstruction: importSystemInstruction,
          toolGroups: IMPORT_TOOL_GROUPS,
          executeTool: executeImportTool,
          thinkingLevel: "low",
        }
  ), [reviewDraft, reviewSystemInstruction, executeReviewTool, importSystemInstruction, executeImportTool]);

  useVoiceAssistantContext(voiceContext);

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

  const storageKey = useMemo(() => activeImportStorageKey(signedInEmail), [signedInEmail]);
  const rehydratedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeImportId) return;
    writeStoredImportId(storageKey, activeImportId);
  }, [activeImportId, storageKey]);

  useEffect(() => {
    if (!importRecord) return;
    if (!ACTIVE_IMPORT_STATUSES.includes(importRecord.status)) {
      writeStoredImportId(storageKey, null);
    }
  }, [importRecord?.status, storageKey]);

  useEffect(() => {
    if (!supabase || !accessToken) return;
    if (rehydratedForRef.current === storageKey) return;
    rehydratedForRef.current = storageKey;

    let cancelled = false;

    const applyRecord = (record: ImportRecord | null | undefined): boolean => {
      if (!record || cancelled || !ACTIVE_IMPORT_STATUSES.includes(record.status)) return false;
      setActiveImportId(record.id);
      setImportRecord(record);
      writeStoredImportId(storageKey, record.id);
      return true;
    };

    void (async () => {
      const storedId = readStoredImportId(storageKey);
      if (storedId) {
        try {
          const response = await fetch("/api/v1/imports/" + storedId, {
            headers: { Authorization: "Bearer " + accessToken },
            cache: "no-store",
          });
          if (response.ok) {
            const body = await response.json() as { data?: ImportRecord };
            if (applyRecord(body.data)) return;
          }
        } catch {
          // Fall through to the server-side list below.
        }
        if (!cancelled) writeStoredImportId(storageKey, null);
      }

      try {
        const response = await fetch("/api/v1/imports", {
          headers: { Authorization: "Bearer " + accessToken },
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const body = await response.json() as { data?: ImportRecord[] };
        const candidate = body.data?.find((record) => ACTIVE_IMPORT_STATUSES.includes(record.status));
        applyRecord(candidate);
      } catch {
        // Rehydration is best-effort; the user can start a new import normally.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, accessToken, storageKey]);

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

  async function extractVoiceRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTranscript = voiceRecipeTranscript.trim();
    if (normalizedTranscript.length < 80) {
      setVoiceRecipeMessage("Fale ou escreva pelo menos 80 caracteres para gerar um rascunho útil.");
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      setVoiceRecipeMessage("Entre novamente para criar uma receita.");
      return;
    }
    setIsExtractingVoiceRecipe(true);
    setVoiceRecipeMessage(null);
    setVoiceSavedRecipeId(null);
    try {
      const response = await fetch("/api/v1/recipes/extract-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ transcript: normalizedTranscript, locale: "pt-BR", convert_cups_to_grams: convertCupsToGrams }),
      });
      const body = await response.json() as { data?: RecipeExtraction; error?: { message?: string } };
      if (!response.ok || !body.data) {
        setVoiceRecipeMessage(body.error?.message ?? "Não foi possível transformar a fala em receita.");
        return;
      }
      setVoiceRecipeDraft(body.data);
      setVoiceRecipeMessage("Rascunho criado. Revise ingredientes, quantidades e etapas antes de salvar.");
    } catch {
      setVoiceRecipeMessage("Falha de conexão ao gerar a receita. Seu texto continua disponível para tentar novamente.");
    } finally {
      setIsExtractingVoiceRecipe(false);
    }
  }

  async function saveVoiceRecipe() {
    if (!voiceRecipeDraft) return;
    const token = await getAccessToken();
    if (!token) {
      setVoiceRecipeMessage("Entre novamente para salvar a receita.");
      return;
    }
    setIsSavingVoiceRecipe(true);
    setVoiceRecipeMessage(null);
    try {
      const response = await fetch("/api/v1/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(voiceRecipeDraft),
      });
      const body = await response.json() as { data?: { id?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.id) {
        setVoiceRecipeMessage(body.error?.message ?? "Não foi possível salvar a receita.");
        return;
      }
      setVoiceSavedRecipeId(body.data.id);
      setVoiceRecipeDraft(null);
      setVoiceRecipeMessage("Receita salva em Minhas receitas.");
    } catch {
      setVoiceRecipeMessage("Falha de conexão ao salvar. O rascunho continua disponível para tentar novamente.");
    } finally {
      setIsSavingVoiceRecipe(false);
    }
  }

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
      voiceControls.disconnect();
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

  async function cancelImport() {
    if (!activeImportId) return;
    const token = await getAccessToken();
    if (!token) {
      setFeedback({ kind: "error", message: "Entre novamente para cancelar esta importação." });
      return;
    }
    setIsCancellingImport(true);
    try {
      const response = await fetch("/api/v1/imports/" + activeImportId + "/cancel", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      const body = await response.json() as { data?: { id: string; status: string }; error?: { message?: string } };
      if (!response.ok || !body.data) {
        setFeedback({ kind: "error", message: body.error?.message ?? "Não foi possível cancelar a importação." });
        return;
      }
      setActiveImportId(null);
      setImportRecord(null);
      setReviewDraft(null);
      setStreamDraft(null);
      setTranscript("");
      setFeedback({ kind: "info", message: "Importação cancelada." });
    } catch {
      setFeedback({ kind: "error", message: "Não foi possível cancelar a importação agora." });
    } finally {
      setIsCancellingImport(false);
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
        body: JSON.stringify({ source_url: sourceUrl, locale: "pt-BR", convert_cups_to_grams: convertCupsToGrams }),
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

  async function handleFileRecipeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRecipeFile) {
      setFeedback({ kind: "error", message: "Selecione um PDF, imagem ou vídeo primeiro." });
      return;
    }
    if (selectedRecipeFile.size > 4 * 1024 * 1024) {
      setFeedback({ kind: "error", message: "O arquivo deve ter no máximo 4 MB. Para vídeos maiores, use um link compatível ou uma versão menor do arquivo." });
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      setFeedback({ kind: "error", message: "Entre na sua conta para importar um arquivo." });
      return;
    }

    setIsExtractingFile(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedRecipeFile);
      formData.append("locale", "pt-BR");
      formData.append("convert_cups_to_grams", convertCupsToGrams ? "true" : "false");
      const response = await fetch("/api/v1/recipes/extract-file", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: formData,
      });
      const body = await response.json() as { data?: RecipeExtraction; error?: { message?: string } };
      if (!response.ok || !body.data) {
        setFeedback({ kind: "error", message: body.error?.message ?? "Não foi possível extrair a receita deste arquivo." });
        return;
      }
      setVoiceRecipeDraft(body.data);
      setVoiceRecipeMessage("Rascunho extraído do arquivo. Revise ingredientes, quantidades e etapas antes de salvar.");
      setVoiceSavedRecipeId(null);
      setSelectedRecipeFile(null);
      setFeedback({ kind: "info", message: "Arquivo analisado. Revise o rascunho antes de salvar a receita." });
    } catch {
      setFeedback({ kind: "error", message: "Falha de conexão ao analisar o arquivo. Tente novamente." });
    } finally {
      setIsExtractingFile(false);
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
        body: JSON.stringify({ transcript, convert_cups_to_grams: convertCupsToGrams }),
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
    <PageTransition>
    <main className={"site-shell page-main" + (signedInEmail ? " is-authenticated-workspace" : "")}>
      <section className="hero">
        <div className="hero-copy">
          <h1 className="hero-title" data-lines>
            <span className="line"><span style={{ "--i": 0 } as CSSProperties}>Do vídeo à mesa.</span></span>
            <span className="line"><span style={{ "--i": 1 } as CSSProperties}><em>Sem perder</em> nenhum passo.</span></span>
          </h1>
          <p className="hero-description" data-reveal style={{ "--reveal-delay": "260ms" } as CSSProperties}>
            Transforme receitas que você encontra por aí em ingredientes organizados,
            etapas claras e um preparo que cabe na sua rotina.
          </p>
          <div className="hero-points" data-reveal style={{ "--reveal-delay": "360ms" } as CSSProperties}>
            <span><span className="check">✓</span> Ingredientes reunidos</span>
            <span><span className="check">✓</span> Tempos por etapa</span>
            <span><span className="check">✓</span> Lista de compras</span>
          </div>
        </div>

        <div className="import-column">
          <div className="import-card">
          <div className="card-kicker">Importar receita</div>
          <h2>Encontrou algo gostoso?</h2>
          <p className="card-description">
            {signedInEmail
              ? "Cole o link do vídeo para começar a organizar a receita."
              : "Entre com o Google para importar, organizar e salvar suas receitas."}
          </p>
          <SignInPrompt message="Entre para importar e salvar suas receitas." />

          {signedInEmail && (
            <>
              <CardSwap
                ariaLabel="Modos de importação"
                faces={[
                  {
                    id: "link",
                    label: "Link",
                    content: (
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
                 <label className="inline-checkbox">
                   <input type="checkbox" checked={convertCupsToGrams} onChange={(event) => setConvertCupsToGrams(event.target.checked)} />
                   Converter xícara para gramas
                 </label>
                 <p className="field-hint" id="supported-sources">
                   YouTube, TikTok e Instagram. A análise depende do acesso permitido à fonte.
                 </p>
              </form>
                    ),
                  },
                  {
                    id: "file",
                    label: "Arquivo",
                    content: (
              <form className="file-recipe-import" onSubmit={handleFileRecipeSubmit}>
                <label htmlFor="recipe-file">Ou importe um arquivo</label>
                <p className="field-hint">PDF, imagem (JPG, PNG, WebP) ou vídeo (MP4, WebM, MOV), até 4 MB.</p>
                <div className="file-recipe-controls">
                  <input
                    id="recipe-file"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,application/pdf,image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setSelectedRecipeFile(file);
                      if (file && file.size > 4 * 1024 * 1024) {
                        setFeedback({ kind: "error", message: "O arquivo deve ter no máximo 4 MB." });
                      } else if (file) {
                        setFeedback(null);
                      }
                    }}
                    disabled={isExtractingFile}
                    aria-describedby="recipe-file-help"
                  />
                  <button className="import-button" type="submit" disabled={!selectedRecipeFile || isExtractingFile}>
                    {isExtractingFile ? "Analisando arquivo…" : "Extrair receita"}
                  </button>
                </div>
                 <label className="inline-checkbox">
                   <input type="checkbox" checked={convertCupsToGrams} onChange={(event) => setConvertCupsToGrams(event.target.checked)} />
                   Converter xícara para gramas
                 </label>
                 <span className="field-hint" id="recipe-file-help">
                   {selectedRecipeFile ? `${selectedRecipeFile.name} · ${(selectedRecipeFile.size / (1024 * 1024)).toFixed(2)} MB` : "O arquivo é enviado para análise e usado apenas para gerar um rascunho."}
                 </span>
              </form>
                    ),
                  },
                  {
                    id: "transcript",
                    label: "Transcrição",
                    content: (
              <section className="voice-recipe-workspace" aria-labelledby="voice-recipe-heading">
                <span className="auth-label">Sem precisar de um link</span>
                <h3 id="voice-recipe-heading">Dite uma receita</h3>
                <p className="field-hint">Conte os ingredientes, as quantidades e o preparo. O Recistep monta um rascunho para você revisar; informações que não forem ditas permanecem em aberto.</p>
                <form onSubmit={extractVoiceRecipe}>
                  <VoiceTranscriptInput
                    value={voiceRecipeTranscript}
                    onChange={setVoiceRecipeTranscript}
                    disabled={isExtractingVoiceRecipe || isSavingVoiceRecipe}
                  />
                  <label className="inline-checkbox">
                    <input type="checkbox" checked={convertCupsToGrams} onChange={(event) => setConvertCupsToGrams(event.target.checked)} />
                    Converter xícara para gramas
                  </label>
                  <button className="import-button transcript-submit" type="submit" disabled={isExtractingVoiceRecipe || isSavingVoiceRecipe || voiceRecipeTranscript.trim().length < 80}>
                    {isExtractingVoiceRecipe ? "Montando rascunho…" : "Gerar rascunho da receita"}
                  </button>
                </form>
                {voiceRecipeMessage && (
                  <p className="field-hint" role="status" aria-live="polite">{voiceRecipeMessage}</p>
                )}
                {voiceSavedRecipeId && (
                  <p className="field-hint"><Link href={"/minhas-receitas/" + voiceSavedRecipeId}>Abrir receita salva →</Link></p>
                )}
                {voiceRecipeDraft && (
                  <div className="recipe-draft voice-recipe-draft">
                    <h4>Revise antes de salvar</h4>
                    <p className="field-hint">Confira o que foi reconhecido. Quantidades e tempos não informados não são inventados.</p>
                    <RecipeEditor value={voiceRecipeDraft} onChange={setVoiceRecipeDraft} idPrefix="voice-draft" allowStructureEdit />
                    {voiceRecipeDraft.uncertainties.length > 0 && <p className="field-hint">Pontos incertos: {voiceRecipeDraft.uncertainties.join(" · ")}</p>}
                    {voiceRecipeDraft.warnings.length > 0 && <p className="field-hint">Avisos: {voiceRecipeDraft.warnings.join(" · ")}</p>}
                    <div className="review-actions">
                      <button className="import-button" type="button" onClick={saveVoiceRecipe} disabled={isSavingVoiceRecipe || isExtractingVoiceRecipe}>
                        {isSavingVoiceRecipe ? "Salvando…" : "Salvar receita"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
                    ),
                  },
                ]}
              />

              {feedback && (
                <div className={`feedback feedback-${feedback.kind}`} role="status" aria-live="polite">
                  <span aria-hidden="true">{feedback.kind === "error" ? "!" : "i"}</span>
                  {feedback.message}
                </div>
              )}
            </>
          )}
          </div>

          {signedInEmail && (
            <Link className="manual-create-link" href="/minhas-receitas/nova">
              Ou crie uma receita manualmente →
            </Link>
          )}

          {signedInEmail && activeImportId && importRecord && (
            <section className="import-status" aria-labelledby="import-status-heading">
              <div className="import-status-heading">
                <div>
                  <span className="auth-label">Importação</span>
                  <h3 id="import-status-heading">{statusLabel(importRecord.status)}</h3>
                </div>
                {ACTIVE_IMPORT_STATUSES.includes(importRecord.status) ? (
                  <button className="auth-secondary-button" type="button" onClick={cancelImport} disabled={isCancellingImport}>
                    {isCancellingImport ? "Cancelando…" : "Cancelar"}
                  </button>
                ) : (
                  <button className="auth-secondary-button" type="button" onClick={refreshImportStatus}>
                    Atualizar
                  </button>
                )}
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
                      <span className="auth-label">Ingredientes ({streamDraft.ingredients.length})</span>
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
                      <span className="auth-label">Modo de preparo ({streamDraft.steps.length})</span>
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
                   <label className="inline-checkbox">
                     <input type="checkbox" checked={convertCupsToGrams} onChange={(event) => setConvertCupsToGrams(event.target.checked)} />
                     Converter xícara para gramas
                   </label>
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
                  {importRecord.recipe_draft && <KitchenMode recipeId={importRecord.recipe_id} title={importRecord.recipe_draft.title} description={importRecord.recipe_draft.description} servings={importRecord.recipe_draft.servings} ingredients={importRecord.recipe_draft.ingredients} steps={importRecord.recipe_draft.steps} videoDisplay={completedVideoDisplay} />}
                </div>
              )}
            </section>
          )}

        </div>
      </section>

      <section className="workflow" aria-labelledby="workflow-heading">
        <div className="section-heading" data-reveal>
          <h2 id="workflow-heading">Do link ao preparo, no seu tempo.</h2>
          <p>Uma receita bem organizada deixa espaço para aproveitar o que importa: cozinhar.</p>
        </div>
        <ol className="workflow-list" data-reveal>
          <li>
            <span className="workflow-marker" aria-hidden="true">1</span>
            <h3>Ingredientes sem surpresa</h3>
            <p>Veja quantidades, unidades e o que falta comprar antes de começar.</p>
          </li>
          <li>
            <span className="workflow-marker" aria-hidden="true">2</span>
            <h3>Tempo para cada etapa</h3>
            <p>Separe preparo, descanso e forno para saber o que vem a seguir.</p>
          </li>
          <li>
            <span className="workflow-marker" aria-hidden="true">3</span>
            <h3>Um passo de cada vez</h3>
            <p>Acompanhe o preparo sem precisar voltar ao vídeo a cada minuto.</p>
          </li>
        </ol>
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
    </PageTransition>
  );
}
