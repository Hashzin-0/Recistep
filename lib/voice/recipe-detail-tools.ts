import { declareReadTool, declareTool, type FunctionDeclaration } from "@/lib/voice/function-tool";

// Ferramentas de voz para a tela de uma receita salva (fora do modo cozinha):
// consultar, avaliar, gerar o fluxograma, criar lista de compras, editar,
// iniciar o preparo e excluir.

type SetActionLabel = (label: string | null) => void;

export type ToolOutput = Record<string, unknown> | { success: false; error: string };

export interface RecipeDetail {
  id: string;
  title: string;
  description: string | null;
  servings: number | null;
  ingredients_count: number;
  steps_count: number;
  total_seconds: number | null;
  rating: number | null;
  rating_count: number;
  has_cover: boolean;
  has_flowchart: boolean;
  source_platform: string | null;
}

export interface RecipeDetailVoiceActions {
  rate(value: number): Promise<void>;
  startFlowchart(): void;
  createShoppingList(): Promise<{ id?: string; title?: string } | void>;
  deleteRecipe(): Promise<void>;
  openEdit(): void;
  startPrep(): void;
}

export interface RecipeDetailVoiceBridge {
  recipe: RecipeDetail;
  actions: RecipeDetailVoiceActions;
}

function fail(error: string): ToolOutput {
  return { success: false, error };
}

function durationLabel(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function recipePayload(recipe: RecipeDetail) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    ingredients_count: recipe.ingredients_count,
    steps_count: recipe.steps_count,
    duration: durationLabel(recipe.total_seconds),
    rating: recipe.rating,
    rating_count: recipe.rating_count,
    has_cover: recipe.has_cover,
    has_flowchart: recipe.has_flowchart,
    source_platform: recipe.source_platform,
  };
}

export const RECIPE_DETAIL_TOOLS: FunctionDeclaration[] = [
  declareReadTool({
    name: "getRecipeDetails",
    description: "Devolve os dados da receita aberta: título, porções, quantidade de ingredientes e etapas, duração, avaliação e se já tem capa e fluxograma.",
  }),
  declareTool({
    name: "rateRecipe",
    description: "Avalia a receita de 1 a 5 estrelas. Só use quando o usuário disser a nota.",
    properties: { rating: { type: "NUMBER", description: "Nota de 1 a 5." } },
    required: ["rating"],
  }),
  declareTool({
    name: "startPrep",
    description: "Inicia o modo cozinha desta receita, com etapas e temporizadores. Use quando o usuário quiser começar a cozinhar.",
  }),
  declareReadTool({
    name: "generateFlowchart",
    description:
      "Gera (ou regenera) o fluxograma do preparo desta receita. A geração acontece em segundo plano: avise o usuário que começou e siga a conversa.",
  }),
  declareTool({
    name: "createShoppingList",
    description: "Cria uma lista de compras com os ingredientes desta receita.",
  }),
  declareReadTool({
    name: "openRecipeEdit",
    description: "Abre a tela de edição desta receita.",
  }),
  declareTool({
    name: "deleteRecipe",
    description: "Exclui esta receita. Operação destrutiva: só execute com confirm=true depois de o usuário confirmar.",
    properties: { confirm: { type: "BOOLEAN", description: "true somente depois que o usuário confirmar a exclusão." } },
  }),
];

export async function executeRecipeDetailTool(
  bridge: RecipeDetailVoiceBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): Promise<ToolOutput> {
  const recipe = bridge.recipe;

  switch (name) {
    case "getRecipeDetails": {
      setActionLabel("Lendo a receita");
      return { success: true, recipe: recipePayload(recipe) };
    }

    case "rateRecipe": {
      const value = Number(args.rating);
      if (!Number.isFinite(value) || value < 1 || value > 5) return fail("A nota deve ser de 1 a 5.");
      setActionLabel("Salvando a avaliação");
      await bridge.actions.rate(Math.round(value));
      return { success: true, rating: Math.round(value), message: `Receita avaliada com ${Math.round(value)} de 5.` };
    }

    case "startPrep": {
      bridge.actions.startPrep();
      setActionLabel("Iniciando o preparo");
      return { success: true, started: true, message: `Iniciando o preparo de "${recipe.title}".` };
    }

    case "generateFlowchart": {
      bridge.actions.startFlowchart();
      setActionLabel("Gerando o fluxograma");
      return {
        success: true,
        started: true,
        message: "O fluxograma está sendo gerado em segundo plano. Avise quando ficar pronto.",
      };
    }

    case "createShoppingList": {
      setActionLabel("Criando a lista de compras");
      const created = await bridge.actions.createShoppingList();
      const title = created && typeof created === "object" && "title" in created ? created.title : null;
      return {
        success: true,
        list: created ?? null,
        message: `Lista de compras ${title ? `"${title}" ` : ""}criada com os ingredientes de "${recipe.title}".`,
      };
    }

    case "openRecipeEdit": {
      bridge.actions.openEdit();
      setActionLabel("Abrindo a edição");
      return { success: true, editing: true, message: `Abrindo "${recipe.title}" para edição.` };
    }

    case "deleteRecipe": {
      if (args.confirm !== true) {
        return {
          success: true,
          needs_confirmation: true,
          question: `Posso excluir a receita "${recipe.title}"? Essa ação não pode ser desfeita.`,
        };
      }
      setActionLabel("Excluindo a receita");
      await bridge.actions.deleteRecipe();
      return { success: true, deleted: true, message: `Receita "${recipe.title}" excluída.` };
    }

    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}

export interface RecipeDetailPromptContext {
  title: string;
  description: string | null;
  servings: number | null;
  ingredients_count: number;
  steps_count: number;
  total_seconds: number | null;
}

export function buildRecipeDetailSystemInstruction(context: RecipeDetailPromptContext): string {
  const duration = context.total_seconds === null
    ? "não informada"
    : (() => {
        const minutes = Math.round(context.total_seconds / 60);
        return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
      })();

  return [
    "Você é o assistente de voz do Recistep na tela de detalhe da receita.",
    "Fale em português do Brasil, de forma curta e natural.",
    "Ajude a consultar a receita aberta, avaliar, iniciar o preparo, gerar o fluxograma, criar lista de compras, editar ou excluir.",
    `Receita atual: ${context.title}`,
    context.description ? `Descrição: ${context.description}` : "",
    `Porções: ${context.servings ?? "não informadas"} · ${context.ingredients_count} ingredientes · ${context.steps_count} etapas · duração ${duration}.`,
    "Para conduzir o preparo, use startPrep; o modo cozinha assume a conversa a partir daí.",
    "Para o fluxograma, use generateFlowchart: ele roda em segundo plano e você avisa quando ficar pronto.",
    "Nunca invente dados que não estejam nos resultados das ferramentas.",
  ]
    .filter(Boolean)
    .join("\n");
}
