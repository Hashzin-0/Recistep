import { z } from "zod";

const nullableText = z.string().trim().max(2_000).nullable();
const confidenceSchema = z.number().min(0).max(1);

export const ingredientExtractionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().finite().nullable(),
  unit: z.string().trim().max(80).nullable(),
  notes: nullableText,
  source_evidence: z.string().trim().max(1_000).nullable(),
  confidence: confidenceSchema,
}).strict();

export const preparationStepExtractionSchema = z.object({
  position: z.number().int().min(0).max(200),
  instruction: z.string().trim().min(1).max(4_000),
  duration_seconds: z.number().int().min(0).max(86_400).nullable(),
  temperature_value: z.number().finite().nullable(),
  temperature_unit: z.enum(["C", "F"]).nullable(),
  source_evidence: z.string().trim().max(1_000).nullable(),
  confidence: confidenceSchema,
}).strict();

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
