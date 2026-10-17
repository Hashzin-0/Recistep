import type { IngredientExtraction, PreparationStepExtraction, RecipeExtraction } from "@/lib/schemas/recipe";

export function emptyIngredient(): IngredientExtraction {
  return {
    name: "",
    section: "Ingredientes",
    quantity: null,
    quantity_text: null,
    quantity_min: null,
    quantity_max: null,
    unit: null,
    unit_normalized: null,
    notes: null,
    source_evidence: null,
    confidence: 1,
  };
}

export function emptyStep(position: number): PreparationStepExtraction {
  return {
    position,
    instruction: "",
    duration_seconds: null,
    duration_text: null,
    duration_min_seconds: null,
    duration_max_seconds: null,
    temperature_value: null,
    temperature_unit: null,
    source_evidence: null,
    confidence: 1,
  };
}

export function createEmptyRecipe(): RecipeExtraction {
  return {
    title: "",
    description: null,
    source_language: null,
    servings: null,
    timings: { prep_seconds: null, cook_seconds: null, total_seconds: null },
    ingredients: [emptyIngredient()],
    steps: [emptyStep(0)],
    uncertainties: [],
    warnings: [],
  };
}


export type DbRecipeRow = {
  id: string;
  user_id: string;
  source_import_id: string | null;
  title: string;
  description: string | null;
  cover_image_url?: string | null;
  preparation_flowchart_url?: string | null;
  source_url: string | null;
  cover_image_url?: string | null;
  preparation_flowchart_url?: string | null;
  source_language: string | null;
  servings: number | null;
  prep_seconds: number | null;
  cook_seconds: number | null;
  total_seconds: number | null;
  uncertainties: unknown;
  warnings: unknown;
  is_confirmed: boolean;
  created_at: string;
  updated_at: string;
};

export type DbIngredientRow = {
  id: string;
  name: string;
  quantity: number | null;
  quantity_text: string | null;
  quantity_min: number | null;
  quantity_max: number | null;
  unit: string | null;
  unit_normalized: string | null;
  notes: string | null;
  source_evidence: string | null;
  confidence: number;
  position: number;
  section?: string;
};

export type DbStepRow = {
  id: string;
  position: number;
  instruction: string;
  duration_seconds: number | null;
  duration_text: string | null;
  duration_min_seconds: number | null;
  duration_max_seconds: number | null;
  temperature_value: number | null;
  temperature_unit: "C" | "F" | null;
  source_evidence: string | null;
  confidence: number;
};

export type RecipeSummary = {
  id: string;
  title: string;
  description: string | null;
  servings: number | null;
  prep_seconds: number | null;
  cook_seconds: number | null;
  total_seconds: number | null;
  ingredients_count: number;
  steps_count: number;
  cover_image_url?: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
};

export type RecipeDetail = {
  recipe: DbRecipeRow;
  ingredients: DbIngredientRow[];
  steps: DbStepRow[];
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function draftFromDbRecipe(recipe: DbRecipeRow, ingredients: DbIngredientRow[], steps: DbStepRow[]): RecipeExtraction {
  const orderedIngredients: IngredientExtraction[] = [...ingredients]
    .sort((a, b) => a.position - b.position)
    .map((ingredient) => ({
      name: ingredient.name,
      section: ingredient.section ?? "Ingredientes",
      quantity: ingredient.quantity,
      quantity_text: ingredient.quantity_text,
      quantity_min: ingredient.quantity_min,
      quantity_max: ingredient.quantity_max,
      unit: ingredient.unit,
      unit_normalized: ingredient.unit_normalized,
      notes: ingredient.notes,
      source_evidence: ingredient.source_evidence,
      confidence: ingredient.confidence,
    }));

  const orderedSteps: PreparationStepExtraction[] = [...steps]
    .sort((a, b) => a.position - b.position)
    .map((step) => ({
      position: step.position,
      instruction: step.instruction,
      duration_seconds: step.duration_seconds,
      duration_text: step.duration_text,
      duration_min_seconds: step.duration_min_seconds,
      duration_max_seconds: step.duration_max_seconds,
      temperature_value: step.temperature_value,
      temperature_unit: step.temperature_unit,
      source_evidence: step.source_evidence,
      confidence: step.confidence,
    }));

  return {
    title: recipe.title,
    description: recipe.description,
    source_language: recipe.source_language,
    servings: recipe.servings,
    timings: {
      prep_seconds: recipe.prep_seconds,
      cook_seconds: recipe.cook_seconds,
      total_seconds: recipe.total_seconds,
    },
    ingredients: orderedIngredients,
    steps: orderedSteps,
    uncertainties: stringArray(recipe.uncertainties),
    warnings: stringArray(recipe.warnings),
  };
}

export type RecipeApiData = {
  id: string;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  cover_image_url: string | null;
  preparation_flowchart_url: string | null;
  recipe: RecipeExtraction;
};

export function recipeApiData(detail: RecipeDetail): RecipeApiData {
  return {
    id: detail.recipe.id,
    source_url: detail.recipe.source_url,
    created_at: detail.recipe.created_at,
    updated_at: detail.recipe.updated_at,
    cover_image_url: detail.recipe.cover_image_url ?? null,
    preparation_flowchart_url: detail.recipe.preparation_flowchart_url ?? null,
    recipe: draftFromDbRecipe(detail.recipe, detail.ingredients, detail.steps),
  };
}

export function recipeSummary(recipe: DbRecipeRow, ingredientsCount: number, stepsCount: number): RecipeSummary {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    prep_seconds: recipe.prep_seconds,
    cook_seconds: recipe.cook_seconds,
    total_seconds: recipe.total_seconds,
    ingredients_count: ingredientsCount,
    steps_count: stepsCount,
    source_url: recipe.source_url,
    cover_image_url: recipe.cover_image_url ?? null,
    created_at: recipe.created_at,
    updated_at: recipe.updated_at,
  };
}
