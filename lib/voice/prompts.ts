import type { RecipeExtraction } from "@/lib/schemas/recipe";
import { formatVideoClock } from "@/lib/recipe/video-player";
import { quantityLabel, type KitchenIngredient, type KitchenStep } from "@/lib/voice/recipe-tools";

// O prompt fixa a persona e as regras; o conteúdo da receita entra junto quando
// cabe no orçamento, para a voz responder sem precisar de uma chamada de
// ferramenta a cada pergunta.

const RECIPE_CONTEXT_BUDGET = 14_000;

const COOKING_RULES = [
  "Regras importantes:",
  "- Nunca invente quantidades, unidades, temperaturas, porções ou tempos. Se algo não estiver informado, diga 'não informado'.",
  "- Não avance para a próxima etapa antes de o usuário confirmar que terminou a atual.",
  "- Antes de afirmar qualquer número da receita, confira com uma ferramenta de leitura.",
  "- Quando pedirem organização antes de cozinhar, use getMiseEnPlace; reporte apenas notas de preparo que estejam registradas, sem inventar cortes, descongelamento ou outras tarefas.",
  "- Quando pedirem lista de compras, use getShoppingList e preserve quantidades/unidades originais. Diga claramente quais quantidades não foram informadas; não estime.",
  "- Quando pedirem para revisar a receita, use reviewRecipe e apresente os problemas estruturais encontrados. Isso não é uma validação de segurança alimentar ou de alergênicos.",
  "- As ferramentas são executadas em segundo plano (NON_BLOCKING). Continue conversando naturalmente enquanto uma ferramenta trabalha; não fique em silêncio aguardando. Só confirme o resultado depois de receber a resposta da ferramenta.",
  "- Fale em português do Brasil, de forma natural e curta: é conversa falada, não texto impresso.",
  "- Temporizadores são relógios reais controlados pelo aplicativo. Ao iniciar um, confirme apenas que foi iniciado e informe a duração retornada pela ferramenta. Nunca diga que terminou imediatamente após iniciá-lo.",
  "- Vários temporizadores podem rodar ao mesmo tempo. Use getTimerStatus para listar todos; pauseOrResumeTimer e resetTimer aceitam timer_id. Sem timer_id, atuam apenas no temporizador selecionado. Nunca afirme que pausar um timer pausa os demais.",
  "- Para verificar se um temporizador terminou, consulte getTimerStatus ou aguarde o aviso explícito do aplicativo. Só anuncie que terminou quando o estado retornado indicar finished=true ou o aplicativo enviar o evento de término.",
  "- Não deduza a passagem do tempo pela duração da chamada de ferramenta, pela resposta da API ou pelo tempo de conversa.",
  "- Use getVideoStatus antes de prometer controle de vídeo: com controllable=true, controle por voz (playVideo, pauseVideo, toggleVideo, seekVideoToStep, replayVideoStep, nextVideoStep, previousVideoStep, seekVideoBy, replayLastSeconds, setVideoPlaybackRate); com controllable=false, explique que os controles ficam na tela.",
  "- Ao conduzir uma etapa com tempo de vídeo marcado, posicione o vídeo com seekVideoToStep/replayVideoStep; use apenas os tempos retornados pelas ferramentas e nunca invente posições."
].join("\n");

const EDITING_RULES = [
  "Regras importantes:",
  "- Nunca invente ingredientes, quantidades, unidades, temperaturas, porções ou tempos: pergunte ao usuário e use somente o que ele disser.",
  "- Antes de alterar algo, confira o rascunho com getRecipeDraft ou com as ferramentas de listagem.",
  "- Aplique uma alteração por vez e confirme em uma frase curta o que foi alterado.",
  "- As respostas das ferramentas chegam de forma assíncrona: só afirme que uma ação funcionou depois de receber a resposta e ler o campo success.",
  "- Quando o usuário pedir para salvar ou confirmar, use confirmRecipe e lembre-o de tocar em 'Confirmar receita' na tela; você não confirma sozinho.",
  "- Fale em português do Brasil, de forma natural e curta.",
].join("\n");

export interface KitchenPromptContext {
  title: string;
  description: string | null;
  servings: number | null;
  ingredients: KitchenIngredient[];
  steps: KitchenStep[];
}

function formatIngredient(ingredient: KitchenIngredient): string {
  const notes = ingredient.notes ? ` (${ingredient.notes})` : "";
  return `- ${ingredient.name}: ${quantityLabel(ingredient)}${notes}`;
}

