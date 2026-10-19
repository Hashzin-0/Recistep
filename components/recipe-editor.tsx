"use client";

import { PortionScaler } from "@/components/recipe-planner";
import { emptyIngredient, emptyStep } from "@/lib/recipe/recipe-draft";
import type { RecipeExtraction, IngredientExtraction, PreparationStepExtraction, UtensilExtraction } from "@/lib/schemas/recipe";

export function RecipeEditor({ value, onChange, idPrefix = "recipe", allowStructureEdit = false }: {
  value: RecipeExtraction;
  onChange: (next: RecipeExtraction) => void;
  idPrefix?: string;
  allowStructureEdit?: boolean;
}) {
  function setIngredient(index: number, patch: Partial<IngredientExtraction>) {
    onChange({
      ...value,
      ingredients: value.ingredients.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }

  function setUtensil(index: number, patch: Partial<UtensilExtraction>) {
    onChange({ ...value, utensils: value.utensils.map((item, i) => i === index ? { ...item, ...patch } : item) });
  }

  function addUtensil() {
    onChange({ ...value, utensils: [...value.utensils, { name: "", purpose: null, quantity: null, source_evidence: null, confidence: 0.7 }] });
  }

  function removeUtensil(index: number) {
    onChange({ ...value, utensils: value.utensils.filter((_, i) => i !== index) });
  }

  function setStep(position: number, patch: Partial<PreparationStepExtraction>) {
    onChange({
      ...value,
      steps: value.steps.map((item) => (item.position === position ? { ...item, ...patch } : item)),
    });
  }

  function addIngredient() {
    onChange({ ...value, ingredients: [...value.ingredients, emptyIngredient()] });
  }

  function removeIngredient(index: number) {
    if (value.ingredients.length <= 1) return;
    onChange({ ...value, ingredients: value.ingredients.filter((_, i) => i !== index) });
  }

  function addStep() {
    const nextPosition = value.steps.length ? Math.max(...value.steps.map((step) => step.position)) + 1 : 0;
    onChange({ ...value, steps: [...value.steps, emptyStep(nextPosition)] });
  }

  function removeStep(position: number) {
    if (value.steps.length <= 1) return;
    onChange({ ...value, steps: value.steps.filter((step) => step.position !== position) });
  }

  const orderedSteps = [...value.steps].sort((a, b) => a.position - b.position);

  return (
    <div className="recipe-editor">
      <label htmlFor={`${idPrefix}-title`}>Nome da receita</label>
      <input
        id={`${idPrefix}-title`}
        value={value.title}
        maxLength={200}
        onChange={(event) => onChange({ ...value, title: event.target.value })}
        required
      />

      <label htmlFor={`${idPrefix}-description`}>Descrição</label>
      <textarea
        id={`${idPrefix}-description`}
        value={value.description ?? ""}
        maxLength={2000}
        rows={2}
        onChange={(event) => onChange({ ...value, description: event.target.value || null })}
      />

      <label htmlFor={`${idPrefix}-servings`}>Porções (se conhecidas)</label>
      <input
        id={`${idPrefix}-servings`}
        type="number"
        min="0.1"
        max="500"
        step="any"
        value={value.servings ?? ""}
        onChange={(event) => onChange({ ...value, servings: event.target.value === "" ? null : Number(event.target.value) })}
      />

      <PortionScaler
        servings={value.servings}
        ingredients={value.ingredients}
        onApply={(servings, ingredients) => onChange({ ...value, servings, ingredients })}
      />

      <div className="editor-section-title">
        <strong>Ingredientes</strong>
        {allowStructureEdit && (
          <button className="auth-secondary-button" type="button" onClick={addIngredient}>Adicionar ingrediente</button>
        )}
      </div>
      <div className="review-list">
        {value.ingredients.map((ingredient, index) => (
          <div className="review-item" key={index}>
            <div className="editor-item-heading">
              <label htmlFor={`${idPrefix}-ingredient-name-${index}`}>Ingrediente {index + 1}</label>
              {allowStructureEdit && value.ingredients.length > 1 && (
                <button className="link-button danger" type="button" onClick={() => removeIngredient(index)}>Remover</button>
              )}
            </div>
            <input
              id={`${idPrefix}-ingredient-name-${index}`}
              value={ingredient.name}
              maxLength={200}
              placeholder="Ex.: farinha de trigo"
              onChange={(event) => setIngredient(index, { name: event.target.value })}
              required
            />
            <div className="review-fields-row">
              <div>
                <label htmlFor={`${idPrefix}-ingredient-quantity-${index}`}>Quantidade</label>
                <input
                  id={`${idPrefix}-ingredient-quantity-${index}`}
                  type="number"
                  min="0.0001"
                  step="any"
                  value={ingredient.quantity ?? ""}
                  onChange={(event) => setIngredient(index, { quantity: event.target.value === "" ? null : Number(event.target.value) })}
                />
              </div>
              <div>
                <label htmlFor={`${idPrefix}-ingredient-unit-${index}`}>Unidade</label>
                <input
                  id={`${idPrefix}-ingredient-unit-${index}`}
                  value={ingredient.unit ?? ""}
                  maxLength={80}
                  placeholder="Ex.: g, ml, xícara"
                  onChange={(event) => setIngredient(index, { unit: event.target.value || null })}
                />
              </div>
            </div>
            {(ingredient.quantity_text || (ingredient.quantity_min != null && ingredient.quantity_max != null) || ingredient.unit_normalized) && (
              <p className="field-hint">
                {ingredient.quantity_text && `Como dito na fonte: ${ingredient.quantity_text}`}
                {ingredient.quantity_min != null && ingredient.quantity_max != null && ` · Faixa: ${ingredient.quantity_min}–${ingredient.quantity_max}`}
                {ingredient.unit_normalized && ` · ${ingredient.unit_normalized}`}
              </p>
            )}
            <label htmlFor={`${idPrefix}-ingredient-notes-${index}`}>Observações</label>
            <input
              id={`${idPrefix}-ingredient-notes-${index}`}
              value={ingredient.notes ?? ""}
              maxLength={2000}
              onChange={(event) => setIngredient(index, { notes: event.target.value || null })}
            />
          </div>
        ))}
      </div>

      <div className="editor-section-title">
        <strong>Utensílios e equipamentos</strong>
        {allowStructureEdit && (
          <button className="auth-secondary-button" type="button" onClick={addUtensil}>Adicionar utensílio</button>
        )}
      </div>
      <p className="field-hint">Utensílios identificados na receita. Revise a lista e remova os que não serão necessários.</p>
      <div className="review-list">
        {(value.utensils ?? []).map((utensil, index) => (
          <div className="review-item" key={index}>
            <div className="editor-item-heading">
              <label htmlFor={`${idPrefix}-utensil-name-${index}`}>Utensílio {index + 1}</label>
              {allowStructureEdit && <button className="link-button danger" type="button" onClick={() => removeUtensil(index)}>Remover</button>}
            </div>
            <input
              id={`${idPrefix}-utensil-name-${index}`}
              value={utensil.name}
              maxLength={160}
              placeholder="Ex.: tigela, fouet, assadeira"
              onChange={(event) => setUtensil(index, { name: event.target.value })}
              required
            />
            <label htmlFor={`${idPrefix}-utensil-purpose-${index}`}>Uso na receita</label>
            <input
              id={`${idPrefix}-utensil-purpose-${index}`}
              value={utensil.purpose ?? ""}
              maxLength={500}
              placeholder="Ex.: misturar os ingredientes secos"
              onChange={(event) => setUtensil(index, { purpose: event.target.value || null })}
            />
            <label htmlFor={`${idPrefix}-utensil-quantity-${index}`}>Quantidade (se conhecida)</label>
            <input
              id={`${idPrefix}-utensil-quantity-${index}`}
              value={utensil.quantity ?? ""}
              maxLength={80}
              placeholder="Ex.: 2 tigelas"
              onChange={(event) => setUtensil(index, { quantity: event.target.value || null })}
            />
          </div>
        ))}
        {(value.utensils ?? []).length === 0 && <p className="field-hint">Nenhum utensílio identificado. Adicione os utensílios necessários manualmente.</p>}
      </div>

      <div className="editor-section-title">
        <strong>Etapas</strong>
        {allowStructureEdit && (
          <button className="auth-secondary-button" type="button" onClick={addStep}>Adicionar etapa</button>
        )}
      </div>
      <div className="review-list">
        {orderedSteps.map((step, index) => (
          <div className="review-item" key={step.position}>
            <div className="editor-item-heading">
              <label htmlFor={`${idPrefix}-step-instruction-${step.position}`}>Etapa {index + 1}</label>
              {allowStructureEdit && value.steps.length > 1 && (
                <button className="link-button danger" type="button" onClick={() => removeStep(step.position)}>Remover</button>
              )}
            </div>
            <textarea
              id={`${idPrefix}-step-instruction-${step.position}`}
              value={step.instruction}
              maxLength={4000}
              rows={3}
              placeholder="Descreva o passo do preparo."
              onChange={(event) => setStep(step.position, { instruction: event.target.value })}
              required
            />
            <label htmlFor={`${idPrefix}-step-duration-${step.position}`}>Duração em segundos (se conhecida)</label>
            <input
              id={`${idPrefix}-step-duration-${step.position}`}
              type="number"
              min="0"
              max="86400"
              step="1"
              value={step.duration_seconds ?? ""}
              onChange={(event) => setStep(step.position, { duration_seconds: event.target.value === "" ? null : Number(event.target.value) })}
            />
            {(step.duration_text || (step.duration_min_seconds != null && step.duration_max_seconds != null)) && (
              <p className="field-hint">
                {step.duration_text && `Como dito na fonte: ${step.duration_text}`}
                {step.duration_min_seconds != null && step.duration_max_seconds != null && ` · Faixa: ${step.duration_min_seconds}–${step.duration_max_seconds} s`}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
