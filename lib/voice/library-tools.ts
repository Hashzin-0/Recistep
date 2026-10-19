import { declareReadTool, declareTool, type FunctionDeclaration } from "@/lib/voice/function-tool";

// Ferramentas de voz para a coleção "Minhas receitas": listar, procurar e abrir
// uma receita (opcionalmente já iniciando o modo cozinha). A navegação é feita
// por uma ponte que a página registra.

type SetActionLabel = (label: string | null) => void;

export type ToolOutput = Record<string, unknown> | { success: false; error: string };

export interface LibraryRecipe {
  id: string;
  title: string;
  description: string | null;
  ingredients_count: number;
  steps_count: number;
  servings: number | null;
  total_seconds: number | null;
  prep_seconds: number | null;
  source_platform?: string | null;
}

export interface LibraryVoiceActions {
  open(recipeId: string, startPrep: boolean): void;
}

export interface LibraryVoiceBridge {
  recipes: LibraryRecipe[];
  actions: LibraryVoiceActions;
}

function fail(error: string): ToolOutput {
  return { success: false, error };
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const raw = args[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function resolveRecipe(bridge: LibraryVoiceBridge, args: Record<string, unknown>): LibraryRecipe | null {
  const id = stringArg(args, "recipe_id") ?? stringArg(args, "id");
  if (id) {
    const byId = bridge.recipes.find((recipe) => recipe.id === id);
    if (byId) return byId;
  }

  const query = stringArg(args, "name") ?? stringArg(args, "title") ?? stringArg(args, "query");
  if (!query) return null;
  const target = normalize(query);

  const exact = bridge.recipes.find((recipe) => normalize(recipe.title) === target);
  if (exact) return exact;

  const partial = bridge.recipes.find((recipe) => normalize(recipe.title).includes(target));
  if (partial) return partial;

  const reverse = bridge.recipes.find((recipe) => target.includes(normalize(recipe.title)));
  return reverse ?? null;
}

export const LIBRARY_TOOLS: FunctionDeclaration[] = [
  declareReadTool({
    name: "listRecipes",
    description:
      "Lista as receitas salvas do usuário, com id, título, quantidade de ingredientes e de etapas, porções e duração. Use antes de abrir uma receita quando não souber o nome exato.",
  }),
  declareTool({
    name: "findRecipes",
    description: "Procura receitas salvas por trecho do nome. Use quando o usuário citar uma receita sem dar o nome exato.",
    properties: { query: { type: "STRING", description: "Trecho do nome da receita (ex: 'bolo')." } },
    required: ["query"],
  }),
  declareTool({
    name: "openRecipe",
    description:
      "Abre uma receita salva. Identifique por recipe_id ou pelo nome (parcial funciona). Use start_prep=true para já iniciar o modo cozinha com etapas e temporizadores.",
    properties: {
      recipe_id: { type: "STRING", description: "ID retornado por listRecipes." },
      name: { type: "STRING", description: "Nome da receita, completo ou parcial." },
      start_prep: { type: "BOOLEAN", description: "true para iniciar o preparo (modo cozinha) ao abrir." },
    },
  }),
];

export function executeLibraryTool(
  bridge: LibraryVoiceBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): ToolOutput {
  switch (name) {
    case "listRecipes": {
      setActionLabel("Lendo suas receitas");
      if (bridge.recipes.length === 0) {
        return {
          success: true,
          count: 0,
          recipes: [],
          hint: "Nenhuma receita salva ainda. Importe um link na aba Receitas ou crie uma manualmente.",
        };
      }
      return { success: true, count: bridge.recipes.length, recipes: bridge.recipes.map(recipePayload) };
    }

    case "findRecipes": {
      const query = stringArg(args, "query") ?? stringArg(args, "name");
      if (!query) return fail("Diga o nome (ou parte) da receita que procura.");
      setActionLabel("Procurando a receita");
      const target = normalize(query);
      const matches = bridge.recipes.filter((recipe) => normalize(recipe.title).includes(target));
      if (matches.length === 0) {
        return {
          success: true,
          found: false,
          query,
          recipes: [],
          hint: "Nenhuma receita com esse nome. Use listRecipes para ver todas.",
        };
      }
      return { success: true, found: true, query, count: matches.length, recipes: matches.map(recipePayload) };
    }

    case "openRecipe": {
      const recipe = resolveRecipe(bridge, args);
      if (!recipe) {
        return fail("Não encontrei essa receita. Use listRecipes para conferir os nomes disponíveis.");
      }
      const startPrep = args.start_prep === true;
      bridge.actions.open(recipe.id, startPrep);
      setActionLabel(startPrep ? `Abrindo ${recipe.title} no preparo` : `Abrindo ${recipe.title}`);
      return {
        success: true,
        opened: true,
        start_prep: startPrep,
        recipe: recipePayload(recipe),
        message: startPrep
          ? `Abrindo "${recipe.title}" e iniciando o preparo.`
          : `Abrindo "${recipe.title}".`,
      };
    }

    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}