function formatStep(step: KitchenStep, index: number): string {
  const details: string[] = [];
  if (step.duration_seconds !== null) details.push(`${Math.round(step.duration_seconds / 60)} min`);
  if (step.temperature_value !== null) details.push(`${step.temperature_value}°${step.temperature_unit ?? "C"}`);
  if (step.video_start_seconds != null) details.push(`vídeo em ${formatVideoClock(step.video_start_seconds)}`);
  const suffix = details.length > 0 ? ` [${details.join(", ")}]` : "";
  return `${index + 1}. ${step.instruction}${suffix}`;
}

export function buildKitchenSystemInstruction(context: KitchenPromptContext): string {
  const header = [
    "Você é o assistente de voz do Recistep, um aplicativo que organiza receitas e acompanha o preparo na cozinha.",
    "Sua função é ler a receita em voz alta, conduzir o usuário etapa por vez, conferir ingredientes e cuidar dos temporizadores.",
    "",
    COOKING_RULES,
  ].join("\n");

  const orderedSteps = [...context.steps].sort((a, b) => a.position - b.position);
  const ingredientLines = context.ingredients.map(formatIngredient).join("\n");
  const stepLines = orderedSteps.map((step, index) => formatStep(step, index)).join("\n");

  const recipeBlock = [
    `Receita: ${context.title}`,
    context.description ? `Descrição: ${context.description}` : "",
    context.servings ? `Porções: ${context.servings}` : "Porções: não informadas",
    "",
    "Ingredientes:",
    ingredientLines,
    "",
    "Etapas do preparo:",
    stepLines,
  ]
    .filter(Boolean)
    .join("\n");

  if (recipeBlock.length <= RECIPE_CONTEXT_BUDGET) {
    return `${header}\n\n${recipeBlock}\n\nUse as ferramentas quando o usuário pedir para repetir, conferir ou alterar o andamento do preparo.`;
  }

  return [
    header,
    "",
    `Receita: ${context.title}`,
    context.servings ? `Porções: ${context.servings}` : "Porções: não informadas",
    `A receita tem ${context.ingredients.length} ingredientes e ${orderedSteps.length} etapas, além do que está largo para caber neste aviso.`,
    "Use getRecipeOverview, listIngredients, listSteps e getStep para ler o conteúdo real.",
  ].join("\n");
}

export function buildReviewSystemInstruction(draft: RecipeExtraction): string {
  const header = [
    "Você é o assistente de revisão do Recistep.",
    "Você ajuda o usuário a conferir e corrigir o rascunho de uma receita extraída de um vídeo: nome, descrição, porções, ingredientes, quantidades e etapas.",
    "",
    EDITING_RULES,
  ].join("\n");

  const ingredientLines = draft.ingredients
    .slice(0, 80)
    .map((ingredient, index) => `${index}. ${ingredient.name}: ${quantityLabel(ingredient)}`)
    .join("\n");
  const stepLines = draft.steps
    .slice()
    .sort((a, b) => a.position - b.position)
    .slice(0, 60)
    .map((step, index) => `${index}. ${step.instruction.slice(0, 200)}`)
    .join("\n");

  const draftBlock = [
    `Rascunho atual: ${draft.title}`,
    draft.description ? `Descrição: ${draft.description.slice(0, 400)}` : "Descrição: não informada",
    `Porções: ${draft.servings ?? "não informadas"}`,
    `Ingredientes (${draft.ingredients.length}):`,
    ingredientLines,
    `Etapas (${draft.steps.length}):`,
    stepLines,
    draft.uncertainties.length > 0 ? `Incertezas apontadas pela extração: ${draft.uncertainties.join(" · ")}` : "",
    draft.warnings.length > 0 ? `Avisos: ${draft.warnings.join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (draftBlock.length <= RECIPE_CONTEXT_BUDGET) {
    return `${header}\n\n${draftBlock}\n\nEste rascunho ainda não está confirmado; as alterações só são salvas quando o usuário tocar em 'Confirmar receita'.`;
  }

  return [
    header,
    "",
    `Rascunho atual: ${draft.title}`,
    `A receita tem ${draft.ingredients.length} ingredientes e ${draft.steps.length} etapas, além do que cabe neste aviso.`,
    "Use getRecipeDraft, listDraftIngredients e listDraftSteps para ler o conteúdo real.",
    "Este rascunho ainda não está confirmado; as alterações só são salvas quando o usuário tocar em 'Confirmar receita'.",
  ].join("\n");
}
