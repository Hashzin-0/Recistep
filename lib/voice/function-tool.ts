// Declarações de função usadas pela Gemini Live API no setup da sessão.
// Todos os campos são opcionais porque o Gemini preenche os valores padrão,
// mas `name`, `description` e `parameters` são exigidos para que o modelo
// consiga chamar a ferramenta.

export type FunctionParameterType = "STRING" | "NUMBER" | "BOOLEAN" | "ARRAY" | "OBJECT";

export interface FunctionParameterProperty {
  type: FunctionParameterType;
  description: string;
  enum?: string[];
  items?: { type: FunctionParameterType };
}

export interface FunctionParameters {
  type: "OBJECT";
  properties: Record<string, FunctionParameterProperty>;
  required?: string[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  /** O modelo 3.8 Live exige tools assíncronas (NÃO é opcional para ele). */
  behavior: "NON_BLOCKING";
  parameters: FunctionParameters;
}

export function declareTool(input: {
  name: string;
  description: string;
  properties?: Record<string, FunctionParameterProperty>;
  required?: string[];
}): FunctionDeclaration {
  const parameters: FunctionParameters = {
    type: "OBJECT",
    properties: input.properties ?? {},
    ...(input.required && input.required.length > 0 ? { required: input.required } : {}),
  };
  return { name: input.name, description: input.description, behavior: "NON_BLOCKING", parameters };
}

export function declareReadTool(input: { name: string; description: string }): FunctionDeclaration {
  return declareTool({ name: input.name, description: input.description });
}

export interface FunctionDeclarationGroup {
  functionDeclarations: FunctionDeclaration[];
}

export function defineToolGroup(declarations: FunctionDeclaration[]): FunctionDeclarationGroup {
  return { functionDeclarations: declarations };
}
