import type { RecipeExtraction } from "@/lib/schemas/recipe";
import { declareTool, defineToolGroup, type FunctionDeclaration } from "@/lib/voice/function-tool";
import { executeRecipeEditTool } from "@/lib/voice/recipe-tools";

// Ferramentas de voz para criar e editar receita manualmente. A edição usa as
// mesmas regras determinísticas do fluxo de importação (executeRecipeEditTool);
// o que muda é a condução: salvar ou cancelar só quando o usuário pedir.

type SetActionLabel = (label: string | null) => void;

export type ToolOutput = Record<string, unknown> | { success: false; error: string };

export interface ManualRecipeVoiceActions {
  commit(draft: RecipeExtraction): void;
  save(): Promise<void>;
  cancel(): void;
}

export interface ManualRecipeVoiceBridge {
  draft: RecipeExtraction;
  actions: ManualRecipeVoiceActions;
}

function fail(error: string): ToolOutput {
  return { success: false, error };
}

export const MANUAL_RECIPE_EDIT_TOOLS: FunctionDeclaration[] = [
  declareTool({
    name: "addIngredient",
    description: "Adiciona um ingrediente à receita. Quantidade e unidade são opcionais; não estime valores que o usuário não informou.",
    properties: {
      name: { type: "STRING", description: "Nome do ingrediente (obrigatório)." },
      quantity: { type: "NUMBER", description: "Quantidade numérica, quando conhecida." },
      unit: { type: "STRING", description: "Unidade da quantidade (ex: 'g', 'ml')." },
      notes: { type: "STRING", description: "Observações opcionais." },
    },
    required: ["name"],
  }),
  declareTool({
    name: "addStep",
    description: "Adicione uma etapa ao modo de preparo. Sem after_position, a etapa vai para o fim.",
    properties: {
      instruction: { type: "STRING", description: "Instrução da nova etapa." },
      after_position: { type: "NUMBER", description: "Posição da etapa anterior (0 = antes da primeira). Omitido = fim." },
    },
    required: ["instruction"],
  }),
  declareTool({
    name: "updateTitle",
    description: "Altera o nome da receita.",
    properties: { title: { type: "STRING", description: "Novo nome da receita." } },
    required: ["title"],
  }),
  declareTool({
    name: "setServings",
    description: "Define o número de porções. Use 0 quando o usuário não souber.",
    properties: { servings: { type: "NUMBER", description: "Número de porções." } },
    required: ["servings"],
  }),
  declareTool({
    name: "updateIngredient",
    description: "Edita um ingrediente pelo índice. Só informe os campos que mudaram.",
    properties: {
      index: { type: "NUMBER", description: "Posição do ingrediente (começa em 0)." },
      name: { type: "STRING", description: "Novo nome." },
      quantity: { type: "NUMBER", description: "Nova quantidade." },
      unit: { type: "STRING", description: "Nova unidade." },
    },
    required: ["index"],
  }),
  declareTool({
    name: "updateStep",
    description: "Edita uma etapa pela posição. Só informe os campos que mudaram.",
    properties: {
      position: { type: "NUMBER", description: "Posição da etapa (começa em 0)." },
      instruction: { type: "STRING", description: "Nova instrução." },
    },
    required: ["position"],
  }),
];

export const MANUAL_RECIPE_SAVE_TOOLS: FunctionDeclaration[] = [
  declareTool({
    name: "saveRecipe",
    description: "Salva a receita que está sendo montada. Use somente quando o usuário pedir para salvar.",
  }),
  declareTool({
    name: "cancelEditing",
    description: "Cancela a edição e descarta as alterações não salvas. Pergunte ao usuário antes de usar.",
  }),
];

export const MANUAL_RECIPE_TOOL_GROUPS = [
  defineToolGroup(MANUAL_RECIPE_EDIT_TOOLS),
  defineToolGroup(MANUAL_RECIPE_SAVE_TOOLS),
];

export async function executeManualRecipeEditTool(
  bridge: ManualRecipeVoiceBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): Promise<ToolOutput> {
  if (name === "saveRecipe") {
    setActionLabel("Salvando a receita");
    try {
      await bridge.actions.save();
      return { success: true, message: "Receita salva." };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Não foi possível salvar a receita.");
    }
  }

  if (name === "cancelEditing") {
    setActionLabel("Cancelando a edição");
    bridge.actions.cancel();
    return { success: true, cancelled: true, message: "Edição cancelada; as alterações não salvas foram descartadas." };
  }

  if (["addIngredient", "addStep", "updateTitle", "setServings", "updateIngredient", "updateStep"].includes(name)) {
    return executeRecipeEditTool({ draft: bridge.draft, actions: { commit: bridge.actions.commit } }, name, args, setActionLabel);
  }

  return fail(`Ferramenta desconhecida: ${name}`);
}

function draftBlock(draft: RecipeExtraction): string {
  const ingredientLines = draft.ingredients
    .map((ingredient) => `- ${ingredient.name}: ${ingredient.quantity === null ? "quantidade não informada" : `${ingredient.quantity}${ingredient.unit ? " " + ingredient.unit : ""}`}${ingredient.notes ? ` (${ingredient.notes})` : ""}`)
    .join("\n");
  const stepLines = draft.steps
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((step, index) => `${index + 1}. ${step.instruction}`)
    .join("\n");
  return [
    `Receita atual: ${draft.title || "(sem nome)"}`,
    draft.description ? `Descrição: ${draft.description}` : "",
    `Porções: ${draft.servings ?? "não informadas"}`,
    `Ingredientes (${draft.ingredients.length}):`,
    ingredientLines,
    `Etapas (${draft.steps.length}):`,
    stepLines,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildManualEditSystemInstruction(draft: RecipeExtraction): string {
  const header = [
    "Você é o assistente do Recistep que ajuda a montar uma receita pela conversa.",
    "Conduza o preenchimento em etapas: nome, porções, ingredientes e modo de preparo.",
    "Regras importantes:",
    "- Nunca invente ingredientes, quantidades, unidades, temperaturas ou tempos: pergunte ao usuário e use somente o que ele disser.",
    "- Quando o usuário não souber uma quantidade ou unidade, deixe como não informado e siga em frente; nunca estime.",
    "- Adicione os ingredientes e as etapas com addIngredient e addStep; use updateIngredient e updateStep para corrigir.",
    "- Antes de alterar algo, confira o rascunho com getRecipeDraft, listDraftIngredients ou listDraftSteps.",
    "- Aplique uma alteração por vez e confirme em uma frase curta o que foi alterado.",
    "- Nada é gravado até o usuário pedir para salvar; use saveRecipe somente nesse momento. Para descartar, use cancelEditing após perguntar.",
    "- Fale em português do Brasil, de forma natural e curta.",
  ].join("\n");

  const isEmpty = draft.ingredients.length === 0 && draft.steps.length === 0 && draft.title.trim() === "";
  if (isEmpty) {
    return [
      header,
      "",
      "A receita está praticamente vazia. Pergunte o nome da receita e, para cada ingrediente, a quantidade e a unidade.",
      "Depois monte o modo de preparo com addStep, uma etapa por vez.",
    ].join("\n");
  }

  return `${header}\n\n${draftBlock(draft)}\n\nUse as ferramentas de edição para ajustar os campos e saveRecipe para salvar quando o usuário pedir.`;
}
