import { validateSourceUrl } from "@/lib/source-url";
import { declareReadTool, declareTool, type FunctionDeclaration } from "@/lib/voice/function-tool";

export interface ImportPromptContext {
  status: string | null;
  hasDraft: boolean;
  sourceUrl: string | null;
}

export function buildImportSystemInstruction(context: ImportPromptContext): string {
  const statusLabel: Record<string, string> = {
    queued: "na fila de processamento",
    processing: "processando o vídeo",
    source_content_required: "aguardando uma transcrição autorizada",
    review_required: "rascunho pronto para revisão",
    completed: "concluída",
    failed: "falhou",
    cancelled: "cancelada",
  };
  const state = context.status ? (statusLabel[context.status] ?? context.status) : "nenhuma importação em andamento";
  const reviewReady = context.hasDraft && context.status === "review_required";

  return [
    "Você é o assistente de voz do Recistep na tela de importação.",
    "Fale em português do Brasil, de forma curta e natural.",
    "Ajude a importar receitas de links do YouTube, TikTok ou Instagram, de arquivos ou de uma transcrição ditada pelo usuário.",
    `Estado atual: ${state}${context.sourceUrl ? ` (${context.sourceUrl})` : ""}.`,
    reviewReady
      ? "Há um rascunho pronto: use openReview para abrir a revisão e depois ajude a corrigir os campos."
      : "Sem rascunho pronto: ofereça iniciar uma importação por link (startImportByUrl) ou por transcrição ditada (startImportFromTranscript), ou consultar o estado com getImportStatus.",
    "Nunca invente dados de uma receita que ainda não foi importada.",
  ].join("\n");
}

// Ferramentas de voz para a tela de importação: iniciar por link, ditar uma
// receita, tentar de novo, revisar o rascunho e fechar a importação atual.

type SetActionLabel = (label: string | null) => void;

export type ToolOutput = Record<string, unknown> | { success: false; error: string };

export interface ImportVoiceState {
  activeImportId: string | null;
  status: string | null;
  sourceUrl: string | null;
  hasDraft: boolean;
}

export interface ImportVoiceResult {
  ok: boolean;
  message: string;
}

export interface ImportVoiceActions {
  startImportByUrl(url: string): Promise<ImportVoiceResult>;
  startImportFromTranscript(text: string): Promise<ImportVoiceResult>;
  retryImport(): Promise<ImportVoiceResult>;
  dismissImport(): void;
  openReview(): void;
}

export interface ImportVoiceBridge {
  state: ImportVoiceState;
  actions: ImportVoiceActions;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "na fila de processamento",
  processing: "processando",
  source_content_required: "aguardando transcrição autorizada",
  review_required: "rascunho pronto para revisão",
  completed: "concluída",
  failed: "falhou",
  cancelled: "cancelada",
};

function fail(error: string): ToolOutput {
  return { success: false, error };
}

function statusLabel(status: string | null): string {
  if (!status) return "nenhuma importação em andamento";
  return STATUS_LABEL[status] ?? status;
}

export const IMPORT_TOOLS: FunctionDeclaration[] = [
  declareReadTool({
    name: "getImportStatus",
    description: "Diz se há uma importação em andamento e em que etapa ela está.",
  }),
  declareTool({
    name: "startImportByUrl",
    description: "Inicia a importação de uma receita a partir de um link do YouTube, TikTok ou Instagram. Use quando o usuário ditar um link.",
    properties: { url: { type: "STRING", description: "O link completo da receita." } },
    required: ["url"],
  }),
  declareTool({
    name: "startImportFromTranscript",
    description:
      "Usa uma transcrição ditada pelo usuário para montar uma receita. Passe em text exatamente o que o usuário ditou, sem inventar.",
    properties: { text: { type: "STRING", description: "A transcrição ditada da receita." } },
    required: ["text"],
  }),
  declareTool({
    name: "retryImport",
    description: "Tenta importar de novo o último link informado. Use quando a importação falhou.",
  }),
  declareReadTool({
    name: "openReview",
    description: "Abre o rascunho da importação atual para revisão. Só funciona quando o rascunho está pronto.",
  }),
  declareReadTool({
    name: "dismissImport",
    description: "Fecha a importação atual na tela. Não interrompe o processamento no servidor; apenas limpa a tela.",
  }),
];

export async function executeImportTool(
  bridge: ImportVoiceBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): Promise<ToolOutput> {
  switch (name) {
    case "getImportStatus": {
      setActionLabel("Checando a importação");
      return {
        success: true,
        active_import_id: bridge.state.activeImportId,
        status: bridge.state.status,
        status_label: statusLabel(bridge.state.status),
        review_available: bridge.state.hasDraft && bridge.state.status === "review_required",
        source_url: bridge.state.sourceUrl,
      };
    }

    case "startImportByUrl": {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!url) return fail("Diga o link da receita.");
      const validation = validateSourceUrl(url);
      if (!validation.ok) return fail(validation.message);
      setActionLabel("Iniciando a importação");
      const result = await bridge.actions.startImportByUrl(validation.url.toString());
      return result.ok ? { success: true, platform: validation.platform, message: result.message } : fail(result.message);
    }

    case "startImportFromTranscript": {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (text.length < 20) return fail("A transcrição está muito curta. Peça ao usuário para ditar a receita completa.");
      setActionLabel("Montando a receita da transcrição");
      const result = await bridge.actions.startImportFromTranscript(text);
      return result.ok ? { success: true, message: result.message } : fail(result.message);
    }

    case "retryImport": {
      if (!bridge.state.sourceUrl) return fail("Não há um link anterior para tentar de novo. Peça o link ao usuário.");
      setActionLabel("Tentando importar de novo");
      const result = await bridge.actions.retryImport();
      return result.ok ? { success: true, message: result.message } : fail(result.message);
    }

    case "openReview": {
      if (!bridge.state.hasDraft || bridge.state.status !== "review_required") {
        return fail("Ainda não há rascunho para revisar. Consulte getImportStatus.");
      }
      bridge.actions.openReview();
      setActionLabel("Abrindo a revisão");
      return { success: true, opened: true, message: "Abrindo o rascunho para revisão; as ferramentas de edição ficam disponíveis." };
    }

    case "dismissImport": {
      bridge.actions.dismissImport();
      setActionLabel("Fechando a importação");
      return { success: true, dismissed: true, message: "Importação fechada na tela." };
    }

    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}
