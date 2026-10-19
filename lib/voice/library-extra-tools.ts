import { declareTool, type FunctionDeclaration } from "@/lib/voice/function-tool";
import type { LibraryRecipe } from "@/lib/voice/library-tools";

// Ferramentas de voz extras para a tela "Minhas receitas": buscar por
// ingrediente, abrir a edição, duplicar e excluir. A busca roda no servidor
// (índice trigram); as ações destrutivas pedem confirmação antes de executar.

type SetActionLabel = (label: string | null) => void;

export type ToolOutput = Record<string, unknown> | { success: false; error: string };

export interface LibraryExtraVoiceActions {
  searchByIngredient(ingredient: string): Promise<LibraryRecipe[]>;
  openEdit(recipeId: string): void;
  duplicateRecipe(recipeId: string): Promise<{ ok: boolean; message: string }>;
  deleteRecipe(recipeId: string): Promise<{ ok: boolean; message: string }>;
}

export interface LibraryExtraBridge {
  recipes: LibraryRecipe[];
  actions: LibraryExtraVoiceActions;
}

function fail(error: string): ToolOutput {
  return { success: false, error };
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function durationMinutes(seconds: number | null): number | null {
  if (seconds === null) return null;
  return Math.round(seconds / 60);
}

function recipePayload(recipe: LibraryRecipe) {
  const total = recipe.total_seconds ?? recipe.prep_seconds;
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    ingredients_count: recipe.ingredients_count,
    steps_count: recipe.steps_count,
    servings: recipe.servings,
    duration_minutes: durationMinutes(total),
  };
}

function resolveRecipe(bridge: LibraryExtraBridge, args: Record<string, unknown>): LibraryRecipe | null {
  const id = typeof args.recipe_id === "string" ? args.recipe_id.trim() : (typeof args.id === "string" ? args.id.trim() : "");
  if (id) {
    const byId = bridge.recipes.find((recipe) => recipe.id === id);
    if (byId) return byId;
  }
  const query = typeof args.name === "string" ? args.name.trim() : (typeof args.title === "string" ? args.title.trim() : "");
  if (!query) return null;
  const target = normalize(query);
  return bridge.recipes.find((recipe) => normalize(recipe.title) === target)
    ?? bridge.recipes.find((recipe) => normalize(recipe.title).includes(target))
    ?? bridge.recipes.find((recipe) => target.includes(normalize(recipe.title)))
    ?? null;
}

export const LIBRARY_EXTRA_TOOLS: FunctionDeclaration[] = [
  declareTool({
    name: "findRecipesByIngredient",
    description: "Procura receitas salvas que contenham um ingrediente. Use quando o usuário disser algo do tipo 'o que posso fazer com frango'.",
    properties: { ingredient: { type: "STRING", description: "Ingrediente a procurar (ex: 'frango')." } },
    required: ["ingredient"],
  }),
  declareTool({
    name: "openRecipeEdit",
    description: "Abre a tela de edição de uma receita salva. Identifique por recipe_id ou pelo nome (parcial funciona).",
    properties: {
      recipe_id: { type: "STRING", description: "ID da receita." },
      name: { type: "STRING", description: "Nome da receita, completo ou parcial." },
    },
  }),
  declareTool({
    name: "duplicateRecipe",
    description: "Cria uma cópia de uma receita salva para editar sem alterar a original. Identifique por recipe_id ou pelo nome.",
    properties: {
      recipe_id: { type: "STRING", description: "ID da receita." },
      name: { type: "STRING", description: "Nome da receita, completo ou parcial." },
    },
  }),
  declareTool({
    name: "deleteRecipe",
    description: "Exclui uma receita salva. Ação destrutiva: confirme com o usuário antes de executar e exija confirm=true.",
    properties: {
      recipe_id: { type: "STRING", description: "ID da receita." },
      name: { type: "STRING", description: "Nome da receita, completo ou parcial." },
      confirm: { type: "BOOLEAN", description: "true somente depois que o usuário confirmar a exclusão." },
    },
  }),
];

export async function executeLibraryExtraTool(
  bridge: LibraryExtraBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): Promise<ToolOutput> {
  switch (name) {
    case "findRecipesByIngredient": {
      const ingredient = typeof args.ingredient === "string" ? args.ingredient.trim() : "";
      if (!ingredient) return fail("Diga o ingrediente a procurar.");
      setActionLabel(`Procurando receitas com ${ingredient}`);
      const matches = await bridge.actions.searchByIngredient(ingredient);
      if (matches.length === 0) {
        return {
          success: true,
          found: false,
          ingredient,
          recipes: [],
          hint: "Nenhuma receita salva com esse ingrediente. Use listRecipes para ver todas.",
        };
      }
      return { success: true, found: true, ingredient, count: matches.length, recipes: matches.map(recipePayload) };
    }

    case "openRecipeEdit": {
      const recipe = resolveRecipe(bridge, args);
      if (!recipe) return fail("Não encontrei essa receita. Use listRecipes para conferir os nomes disponíveis.");
      bridge.actions.openEdit(recipe.id);
      setActionLabel(`Abrindo a edição de ${recipe.title}`);
      return { success: true, opened: true, recipe: recipePayload(recipe), message: `Abrindo a edição de "${recipe.title}".` };
    }

    case "duplicateRecipe": {
      const recipe = resolveRecipe(bridge, args);
      if (!recipe) return fail("Não encontrei essa receita. Use listRecipes para conferir os nomes disponíveis.");
      setActionLabel(`Duplicando ${recipe.title}`);
      const result = await bridge.actions.duplicateRecipe(recipe.id);
      return result.ok ? { success: true, recipe: recipePayload(recipe), message: result.message } : fail(result.message);
    }

    case "deleteRecipe": {
      const recipe = resolveRecipe(bridge, args);
      if (!recipe) return fail("Não encontrei essa receita. Use listRecipes para conferir os nomes disponíveis.");
      if (args.confirm !== true) {
        return {
          success: true,
          needs_confirmation: true,
          question: `Excluir a receita "${recipe.title}"? Esta ação não pode ser desfeita.`,
        };
      }
      setActionLabel(`Excluindo ${recipe.title}`);
      const result = await bridge.actions.deleteRecipe(recipe.id);
      return result.ok ? { success: true, deleted: true, recipe: recipePayload(recipe), message: result.message } : fail(result.message);
    }

    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}
