import { describe, expect, it } from "vitest";
import { buildRecipePdf } from "@/lib/recipe/recipe-pdf";
import type { RecipeApiData, DbRecipeRow } from "@/lib/recipe/recipe-draft";
import type { IngredientExtraction, PreparationStepExtraction } from "@/lib/schemas/recipe";

function decodePdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const parts: string[] = [];
  for (const match of raw.matchAll(/<([0-9a-fA-F]+)>/g)) {
    const hex = match[1];
    let value = "";
    for (let i = 0; i < hex.length; i += 2) value += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    parts.push(value);
  }
  return parts.join("\n");
}

function ingredient(name: string, quantity: number | null, unit: string | null, section: string, notes: string | null = null): IngredientExtraction {
  return {
    name,
    section,
    quantity,
    quantity_text: null,
    quantity_min: null,
    quantity_max: null,
    unit,
    unit_normalized: unit,
    notes,
    source_evidence: null,
    confidence: 1,
  };
}

function step(position: number, instruction: string): PreparationStepExtraction {
  return {
    position,
    instruction,
    duration_seconds: null,
    duration_text: null,
    duration_min_seconds: null,
    duration_max_seconds: null,
    temperature_value: null,
    temperature_unit: null,
    video_start_seconds: null,
    video_end_seconds: null,
    source_evidence: null,
    confidence: 1,
  };
}

function makeData(): RecipeApiData {
  const now = new Date().toISOString();
  const recipe: DbRecipeRow = {
    id: "00000000-0000-4000-8000-000000000000",
    user_id: "00000000-0000-4000-8000-000000000001",
    source_import_id: null,
    title: "Bolo de Laranja",
    description: null,
    source_url: "https://example.com/bolo",
    cover_image_url: null,
    source_language: "pt",
    servings: 8,
    prep_seconds: 1200,
    cook_seconds: 3600,
    total_seconds: 3600,
    uncertainties: ["informação incerta"],
    warnings: ["A manteiga utilizada para untar não foi informada."],
    is_confirmed: true,
    created_at: now,
    updated_at: now,
  };
  return {
    id: recipe.id,
    source_url: recipe.source_url,
    created_at: now,
    updated_at: now,
    cover_image_url: null,
    preparation_flowchart_url: null,
    video_display: null,
    recipe: {
      title: "Bolo de Laranja",
      description: null,
      source_language: "pt",
      servings: 8,
      cover_image_url: null,
      utensils: [],
      timings: { prep_seconds: 1200, cook_seconds: 3600, total_seconds: 3600 },
      ingredients: [
        ingredient("ovos", 3, null, "Massa"),
        ingredient("açúcar", 375, "g", "Massa"),
        ingredient("óleo", 120, "ml", "Massa"),
        ingredient("suco de laranja natural", 250, "ml", "Massa"),
        ingredient("farinha de trigo", 240, "g", "Massa", "peneirada"),
        ingredient("fermento químico em pó", 15, "g", "Massa", "bem cheia"),
        ingredient("açúcar de confeiteiro", 180, "g", "Cobertura"),
        ingredient("suco de laranja", null, null, "Cobertura", "o suficiente para dar o ponto"),
        ingredient("raspas de laranja", null, null, "Decoração (Opcional)"),
        ingredient("rodelas de laranja", null, null, "Decoração (Opcional)"),
        ingredient("folhas de hortelã", null, null, "Decoração (Opcional)"),
      ],
      steps: [
        step(0, "Em uma tigela, bata os 3 ovos com $1/2$ xícara de açúcar até que a mistura triplique de tamanho e fique esbranquiçada e cremosa."),
        step(1, "Acrescente 1/2 xícara de óleo e misture. Em seguida, adicione 250 ml de suco de laranja e misture novamente."),
        step(2, "Em outro recipiente, junte as 2 xícaras de farinha de trigo peneirada com o fermento químico em pó. Misture levemente."),
        step(3, "Despeje a mistura líquida sobre os ingredientes secos e misture delicadamente com um fouet, apenas até ficar homogêneo."),
        step(4, "Unte uma forma com furo central com manteiga e polvilhe açúcar por toda a superfície interna."),
        step(5, "Despeje a massa na forma e leve ao forno pré-aquecido a 180$^{\\circ}$C por cerca de 40 minutos, ou até que um palito saia limpo."),
        step(6, "Desenforme o bolo ainda quente."),
        step(7, "Em uma tigela, coloque o açúcar de confeiteiro e adicione o suco de laranja aos poucos, mexendo sempre, até obter uma cobertura cremosa e espessa."),
        step(8, "Despeje a cobertura sobre o bolo e finalize com raspas de laranja. Decore com rodelas de laranja e folhas de hortelã a gosto."),
      ],
      uncertainties: ["informação incerta"],
      warnings: ["A manteiga utilizada para untar não foi informada."],
    },
  };
}

describe("buildRecipePdf", () => {
  it("mantém a receita completa em uma única página", () => {
    const bytes = buildRecipePdf(makeData());
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).toContain("/Count 1");
    expect(raw).not.toContain("/Count 2");
    const text = decodePdfText(bytes);
    expect(text).toContain("Ingredients");
    expect(text).toContain("Instructions");
    expect(text).toContain("Modo de Preparo");
    expect(text).toContain("Generated by Recistep");
  });

  it("remove avisos, incertezas e notação LaTeX", () => {
    const text = decodePdfText(buildRecipePdf(makeData()));
    expect(text).not.toContain("Avisos");
    expect(text).not.toContain("Incertezas");
    expect(text).not.toContain("A manteiga utilizada para untar");
    expect(text).not.toContain("$");
    expect(text).not.toContain("circ");
    expect(text).toContain("1/2 xícara");
    expect(text).toContain("180°C");
  });

  it("preserva observações curtas dos ingredientes", () => {
    const text = decodePdfText(buildRecipePdf(makeData()));
    expect(text).toContain("(peneirada)");
    expect(text).toContain("(bem cheia)");
    expect(text).toContain("(o suficiente para dar o ponto)");
  });
});
