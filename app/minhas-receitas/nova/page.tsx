"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { useVoiceAssistantContext, type VoiceContextConfig } from "@/components/voice-assistant-provider";
import { PageTransition } from "@/components/view-transition";
import { RecipeEditor } from "@/components/recipe-editor";
import { CoverImagePicker } from "@/components/cover-image-picker";
import { apiFetch } from "@/lib/client/api";
import { createEmptyRecipe, type RecipeApiData } from "@/lib/recipe/recipe-draft";
import { defineToolGroup } from "@/lib/voice/function-tool";
import type { ExecuteToolFn } from "@/lib/voice/live-session";
import { MANUAL_RECIPE_TOOL_GROUPS, buildManualEditSystemInstruction, executeManualRecipeEditTool, type ManualRecipeVoiceBridge } from "@/lib/voice/manual-recipe-tools";
import type { RecipeExtraction } from "@/lib/schemas/recipe";

function ManualRecipeVoice({
  bridge,
}: {
  bridge: ManualRecipeVoiceBridge;
}) {
  const bridgeRef = useRef<ManualRecipeVoiceBridge | null>(null);
  useEffect(() => { bridgeRef.current = bridge; }, [bridge]);

  const executeVoiceTool = useCallback<ExecuteToolFn>(async (name, args, setActionLabel) => {
    const current = bridgeRef.current;
    if (!current) return { success: false, error: "A receita ainda não carregou." };
    return executeManualRecipeEditTool(current, name, args, setActionLabel);
  }, []);

  const systemInstruction = useMemo(() => buildManualEditSystemInstruction(bridge.draft), [bridge.draft]);
  const voiceContext = useMemo<VoiceContextConfig>(() => ({
    key: "manual-new",
    contextLabel: "Nova receita",
    systemInstruction,
    toolGroups: MANUAL_RECIPE_TOOL_GROUPS,
    executeTool: executeVoiceTool,
    thinkingLevel: "low",
  }), [systemInstruction, executeVoiceTool]);

  useVoiceAssistantContext(voiceContext);
  return null;
}

export default function NovaReceitaPage() {
  const router = useRouter();
  const { accessToken, signedInEmail } = useAuth();
  const [draft, setDraft] = useState<RecipeExtraction>(() => createEmptyRecipe());
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = useCallback(async () => {
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
      let coverFailed = false;
      if (coverFile) {
        try {
          const formData = new FormData();
          formData.append("file", coverFile);
          const response = await fetch(`/api/v1/recipes/${data.id}/cover`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            body: formData,
          });
          if (!response.ok) coverFailed = true;
        } catch {
          coverFailed = true;
        }
      }
      router.push(coverFailed ? `/minhas-receitas/${data.id}/editar` : `/minhas-receitas/${data.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a receita.");
    } finally {
      setSaving(false);
    }
  }, [accessToken, draft, router, coverFile]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  const manualBridge = useMemo<ManualRecipeVoiceBridge>(() => ({
    draft,
    actions: {
      commit: setDraft,
      save: () => save(),
      cancel: () => router.push("/minhas-receitas"),
    },
  }), [draft, save, router]);

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
        <>
          <ManualRecipeVoice bridge={manualBridge} />
          <form className="recipe-draft" onSubmit={submit}>
            {error && <p className="feedback feedback-error" role="alert">{error}</p>}
            <CoverImagePicker
              idPrefix="new"
              value={coverFile}
              onChange={setCoverFile}
              onInvalid={setError}
              disabled={saving}
              existingUrl={draft.cover_image_url}
            />
            <RecipeEditor value={draft} onChange={setDraft} idPrefix="new" allowStructureEdit />
            <div className="review-actions">
              <button className="auth-secondary-button" type="button" onClick={() => router.push("/minhas-receitas")}>Cancelar</button>
              <button className="import-button" type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar receita"}</button>
            </div>
          </form>
        </>
      )}
    </main>
    </PageTransition>
  );
}
