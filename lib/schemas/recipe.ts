import { z } from "zod";

const nullableText = z.string().trim().max(2_000).nullable();
const confidenceSchema = z.number().min(0).max(1);

// Ingredientes: qualquer forma de medida é preservada. quantity é o valor
// representativo mais provável; quantity_text guarda o texto literal; min/max
// representam intervalos ("2 a 3 colheres"); unit é a unidade original e
// unit_normalized a forma canônica quando conhecida. Valores desconhecidos
// permanecem null: nunca inventamos quantidade.
export const ingredientExtractionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  section: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().positive().finite().nullable().default(null),
  quantity_text: z.string().trim().max(120).nullish(),
  quantity_min: z.number().positive().finite().nullish(),
  quantity_max: z.number().positive().finite().nullish(),
  unit: z.string().trim().max(80).nullable(),
  unit_normalized: z.string().trim().max(80).nullish(),
  notes: nullableText,
  source_evidence: z.string().trim().max(1_000).nullable(),
  confidence: confidenceSchema,
}).strict().superRefine((ingredient, context) => {
  if (
    ingredient.quantity_min != null &&
    ingredient.quantity_max != null &&
    ingredient.quantity_min > ingredient.quantity_max
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["quantity_min"],
      message: "O limite inferior da quantidade não pode ser maior que o superior.",
    });
  }
});

// Etapas: duration_seconds é o valor representativo; duration_text preserva o
// texto literal ("10 a 15 minutos"); min/max cobrem o intervalo. Quando a fonte
// não informa tempo, todos permanecem null.
export const preparationStepExtractionSchema = z.object({
  position: z.number().int().min(0).max(200),
  instruction: z.string().trim().min(1).max(4_000),
  duration_seconds: z.number().int().min(0).max(86_400).nullable(),
  duration_text: z.string().trim().max(120).nullish(),
  duration_min_seconds: z.number().int().min(0).max(86_400).nullish(),
  duration_max_seconds: z.number().int().min(0).max(86_400).nullish(),
  temperature_value: z.number().finite().nullable(),
  temperature_unit: z.enum(["C", "F"]).nullable(),
  source_evidence: z.string().trim().max(1_000).nullable(),
  confidence: confidenceSchema,
}).strict().superRefine((step, context) => {
  if (
    step.duration_min_seconds != null &&
    step.duration_max_seconds != null &&
    step.duration_min_seconds > step.duration_max_seconds
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["duration_min_seconds"],
      message: "A duração mínima não pode ser maior que a máxima.",
    });
  }
});

export const recipeExtractionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullable(),
  source_language: z.string().trim().min(2).max(35).nullable(),
  servings: z.number().positive().max(500).nullable(),
  timings: z.object({
    prep_seconds: z.number().int().min(0).max(604_800).nullable(),
    cook_seconds: z.number().int().min(0).max(604_800).nullable(),
    total_seconds: z.number().int().min(0).max(604_800).nullable(),
  }).strict(),
  ingredients: z.array(ingredientExtractionSchema).min(1).max(200),
  steps: z.array(preparationStepExtractionSchema).min(1).max(200),
  uncertainties: z.array(z.string().trim().min(1).max(500)).max(100),
  warnings: z.array(z.string().trim().min(1).max(500)).max(100),
}).strict().superRefine((recipe, context) => {
  const positions = recipe.steps.map((step) => step.position);
  if (new Set(positions).size !== positions.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["steps"],
      message: "Cada etapa precisa ter uma posição única.",
    });
  }

  if (
    recipe.timings.prep_seconds !== null &&
    recipe.timings.cook_seconds !== null &&
    recipe.timings.total_seconds !== null &&
    recipe.timings.total_seconds < Math.max(
      recipe.timings.prep_seconds,
      recipe.timings.cook_seconds,
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["timings", "total_seconds"],
      message: "O tempo total não pode ser menor que o tempo de preparo ou cocção.",
    });
  }
});

export type RecipeExtraction = z.infer<typeof recipeExtractionSchema>;
export type IngredientExtraction = z.infer<typeof ingredientExtractionSchema>;
export type PreparationStepExtraction = z.infer<typeof preparationStepExtractionSchema>;
