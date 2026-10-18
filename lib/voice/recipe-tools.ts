import { scaleIngredients } from "@/lib/recipe/scale-portions";
import {
  createRunningTimer,
  formatDuration,
  pauseTimer,
  resumeTimer,
  type CookingTimerState,
} from "@/lib/recipe/cooking-session";
import { recipeExtractionSchema, type RecipeExtraction } from "@/lib/schemas/recipe";
import { declareReadTool, declareTool, type FunctionDeclaration } from "@/lib/voice/function-tool";

// Ferramentas da voz: leem e alteram o estado da receita sem passar pela rede.
// As escritas são aplicadas por pontes que o componente React registra, e toda
// edição do rascunho é validada com o mesmo schema Zod usado na revisão.

type SetActionLabel = (label: string | null) => void;

export type ToolOutput = Record<string, unknown> | { success: false; error: string };

const STEP_INSTRUCTION_LIMIT = 400;

export interface KitchenIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

export interface KitchenStep {
  position: number;
  instruction: string;
  duration_seconds: number | null;
  temperature_value: number | null;
  temperature_unit: "C" | "F" | null;
}

export interface KitchenSession {
  completedSteps: number[];
  checkedIngredients: number[];
  currentStep: number;
  timers: CookingTimerState[];
  activeTimerId: string | null;
}

export interface KitchenVoiceActions {
  chooseStep(position: number): void;
  toggleStepComplete(position: number): void;
  toggleIngredient(index: number): void;
  startTimer(stepPosition: number, durationSeconds: number): string;
  pauseOrResumeTimer(nowMs: number, timerId?: string): void;
  resetTimer(timerId?: string): void;
  selectTimer(timerId: string): void;
  setNotice(message: string): void;
}

export interface KitchenVoiceBridge {
  title: string;
  servings: number | null;
  ingredients: KitchenIngredient[];
  steps: KitchenStep[];
  session: KitchenSession;
  timerRemainingSeconds: number | null;
  now: number;
  actions: KitchenVoiceActions;
}

export interface RecipeDraftVoiceBridge {
  draft: RecipeExtraction;
  actions: {
    commit(draft: RecipeExtraction): void;
  };
}

export function quantityLabel(ingredient: KitchenIngredient): string {
  if (ingredient.quantity === null) return "quantidade não informada";
  return `${ingredient.quantity}${ingredient.unit ? " " + ingredient.unit : ""}`;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function intArg(args: Record<string, unknown>, key: string): number | null {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  return value;
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const raw = args[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function fail(error: string): ToolOutput {
  return { success: false, error };
}

function stepNumber(bridge: KitchenVoiceBridge, position: number): number {
  return bridge.steps.findIndex((step) => step.position === position) + 1;
}

function currentStepNumber(bridge: KitchenVoiceBridge): number {
  return stepNumber(bridge, bridge.session.currentStep);
}

function readStep(bridge: KitchenVoiceBridge, number: number): KitchenStep | null {
  const index = number - 1;
  if (!Number.isInteger(index) || index < 0 || index >= bridge.steps.length) return null;
  return bridge.steps[index];
}

function stepPayload(bridge: KitchenVoiceBridge, step: KitchenStep, includeInstruction: boolean) {
  const number = stepNumber(bridge, step.position);
  return {
    step_number: number,
    position: step.position,
    instruction: includeInstruction
      ? step.instruction.slice(0, STEP_INSTRUCTION_LIMIT)
      : step.instruction.slice(0, 80),
    duration_seconds: step.duration_seconds,
    duration_label: step.duration_seconds === null ? null : formatDuration(step.duration_seconds),
    temperature:
      step.temperature_value === null ? null : `${step.temperature_value}°${step.temperature_unit ?? "C"}`,
    completed: bridge.session.completedSteps.includes(step.position),
    current: bridge.session.currentStep === step.position,
  };
}

function timerPayload(bridge: KitchenVoiceBridge, requestedId?: string) {
  const timer = bridge.session.timers.find((candidate) => candidate.id === (requestedId ?? bridge.session.activeTimerId));
  if (!timer) return { active: false as const, active_count: bridge.session.timers.length };
  const remaining = Math.max(0, Math.ceil((timer.endsAt === null
    ? timer.pausedRemainingSeconds ?? timer.durationSeconds
    : (timer.endsAt - bridge.now) / 1000)));
  return {
    active: true as const,
    id: timer.id,
    active_count: bridge.session.timers.length,
    running: timer.endsAt !== null,
    step_number: stepNumber(bridge, timer.stepPosition),
    remaining_seconds: remaining,
    remaining_label: formatDuration(remaining),
    total_label: formatDuration(timer.durationSeconds),
    finished: remaining === 0,
  };
}

function progressPayload(bridge: KitchenVoiceBridge) {
  const completed = bridge.session.completedSteps.length;
  return {
    completed_steps: completed,
    total_steps: bridge.steps.length,
    checked_ingredients: bridge.session.checkedIngredients.length,
    total_ingredients: bridge.ingredients.length,
    current_step_number: currentStepNumber(bridge),
    timers: bridge.session.timers.map((timer) => timerPayload(bridge, timer.id)),
    active_timer: timerPayload(bridge),
  };
}

function ingredientPayload(bridge: KitchenVoiceBridge, index: number) {
  const ingredient = bridge.ingredients[index];
  return {
    index,
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    quantity_label: quantityLabel(ingredient),
    notes: ingredient.notes,
    checked: bridge.session.checkedIngredients.includes(index),
  };
}

function resolveIngredientIndex(bridge: KitchenVoiceBridge, args: Record<string, unknown>): number | null {
  const explicit = intArg(args, "index");
  if (explicit !== null && explicit >= 0 && explicit < bridge.ingredients.length) return explicit;

  const query = stringArg(args, "name") ?? stringArg(args, "query");
  if (!query) return null;
  const target = normalize(query);

  const exact = bridge.ingredients.findIndex((ingredient) => normalize(ingredient.name) === target);
  if (exact !== -1) return exact;

  const partial = bridge.ingredients.findIndex((ingredient) => normalize(ingredient.name).includes(target));
  if (partial !== -1) return partial;

  const partialReverse = bridge.ingredients.findIndex((ingredient) => target.includes(normalize(ingredient.name)));
  return partialReverse !== -1 ? partialReverse : null;
}

/**
 * Calcula a sessão resultante de concluir/reabrir uma etapa. Compartilhada com
 * o modo cozinha para que a tela e a voz não fiquem com regras divergentes.
 */
export function withToggledStep(session: KitchenSession, steps: KitchenStep[], position: number): KitchenSession {
  const completedSteps = session.completedSteps.includes(position)
    ? session.completedSteps.filter((item) => item !== position)
    : [...session.completedSteps, position];
  const next = steps.find((step) => !completedSteps.includes(step.position));
  return { ...session, completedSteps, currentStep: next?.position ?? position };
}

export function withToggledIngredient(session: KitchenSession, index: number): KitchenSession {
  const checkedIngredients = session.checkedIngredients.includes(index)
    ? session.checkedIngredients.filter((item) => item !== index)
    : [...session.checkedIngredients, index];
  return { ...session, checkedIngredients };
}

function currentStepPayload(bridge: KitchenVoiceBridge) {
  const step = bridge.steps.find((candidate) => candidate.position === bridge.session.currentStep);
  return step ? stepPayload(bridge, step, true) : null;
}

// ---------------------------------------------------------------------------
// Cozinha
// ---------------------------------------------------------------------------

export const KITCHEN_TOOLS: FunctionDeclaration[] = [
  declareReadTool({
    name: "getRecipeOverview",
    description:
      "Devolve o título, porções, tempos, quantidade de ingredientes e etapas, a etapa atual e o andamento do preparo. Use primeiro quando o usuário perguntar sobre a receita.",
  }),
  declareReadTool({
    name: "listIngredients",
    description:
      "Lista os ingredientes da receita com quantidade, unidade, observações e se já foram conferidos. Aceita um trecho opcional para filtrar por nome.",
  }),
  declareReadTool({
    name: "getMiseEnPlace",
    description: "Organiza a preparação antes de cozinhar: reúne os ingredientes e destaca apenas preparos explicitamente descritos nas notas dos ingredientes ou nas instruções. Não invente cortes ou pré-preparos.",
  }),
  declareReadTool({
    name: "getShoppingList",
    description: "Gera uma lista de compras desta receita com quantidades e unidades originais, destacando itens sem quantidade informada. Não agrega outras receitas nem estima quantidades.",
  }),
  declareReadTool({
    name: "reviewRecipe",
    description: "Faz uma revisão estrutural da receita atual, apontando porções, quantidades, tempos e temperaturas ausentes, ingredientes com nomes repetidos e etapas vazias. Não declara segurança alimentar nem altera a receita.",
  }),
  declareReadTool({
    name: "listSteps",
    description:
      "Lista as etapas do preparo em ordem, com tempo e temperatura quando existirem. Use start_number (1 = primeira etapa) e count para paginação.",
  }),
  declareReadTool({
    name: "getStep",
    description: "Devolve uma única etapa completa pelo número (1 = primeira etapa).",
  }),
  declareReadTool({
    name: "getProgress",
    description: "Devolve quantas etapas estão concluídas, quantos ingredientes conferidos e o estado do temporizador.",
  }),
  declareReadTool({
    name: "getTimerStatus",
    description: "Lista todos os temporizadores independentes e informa o selecionado, o estado, o tempo restante e a etapa de cada um.",
  }),
  declareTool({
    name: "goToStep",
    description: "Seleciona uma etapa do preparo para ler em detalhe ou para conduzir o usuário.",
    properties: { step_number: { type: "NUMBER", description: "Número da etapa (1 = primeira etapa)." } },
    required: ["step_number"],
  }),
  declareTool({
    name: "nextStep",
    description: "Avança a seleção para a próxima etapa do preparo.",
  }),
  declareTool({
    name: "previousStep",
    description: "Volta a seleção para a etapa anterior do preparo.",
  }),
  declareTool({
    name: "markStepComplete",
    description:
      "Marca uma etapa como concluída e avança automaticamente para a próxima etapa pendente. Use step_number; se omitido, usa a etapa atual.",
    properties: { step_number: { type: "NUMBER", description: "Número da etapa (1 = primeira etapa)." } },
  }),
  declareTool({
    name: "reopenStep",
    description: "Reabre uma etapa já concluída.",
    properties: { step_number: { type: "NUMBER", description: "Número da etapa (1 = primeira etapa)." } },
  }),
  declareTool({
    name: "setIngredientChecked",
    description:
      "Marca ou desmarca um ingrediente como conferido na lista de preparo. Identifique pelo nome (parcial funciona) ou pelo index retornado por listIngredients.",
    properties: {
      name: { type: "STRING", description: "Nome do ingrediente, completo ou parcial (ex: 'farinha')." },
      index: { type: "NUMBER", description: "Posição do ingrediente na lista, quando já conhecida." },
      checked: { type: "BOOLEAN", description: "true para marcar como conferido, false para desmarcar." },
    },
  }),
  declareTool({
    name: "startTimer",
    description:
      "Inicia o temporizador da etapa. Sem tempos, usa a duração da etapa atual; use minutes ou seconds para definir outro tempo.",
    properties: {
      minutes: { type: "NUMBER", description: "Tempo em minutos (ex: 10)." },
      seconds: { type: "NUMBER", description: "Tempo em segundos, quando menor que um minuto." },
      step_number: { type: "NUMBER", description: "Etapa do temporizador; se omitido, usa a etapa atual." },
    },
  }),
  declareTool({
    name: "pauseOrResumeTimer",
    description: "Pausa ou retoma um temporizador específico. Sem timer_id, usa o selecionado; use getTimerStatus para ver todos.",
    properties: { timer_id: { type: "STRING", description: "ID retornado por getTimerStatus, opcional." } },
  }),
  declareTool({
    name: "resetTimer",
    description: "Remove um temporizador específico. Sem timer_id, remove o selecionado.",
    properties: { timer_id: { type: "STRING", description: "ID retornado por getTimerStatus, opcional." } },
  }),
  declareTool({
    name: "stopVoiceGuidance",
    description: "Encerra a sessão de voz: você se despede e o usuário pode desconectar em seguida.",
  }),
];

export function executeKitchenTool(
  bridge: KitchenVoiceBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): ToolOutput {
  const { actions } = bridge;

  switch (name) {
    case "getRecipeOverview": {
      setActionLabel("Resumindo a receita");
      return {
        success: true,
        title: bridge.title,
        servings: bridge.servings,
        ingredient_count: bridge.ingredients.length,
        step_count: bridge.steps.length,
        progress: progressPayload(bridge),
        current_step: currentStepPayload(bridge),
      };
    }

    case "listIngredients": {
      setActionLabel("Lendo ingredientes");
      const query = stringArg(args, "name") ?? stringArg(args, "query");
      const target = query ? normalize(query) : null;
      const indexes = bridge.ingredients
        .map((_, index) => index)
        .filter((index) => (target ? normalize(bridge.ingredients[index].name).includes(target) : true));

      if (target && indexes.length === 0) {
        return {
          success: true,
          found: false,
          query,
          ingredients: [],
          hint: "Nenhum ingrediente com esse nome. Liste tudo com listIngredients sem filtro.",
        };
      }

      return {
        success: true,
        found: target === null,
        ...(target ? { query, match_count: indexes.length } : {}),
        ingredients: indexes.slice(0, 60).map((index) => ingredientPayload(bridge, index)),
      };
    }

    case "getMiseEnPlace": {
      setActionLabel("Organizando a mise en place");
      const missingQuantities = bridge.ingredients
        .map((ingredient, index) => ({ ingredient, index }))
        .filter(({ ingredient }) => ingredient.quantity === null)
        .map(({ ingredient, index }) => ({ index, name: ingredient.name, note: ingredient.notes }));
      const preparationNotes = bridge.ingredients
        .map((ingredient, index) => ({ ingredient, index }))
        .filter(({ ingredient }) => Boolean(ingredient.notes?.trim()))
        .map(({ ingredient, index }) => ({ index, name: ingredient.name, note: ingredient.notes }));
      const firstStep = bridge.steps[0] ?? null;
      return {
        success: true,
        recipe: bridge.title,
        ingredients_to_gather: bridge.ingredients.map((ingredient, index) => ingredientPayload(bridge, index)),
        explicit_preparation_notes: preparationNotes,
        missing_quantities: missingQuantities,
        first_step: firstStep ? stepPayload(bridge, firstStep, true) : null,
        caveat: "A lista só destaca preparos escritos na receita; confirme cortes, descongelamento e mise en place não especificados.",
      };
    }

    case "getShoppingList": {
      setActionLabel("Preparando a lista de compras");
      return {
        success: true,
        recipe: bridge.title,
        servings: bridge.servings,
        item_count: bridge.ingredients.length,
        items: bridge.ingredients.map((ingredient, index) => ({
          index,
          name: ingredient.name,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          quantity_label: quantityLabel(ingredient),
          missing_quantity: ingredient.quantity === null,
          notes: ingredient.notes,
          checked: bridge.session.checkedIngredients.includes(index),
        })),
        caveat: "Quantidades sem informação não foram estimadas. Esta lista cobre apenas esta receita.",
      };
    }

    case "reviewRecipe": {
      setActionLabel("Revisando a receita");
      const normalizedNames = bridge.ingredients.map((ingredient) => normalize(ingredient.name));
      const duplicateNames = [...new Set(normalizedNames.filter((name, index) => normalizedNames.indexOf(name) !== index))];
      const duplicates = duplicateNames.map((name) => ({
        normalized_name: name,
        ingredients: bridge.ingredients
          .map((ingredient, index) => ({ ingredient, index }))
          .filter(({ ingredient }) => normalize(ingredient.name) === name)
          .map(({ ingredient, index }) => ({ index, name: ingredient.name, quantity: ingredient.quantity, unit: ingredient.unit })),
      }));
      const findings = [
        ...(bridge.servings === null ? [{ type: "missing_servings", message: "Número de porções não informado." }] : []),
        ...bridge.ingredients.filter((ingredient) => ingredient.quantity === null).map((ingredient) => ({
          type: "missing_quantity", message: `Quantidade não informada: ${ingredient.name}.`,
        })),
        ...bridge.steps.filter((step) => !step.instruction.trim()).map((step) => ({
          type: "empty_step", message: `Etapa ${stepNumber(bridge, step.position)} sem instrução.`,
        })),
        ...bridge.steps.filter((step) => step.duration_seconds === null).map((step) => ({
          type: "missing_duration", message: `Tempo não informado na etapa ${stepNumber(bridge, step.position)}.`,
        })),
        ...bridge.steps.filter((step) => step.temperature_value === null && /forno|assar|ass(e|a|ar)|temperatura/i.test(step.instruction)).map((step) => ({
          type: "check_temperature", message: `Confira se falta informar temperatura na etapa ${stepNumber(bridge, step.position)}.`,
        })),
      ];
      return {
        success: true,
        recipe: bridge.title,
        servings: bridge.servings,
        ingredient_count: bridge.ingredients.length,
        step_count: bridge.steps.length,
        findings,
        duplicate_ingredients: duplicates,
        disclaimer: "Revisão estrutural baseada somente nos dados registrados. Não valida segurança alimentar, alergênicos, ponto de cocção nem substitui conferência humana.",
      };
    }

    case "listSteps": {
      setActionLabel("Lendo as etapas");
      const start = intArg(args, "start_number") ?? 1;
      const count = clamp(args.count, 1, 30, 10);
      const slice = bridge.steps.slice(start - 1, start - 1 + count);
      return {
        success: true,
        total_steps: bridge.steps.length,
        start_number: start,
        returned: slice.length,
        steps: slice.map((step) => stepPayload(bridge, step, false)),
        hint: "Use getStep para ler o texto completo de uma etapa.",
      };
    }

    case "getStep": {
      const requested = intArg(args, "step_number") ?? currentStepNumber(bridge);
      const step = readStep(bridge, requested);
      if (!step) return fail(`Etapa ${requested} não existe. A receita tem ${bridge.steps.length} etapas.`);
      setActionLabel(`Lendo a etapa ${requested}`);
      return { success: true, step: stepPayload(bridge, step, true) };
    }

    case "getProgress": {
      setActionLabel("Conferindo o preparo");
      return {
        success: true,
        progress: progressPayload(bridge),
        current_step: currentStepPayload(bridge),
      };
    }

    case "getTimerStatus": {
      setActionLabel("Consultando o temporizador");
      return { success: true, timer: timerPayload(bridge) };
    }

    case "goToStep": {
      const requested = intArg(args, "step_number");
      if (requested === null) return fail("Informe o número da etapa.");
      const step = readStep(bridge, requested);
      if (!step) return fail(`Etapa ${requested} não existe. A receita tem ${bridge.steps.length} etapas.`);
      actions.chooseStep(step.position);
      setActionLabel(`Etapa ${requested}`);
      return {
        success: true,
        step: stepPayload(bridge, { ...step }, true),
        message: `Etapa ${requested} selecionada.`,
      };
    }

    case "nextStep":
    case "previousStep": {
      const delta = name === "nextStep" ? 1 : -1;
      const currentIndex = Math.max(0, currentStepNumber(bridge) - 1);
      const targetIndex = Math.min(bridge.steps.length - 1, Math.max(0, currentIndex + delta));
      const step = bridge.steps[targetIndex];
      if (!step) return fail("Não há etapa nessa direção.");
      actions.chooseStep(step.position);
      setActionLabel(`Etapa ${targetIndex + 1}`);
      return { success: true, step: stepPayload(bridge, step, true) };
    }

    case "markStepComplete": {
      const requested = intArg(args, "step_number") ?? currentStepNumber(bridge);
      const step = readStep(bridge, requested);
      if (!step) return fail(`Etapa ${requested} não existe.`);
      const alreadyDone = bridge.session.completedSteps.includes(step.position);
      if (!alreadyDone) actions.toggleStepComplete(step.position);
      setActionLabel(`Etapa ${requested} concluída`);
      const preview = alreadyDone
        ? bridge
        : { ...bridge, session: withToggledStep(bridge.session, bridge.steps, step.position) };
      return {
        success: true,
        step_number: requested,
        progress: progressPayload(preview),
        current_step_number: stepNumber(preview, preview.session.currentStep),
        message: `Etapa ${requested} marcada como concluída.`,
      };
    }

    case "reopenStep": {
      const requested = intArg(args, "step_number") ?? currentStepNumber(bridge);
      const step = readStep(bridge, requested);
      if (!step) return fail(`Etapa ${requested} não existe.`);
      const wasDone = bridge.session.completedSteps.includes(step.position);
      if (wasDone) actions.toggleStepComplete(step.position);
      const preview = wasDone
        ? { ...bridge, session: withToggledStep(bridge.session, bridge.steps, step.position) }
        : bridge;
      return {
        success: true,
        step_number: requested,
        progress: progressPayload(preview),
        message: `Etapa ${requested} reaberta.`,
      };
    }

    case "setIngredientChecked": {
      const index = resolveIngredientIndex(bridge, args);
      if (index === null) return fail("Não encontrei esse ingrediente. Use listIngredients para conferir os nomes.");
      const wanted = args.checked === undefined || args.checked === null ? true : Boolean(args.checked);
      const isChecked = bridge.session.checkedIngredients.includes(index);
      const preview = isChecked === wanted
        ? bridge
        : { ...bridge, session: withToggledIngredient(bridge.session, index) };
      if (isChecked !== wanted) actions.toggleIngredient(index);
      setActionLabel(bridge.ingredients[index].name);
      return {
        success: true,
        ingredient: ingredientPayload(preview, index),
        message: wanted
          ? `${bridge.ingredients[index].name} marcado como conferido.`
          : `${bridge.ingredients[index].name} desmarcado.`,
      };
    }

    case "startTimer": {
      const stepNumberArg = intArg(args, "step_number") ?? currentStepNumber(bridge);
      const step = readStep(bridge, stepNumberArg);
      if (!step) return fail(`Etapa ${stepNumberArg} não existe.`);

      const minutes = args.minutes === undefined || args.minutes === null ? null : Number(args.minutes);
      const seconds = args.seconds === undefined || args.seconds === null ? null : Number(args.seconds);

      let duration: number;
      if (minutes !== null && Number.isFinite(minutes) && minutes > 0) duration = minutes * 60;
      else if (seconds !== null && Number.isFinite(seconds) && seconds > 0) duration = seconds;
      else if (step.duration_seconds !== null && step.duration_seconds > 0) duration = step.duration_seconds;
      else return fail("Essa etapa não tem tempo definido. Diga quantos minutos ou segundos durar.");

      if (duration <= 0 || duration > 604_800) return fail("O tempo deve estar entre 1 segundo e 7 dias.");

      const durationSeconds = Math.ceil(duration);
      const timerId = actions.startTimer(step.position, durationSeconds);
      setActionLabel(`Timer de ${formatDuration(durationSeconds)}`);
      const timer = { ...createRunningTimer(step.position, durationSeconds, bridge.now), id: timerId };
      const preview = {
        ...bridge,
        session: { ...bridge.session, timers: [...bridge.session.timers, timer], activeTimerId: timerId },
      };
      return {
        success: true,
        timer: timerPayload(preview, timerId),
        message: `Temporizador ${bridge.session.timers.length + 1} de ${formatDuration(durationSeconds)} iniciado na etapa ${stepNumberArg}. Outros temporizadores continuam ativos.`,
      };
    }

    case "pauseOrResumeTimer": {
      const requestedId = stringArg(args, "timer_id") ?? bridge.session.activeTimerId;
      const timer = bridge.session.timers.find((candidate) => candidate.id === requestedId);
      if (!timer) return fail("Não encontrei esse temporizador. Use getTimerStatus para listar os IDs disponíveis.");
      const paused = timer.endsAt === null;
      actions.pauseOrResumeTimer(bridge.now, timer.id);
      const nextTimer = paused ? resumeTimer(timer, bridge.now) : pauseTimer(timer, bridge.now);
      const preview = { ...bridge, session: { ...bridge.session, timers: bridge.session.timers.map((item) => item.id === timer.id ? nextTimer : item) } };
      setActionLabel(paused ? "Retomando o timer" : "Pausando o timer");
      return {
        success: true,
        timer: timerPayload(preview, timer.id),
        message: paused ? "Temporizador retomado." : "Temporizador pausado. Os demais continuam como estavam.",
      };
    }

    case "resetTimer": {
      const requestedId = stringArg(args, "timer_id") ?? bridge.session.activeTimerId;
      const timer = bridge.session.timers.find((candidate) => candidate.id === requestedId);
      if (!timer) return fail("Não encontrei esse temporizador para zerar.");
      actions.resetTimer(timer.id);
      const timers = bridge.session.timers.filter((item) => item.id !== timer.id);
      return { success: true, remaining_timers: timers.length, message: "Temporizador removido sem alterar os demais." };
    }

    case "stopVoiceGuidance": {
      actions.setNotice("Encerrando a sessão de voz…");
      return { success: true, message: "Sessão encerrada." };
    }

    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Edição do rascunho
// ---------------------------------------------------------------------------

export const RECIPE_EDIT_TOOLS: FunctionDeclaration[] = [
  declareReadTool({
    name: "getRecipeDraft",
    description: "Devolve o rascunho da receita em edição: título, descrição, porções, ingredientes, etapas, incertezas e avisos.",
  }),
  declareReadTool({
    name: "listDraftIngredients",
    description: "Lista os ingredientes do rascunho com posição, quantidade e unidade, para você localizar o que será editado.",
  }),
  declareReadTool({
    name: "listDraftSteps",
    description: "Lista as etapas do rascunho com posição e instrução resumida.",
  }),
  declareTool({
    name: "updateTitle",
    description: "Altera o nome da receita.",
    properties: { title: { type: "STRING", description: "Novo nome da receita (1 a 200 caracteres)." } },
    required: ["title"],
  }),
  declareTool({
    name: "updateDescription",
    description: "Altera ou limpa a descrição da receita.",
    properties: {
      description: { type: "STRING", description: "Nova descrição. Use uma string vazia para remover." },
      clear: { type: "BOOLEAN", description: "true para apagar a descrição." },
    },
  }),
  declareTool({
    name: "setServings",
    description: "Define o número de porções da receita quando ele não é conhecido ou precisa ser corrigido.",
    properties: { servings: { type: "NUMBER", description: "Número de porções (ex: 4). Use 0 para marcar como desconhecido." } },
    required: ["servings"],
  }),
  declareTool({
    name: "scaleServings",
    description:
      "Recalcula as quantidades dos ingredientes para outro número de porções. Ingredientes sem quantidade permanecem sem quantidade e unidades incompatíveis não são convertidas.",
    properties: { target: { type: "NUMBER", description: "Número desejado de porções (ex: 8)." } },
    required: ["target"],
  }),
  declareTool({
    name: "updateIngredient",
    description: "Edita um ingrediente existente pelo índice (use listDraftIngredients para localizar). Só informe os campos que mudaram.",
    properties: {
      index: { type: "NUMBER", description: "Posição do ingrediente na lista (começa em 0)." },
      name: { type: "STRING", description: "Novo nome do ingrediente." },
      quantity: { type: "NUMBER", description: "Nova quantidade numérica." },
      unit: { type: "STRING", description: "Nova unidade (ex: 'g', 'ml', 'xícara')." },
      notes: { type: "STRING", description: "Novas observações." },
      clear_quantity: { type: "BOOLEAN", description: "true para marcar a quantidade como desconhecida." },
      clear_unit: { type: "BOOLEAN", description: "true para remover a unidade." },
      clear_notes: { type: "BOOLEAN", description: "true para remover as observações." },
    },
    required: ["index"],
  }),
  declareTool({
    name: "addIngredient",
    description: "Adiciona um novo ingrediente ao rascunho.",
    properties: {
      name: { type: "STRING", description: "Nome do ingrediente (obrigatório)." },
      quantity: { type: "NUMBER", description: "Quantidade numérica, quando conhecida." },
      unit: { type: "STRING", description: "Unidade da quantidade (ex: 'g', 'ml')." },
      notes: { type: "STRING", description: "Observações opcionais." },
    },
    required: ["name"],
  }),
  declareTool({
    name: "removeIngredient",
    description: "Remove um ingrediente do rascunho pelo índice.",
    properties: { index: { type: "NUMBER", description: "Posição do ingrediente (começa em 0)." } },
    required: ["index"],
  }),
  declareTool({
    name: "updateStep",
    description: "Edita uma etapa do rascunho pela posição. Só informe os campos que mudaram.",
    properties: {
      position: { type: "NUMBER", description: "Posição da etapa (começa em 0)." },
      instruction: { type: "STRING", description: "Nova instrução da etapa." },
      duration_seconds: { type: "NUMBER", description: "Nova duração em segundos (0 a 86400)." },
      temperature_value: { type: "NUMBER", description: "Nova temperatura numérica." },
      temperature_unit: { type: "STRING", description: "Unidade da temperatura: 'C' ou 'F'." },
      clear_duration: { type: "BOOLEAN", description: "true para marcar a duração como desconhecida." },
      clear_temperature: { type: "BOOLEAN", description: "true para marcar a temperatura como desconhecida." },
    },
    required: ["position"],
  }),
  declareTool({
    name: "addStep",
    description: "Adiciona uma nova etapa ao rascunho. As posições são renumeradas automaticamente.",
    properties: {
      instruction: { type: "STRING", description: "Instrução da nova etapa." },
      after_position: { type: "NUMBER", description: "Posição da etapa anterior (0 = antes da primeira). Se omitido, adiciona no fim." },
      duration_seconds: { type: "NUMBER", description: "Duração em segundos, quando conhecida." },
    },
    required: ["instruction"],
  }),
  declareTool({
    name: "removeStep",
    description: "Remove uma etapa do rascunho pela posição. As posições são renumeradas automaticamente.",
    properties: { position: { type: "NUMBER", description: "Posição da etapa a remover (começa em 0)." } },
    required: ["position"],
  }),
  declareTool({
    name: "confirmRecipe",
    description: "Confirma que o rascunho está pronto. Use somente quando o usuário pedir para salvar ou confirmar a receita.",
  }),
];

type DraftMutation = (draft: RecipeExtraction) => RecipeExtraction;

function applyMutation(draft: RecipeExtraction, mutate: DraftMutation): { ok: boolean; error?: string; draft?: RecipeExtraction } {
  let candidate: RecipeExtraction;
  try {
    candidate = mutate(draft);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Alteração inválida." };
  }

  const parsed = recipeExtractionSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Alteração recusada: ${issue ? `${issue.path.join(".")} — ${issue.message}` : "dados inválidos"}.` };
  }
  return { ok: true, draft: parsed.data };
}

function reindexSteps(steps: RecipeExtraction["steps"]): RecipeExtraction["steps"] {
  return steps.map((step, index) => ({ ...step, position: index }));
}

export function executeRecipeEditTool(
  bridge: RecipeDraftVoiceBridge,
  name: string,
  args: Record<string, unknown>,
  setActionLabel: SetActionLabel,
): ToolOutput {
  const draft = bridge.draft;

  if (name === "getRecipeDraft") {
    setActionLabel("Lendo o rascunho");
    return {
      success: true,
      title: draft.title,
      description: draft.description,
      servings: draft.servings,
      timings: draft.timings,
      ingredient_count: draft.ingredients.length,
      step_count: draft.steps.length,
      ingredients: draft.ingredients.slice(0, 60).map((ingredient, index) => ({
        index,
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        quantity_label: quantityLabel(ingredient),
      })),
      steps: draft.steps.slice(0, 40).map((step) => ({
        position: step.position,
        instruction: step.instruction.slice(0, 300),
        duration_seconds: step.duration_seconds,
        temperature:
          step.temperature_value === null ? null : `${step.temperature_value}°${step.temperature_unit ?? "C"}`,
      })),
      uncertainties: draft.uncertainties,
      warnings: draft.warnings,
    };
  }

  if (name === "listDraftIngredients") {
    setActionLabel("Lendo ingredientes");
    return {
      success: true,
      ingredients: draft.ingredients.map((ingredient, index) => ({
        index,
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        quantity_label: quantityLabel(ingredient),
        notes: ingredient.notes,
      })),
    };
  }

  if (name === "listDraftSteps") {
    setActionLabel("Lendo etapas");
    return {
      success: true,
      steps: draft.steps.map((step) => ({
        position: step.position,
        instruction: step.instruction.slice(0, 300),
        duration_seconds: step.duration_seconds,
      })),
    };
  }

  if (name === "confirmRecipe") {
    setActionLabel("Confirmando a receita");
    return {
      success: true,
      confirmed: true,
      message: "Rascunho pronto para confirmação pelo usuário na tela.",
      hint: "Peça ao usuário que toque em Confirmar receita para salvar.",
    };
  }

  const commit = (mutate: DraftMutation, label: string): ToolOutput => {
    setActionLabel(label);
    const result = applyMutation(draft, mutate);
    if (!result.ok || !result.draft) return fail(result.error ?? "Alteração recusada.");
    bridge.actions.commit(result.draft);
    return { success: true, message: label };
  };

  switch (name) {
    case "updateTitle": {
      const title = stringArg(args, "title");
      if (!title) return fail("Informe o novo nome da receita.");
      return commit((current) => ({ ...current, title }), `Título: ${title}`);
    }

    case "updateDescription": {
      if (args.clear === true) return commit((current) => ({ ...current, description: null }), "Descrição removida");
      const description = stringArg(args, "description");
      if (!description) return fail("Informe a nova descrição ou use clear: true para remover.");
      return commit((current) => ({ ...current, description }), "Descrição atualizada");
    }

    case "setServings": {
      const raw = Number(args.servings);
      if (!Number.isFinite(raw)) return fail("Informe um número de porções.");
      const servings = raw > 0 ? raw : null;
      return commit((current) => ({ ...current, servings }), `Porções: ${servings ?? "desconhecidas"}`);
    }

    case "scaleServings": {
      const target = Number(args.target);
      if (!Number.isFinite(target) || target <= 0) return fail("Informe um número de porções válido.");
      if (!draft.servings) return fail("O rascunho não informa as porções atuais; use setServings antes de recalcular.");
      setActionLabel(`Recalculando para ${target} porções`);
      try {
        const scaled = scaleIngredients(
          draft.ingredients.map(({ name: ingredientName, quantity, unit }) => ({ name: ingredientName, quantity, unit })),
          draft.servings,
          target,
        );
        return commit(
          (current) => ({
            ...current,
            servings: target,
            ingredients: current.ingredients.map((ingredient, index) => ({ ...ingredient, quantity: scaled[index].quantity })),
          }),
          `Porções recalculadas para ${target}`,
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Não foi possível recalcular as porções.");
      }
    }

    case "updateIngredient": {
      const index = intArg(args, "index");
      if (index === null || index < 0 || index >= draft.ingredients.length) {
        return fail(`Ingrediente ${index} não existe. A receita tem ${draft.ingredients.length}.`);
      }
      const name = stringArg(args, "name");
      const quantity = args.quantity === undefined || args.quantity === null ? null : Number(args.quantity);
      const unit = stringArg(args, "unit");
      const notes = stringArg(args, "notes");

      return commit(
        (current) => ({
          ...current,
          ingredients: current.ingredients.map((ingredient, position) => {
            if (position !== index) return ingredient;
            return {
              ...ingredient,
              ...(name ? { name } : {}),
              ...(quantity !== null ? { quantity } : {}),
              ...(args.clear_quantity === true ? { quantity: null } : {}),
              ...(unit ? { unit } : {}),
              ...(args.clear_unit === true ? { unit: null } : {}),
              ...(notes ? { notes } : {}),
              ...(args.clear_notes === true ? { notes: null } : {}),
            };
          }),
        }),
        `Ingrediente ${index} atualizado`,
      );
    }

    case "addIngredient": {
      const ingredientName = stringArg(args, "name");
      if (!ingredientName) return fail("Informe o nome do ingrediente.");
      const quantity = args.quantity === undefined || args.quantity === null ? null : Number(args.quantity);
      const unit = stringArg(args, "unit");
      const notes = stringArg(args, "notes");

      return commit(
        (current) => ({
          ...current,
          ingredients: [
            ...current.ingredients,
            {
              name: ingredientName,
              quantity: quantity !== null && Number.isFinite(quantity) && quantity > 0 ? quantity : null,
              unit,
              notes,
              source_evidence: null,
              confidence: 1,
            },
          ],
        }),
        `${ingredientName} adicionado`,
      );
    }

    case "removeIngredient": {
      const index = intArg(args, "index");
      if (index === null || index < 0 || index >= draft.ingredients.length) {
        return fail(`Ingrediente ${index} não existe.`);
      }
      const removed = draft.ingredients[index].name;
      return commit(
        (current) => ({ ...current, ingredients: current.ingredients.filter((_, position) => position !== index) }),
        `${removed} removido`,
      );
    }

    case "updateStep": {
      const position = intArg(args, "position");
      if (position === null || position < 0 || !draft.steps.some((step) => step.position === position)) {
        return fail(`Etapa ${position} não existe.`);
      }
      const instruction = stringArg(args, "instruction");
      const duration = args.duration_seconds === undefined || args.duration_seconds === null ? null : Number(args.duration_seconds);
      const temperatureValue = args.temperature_value === undefined || args.temperature_value === null ? null : Number(args.temperature_value);
      const temperatureUnitRaw = stringArg(args, "temperature_unit")?.toUpperCase();
      const temperatureUnit = temperatureUnitRaw === "C" || temperatureUnitRaw === "F" ? temperatureUnitRaw : null;

      if (args.temperature_unit !== undefined && args.temperature_unit !== null && args.temperature_unit !== "" && temperatureUnit === null) {
        return fail("A unidade da temperatura deve ser 'C' ou 'F'.");
      }

      return commit(
        (current) => ({
          ...current,
          steps: current.steps.map((step) => {
            if (step.position !== position) return step;
            return {
              ...step,
              ...(instruction ? { instruction } : {}),
              ...(duration !== null && Number.isFinite(duration) ? { duration_seconds: duration } : {}),
              ...(args.clear_duration === true ? { duration_seconds: null } : {}),
              ...(temperatureValue !== null && Number.isFinite(temperatureValue) ? { temperature_value: temperatureValue } : {}),
              ...(temperatureUnit ? { temperature_unit: temperatureUnit } : {}),
              ...(args.clear_temperature === true ? { temperature_value: null, temperature_unit: null } : {}),
            };
          }),
        }),
        `Etapa ${position + 1} atualizada`,
      );
    }

    case "addStep": {
      const instruction = stringArg(args, "instruction");
      if (!instruction) return fail("Informe a instrução da nova etapa.");
      const afterPosition = intArg(args, "after_position");
      const duration = args.duration_seconds === undefined || args.duration_seconds === null ? null : Number(args.duration_seconds);

      return commit(
        (current) => {
          const ordered = [...current.steps].sort((a, b) => a.position - b.position);
          const insertAt =
            afterPosition === null
              ? ordered.length
              : Math.min(Math.max(0, afterPosition + 1), ordered.length);
          const next = [...ordered];
          next.splice(insertAt, 0, {
            position: 0,
            instruction,
            duration_seconds: duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null,
            temperature_value: null,
            temperature_unit: null,
            source_evidence: null,
            confidence: 1,
          });
          return { ...current, steps: reindexSteps(next) };
        },
        "Etapa adicionada",
      );
    }

    case "removeStep": {
      const position = intArg(args, "position");
      if (position === null || !draft.steps.some((step) => step.position === position)) {
        return fail(`Etapa ${position} não existe.`);
      }
      if (draft.steps.length <= 1) return fail("A receita precisa de pelo menos uma etapa.");
      return commit(
        (current) => {
          const ordered = [...current.steps].sort((a, b) => a.position - b.position);
          return { ...current, steps: reindexSteps(ordered.filter((step) => step.position !== position)) };
        },
        `Etapa ${position + 1} removida`,
      );
    }

    default:
      return fail(`Ferramenta desconhecida: ${name}`);
  }
}
