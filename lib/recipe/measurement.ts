// Deterministic measurement and time parsers. These never invent values: they
// only convert text that is actually present into structured numbers. When text
// cannot be interpreted the result is null, so callers keep the field unknown.

export type QuantityKind =
  | "integer"
  | "decimal"
  | "fraction"
  | "mixed"
  | "range"
  | "word"
  | "descriptive"
  | "none";

export interface ParsedQuantity {
  min: number | null;
  max: number | null;
  representative: number | null;
  kind: QuantityKind;
  descriptive: boolean;
}

export interface ParsedDuration {
  minSeconds: number | null;
  maxSeconds: number | null;
  representativeSeconds: number | null;
  hadRange: boolean;
}

export type UnitDimension =
  | "mass"
  | "volume"
  | "count"
  | "spoon"
  | "cup"
  | "pinch"
  | "package"
  | "sachet"
  | "slice"
  | "clove"
  | "bunch"
  | "can"
  | "bottle"
  | "glass"
  | "piece"
  | null;

export interface NormalizedUnit {
  canonical: string | null;
  dimension: UnitDimension;
}

const UNICODE_FRACTIONS: Record<string, string> = {
  "¼": "1/4", "½": "1/2", "¾": "3/4",
  "⅓": "1/3", "⅔": "2/3",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5",
  "⅙": "1/6", "⅚": "5/6",
};

const WORD_NUMBERS: Record<string, number> = {
  "meia": 0.5, "meio": 0.5, "meias": 0.5, "meios": 0.5,
  "um": 1, "uma": 1, "uns": 1, "umas": 1,
  "dois": 2, "duas": 2,
  "tres": 3, "três": 3,
  "quatro": 4, "cinco": 5, "seis": 6, "sete": 7,
  "oito": 8, "nove": 9, "dez": 10, "onze": 11,
  "doze": 12, "quinze": 15, "vinte": 20, "trinta": 30,
  "quarenta": 40, "cinquenta": 50, "cem": 100, "cento": 100, "mil": 1000,
};

// Phrases that mark a measurement as subjective / to-taste, never numeric.
const DESCRIPTIVE_MARKERS = [
  "a gosto", "a vontade", "ao gosto", "conforme o gosto", "conforme gosto",
  "q.b.", "qb", "qto baste", "quanto baste", "o quanto baste",
  "a necessidade", "conforme necessário", "conforme necessario",
  "um punhado", "punhado", "uma pitada", "pitada", "um fio", "fio",
  "uma gota", "gotas", "o tanto quanto", "sem medida",
];

function toDecimal(token: string): number | null {
  const normalized = token.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseFraction(token: string): number | null {
  const match = token.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!denominator || !Number.isFinite(numerator)) return null;
  return numerator / denominator;
}

function parseMixed(token: string): number | null {
  const match = token.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = parseFraction(`${match[2]}/${match[3]}`);
  if (fraction === null) return null;
  return whole + fraction;
}

function expandUnicodeFractions(input: string): string {
  return input.replace(/[¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚]/g, (char) => UNICODE_FRACTIONS[char] ?? "");
}

/**
 * Parses a quantity string into structured bounds. Handles decimals, fractions,
 * mixed numbers, unicode fractions, ranges and word numbers. Descriptive phrases
 * ("a gosto", "um punhado") return descriptive=true with null numbers.
 */
export function parseQuantityText(input: string | null | undefined): ParsedQuantity {
  const empty: ParsedQuantity = { min: null, max: null, representative: null, kind: "none", descriptive: false };
  if (!input) return empty;

  const raw = input.trim();
  if (!raw) return empty;

  const lowered = raw.toLocaleLowerCase("pt-BR");

  for (const marker of DESCRIPTIVE_MARKERS) {
    if (lowered === marker || lowered.includes(marker)) {
      return { min: null, max: null, representative: null, kind: "descriptive", descriptive: true };
    }
  }

  const expanded = expandUnicodeFractions(lowered).replace(/\s+/g, " ").trim();
  const leading = expanded.replace(/^(?:entre|de|com)\s+/, "");

  const NUM = String.raw`(?:\d+\s+\d+\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)`;

  // Range on the leading part: "2 a 3", "10-15", "entre 2 e 4".
  const rangeMatch = leading.match(new RegExp(`^(${NUM})\\s*(?:a|à|ate|até|-|–|—|e)\\s*(${NUM})\\b`, "i"));
  if (rangeMatch) {
    const low = quantityTokenToNumber(rangeMatch[1]);
    const high = quantityTokenToNumber(rangeMatch[2]);
    if (low !== null && high !== null && low > 0 && high >= low) {
      return { min: low, max: high, representative: high, kind: "range", descriptive: false };
    }
  }

  // Mixed number: "1 1/2" or "1 ½" (ignoring any trailing unit).
  const mixedMatch = leading.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixedMatch && Number(mixedMatch[3]) !== 0) {
    const value = Number(mixedMatch[1]) + Number(mixedMatch[2]) / Number(mixedMatch[3]);
    if (value > 0) {
      return { min: null, max: null, representative: value, kind: "mixed", descriptive: false };
    }
  }

  // Plain fraction: "1/2", "¾".
  const fractionMatch = leading.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fractionMatch && Number(fractionMatch[2]) !== 0) {
    const value = Number(fractionMatch[1]) / Number(fractionMatch[2]);
    if (value > 0) {
      return { min: null, max: null, representative: value, kind: "fraction", descriptive: false };
    }
  }

  // Decimal / integer: "30", "1,5" (ignoring any trailing unit).
  const decimalMatch = leading.match(/^(\d+(?:[.,]\d+)?)/);
  if (decimalMatch) {
    const value = toDecimal(decimalMatch[1]);
    if (value !== null && value > 0) {
      const kind: QuantityKind = Number.isInteger(value) ? "integer" : "decimal";
      return { min: null, max: null, representative: value, kind, descriptive: false };
    }
  }

  // Word number: "meia", "duas", "uma".
  const wordMatch = leading.match(/^[a-zà-ú]+/);
  if (wordMatch) {
    const word = WORD_NUMBERS[wordMatch[0]];
    if (word !== undefined) {
      return { min: null, max: null, representative: word, kind: "word", descriptive: false };
    }
  }

  return empty;
}

function quantityTokenToNumber(token: string): number | null {
  return toDecimal(token) ?? parseMixed(token) ?? parseFraction(token);
}

const UNIT_TABLE: Array<{ match: RegExp; canonical: string; dimension: UnitDimension }> = [
  // Volume
  { match: /^colher(es)?\s+de\s+sopa(s)?$/, canonical: "colher de sopa", dimension: "spoon" },
  { match: /^c(s)?\s+de\s+sopa$/, canonical: "colher de sopa", dimension: "spoon" },
  { match: /^colher(es)?\s+de\s+chá(s)?$/, canonical: "colher de chá", dimension: "spoon" },
  { match: /^c(s)?\s+de\s+chá$/, canonical: "colher de chá", dimension: "spoon" },
  { match: /^colher(es)?\s+de\s+café(s)?$/, canonical: "colher de café", dimension: "spoon" },
  { match: /^colher(es)?\s+(sopa|chá|café|sobremesa)?$/, canonical: "colher", dimension: "spoon" },
  { match: /^xícara(s)?$/, canonical: "xícara", dimension: "cup" },
  { match: /^xicara(s)?$/, canonical: "xícara", dimension: "cup" },
  { match: /^cup(s)?$/, canonical: "xícara", dimension: "cup" },
  { match: /^ml(s)?$/, canonical: "ml", dimension: "volume" },
  { match: /^mililitro(s)?$/, canonical: "ml", dimension: "volume" },
  { match: /^l(s)?$/, canonical: "l", dimension: "volume" },
  { match: /^litro(s)?$/, canonical: "l", dimension: "volume" },
  { match: /^copo(s)?$/, canonical: "copo", dimension: "glass" },
  { match: /^taça(s)?$/, canonical: "taça", dimension: "glass" },
  // Mass
  { match: /^g(s)?$/, canonical: "g", dimension: "mass" },
  { match: /^grama(s)?$/, canonical: "g", dimension: "mass" },
  { match: /^kg(s)?$/, canonical: "kg", dimension: "mass" },
  { match: /^quilograma(s)?$/, canonical: "kg", dimension: "mass" },
  { match: /^mg(s)?$/, canonical: "mg", dimension: "mass" },
  { match: /^miligrama(s)?$/, canonical: "mg", dimension: "mass" },
  // Count / pieces
  { match: /^unidade(s)?$/, canonical: "unidade", dimension: "count" },
  { match: /^un(s)?$/, canonical: "unidade", dimension: "count" },
  { match: /^dente(s)?$/, canonical: "dente", dimension: "clove" },
  { match: /^fatia(s)?$/, canonical: "fatia", dimension: "slice" },
  { match: /^pedaço(s)?$/, canonical: "pedaço", dimension: "piece" },
  { match: /^pedaco(s)?$/, canonical: "pedaço", dimension: "piece" },
  { match: /^folha(s)?$/, canonical: "folha", dimension: "slice" },
  { match: /^ramo(s)?$/, canonical: "ramo", dimension: "bunch" },
  { match: /^maço(s)?$/, canonical: "maço", dimension: "bunch" },
  { match: /^molho(s)?$/, canonical: "molho", dimension: "bunch" },
  // Packages
  { match: /^lata(s)?$/, canonical: "lata", dimension: "can" },
  { match: /^pote(s)?$/, canonical: "pote", dimension: "package" },
  { match: /^pacote(s)?$/, canonical: "pacote", dimension: "package" },
  { match: /^envelope(s)?$/, canonical: "envelope", dimension: "sachet" },
  { match: /^saquinho(s)?$/, canonical: "saquinho", dimension: "sachet" },
  { match: /^garrafa(s)?$/, canonical: "garrafa", dimension: "bottle" },
  { match: /^caixa(s)?$/, canonical: "caixa", dimension: "package" },
  { match: /^tablete(s)?$/, canonical: "tablete", dimension: "piece" },
  { match: /^barra(s)?$/, canonical: "barra", dimension: "piece" },
  { match: /^cubo(s)?$/, canonical: "cubo", dimension: "piece" },
  // Pinch
  { match: /^pitada(s)?$/, canonical: "pitada", dimension: "pinch" },
  { match: /^punhado(s)?$/, canonical: "punhado", dimension: "pinch" },
];

/**
 * Normalizes a unit string to a canonical culinary form and a dimension.
 * Unknown units keep a trimmed original as canonical with a null dimension.
 */
export function normalizeUnit(input: string | null | undefined): NormalizedUnit {
  if (!input) return { canonical: null, dimension: null };
  const cleaned = input.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
  if (!cleaned) return { canonical: null, dimension: null };

  for (const entry of UNIT_TABLE) {
    if (entry.match.test(cleaned)) {
      return { canonical: entry.canonical, dimension: entry.dimension };
    }
  }

  return { canonical: input.trim(), dimension: null };
}

const DURATION_UNIT_SECONDS: Record<string, number> = {
  s: 1, seg: 1, segundo: 1, segundos: 1,
  m: 60, min: 60, mins: 60, minuto: 60, minutos: 60,
  h: 3600, hr: 3600, hrs: 3600, hora: 3600, horas: 3600,
  d: 86400, dia: 86400, dias: 86400,
};

function durationFromParts(value: number, unit: string): number | null {
  const factor = DURATION_UNIT_SECONDS[unit];
  if (factor === undefined) return null;
  const seconds = value * factor;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
}

function parseHhMm(compact: string): number | null {
  const match = compact.match(/^(\d{1,2}):([0-5]?\d)$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 3600 + minutes * 60;
}

function parseClockCompact(text: string): number | null {
  // "1h30", "1h", "2hs30", "1h30min"
  const match = text.match(/^(\d{1,3})\s*h(?:\s*(\d{1,2})\s*(?:min)?)?$/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  return hours * 3600 + minutes * 60;
}

/**
 * Parses a time expression into seconds. Handles "30 minutos", "1h30", "1:30",
 * "1 hora e meia", "meia hora", ranges ("2 a 3 minutos") and explicit seconds.
 * Returns null when no numeric duration is present ("até dourar").
 */
export function parseDurationText(input: string | null | undefined): ParsedDuration | null {
  if (!input) return null;
  const text = input.trim().toLocaleLowerCase("pt-BR");
  if (!text) return null;

  // Compact clock: "1h30", "1h".
  const clockCompact = parseClockCompact(text.replace(/\s+/g, ""));
  if (clockCompact !== null) {
    return { minSeconds: null, maxSeconds: null, representativeSeconds: clockCompact, hadRange: false };
  }

  // "1 hora e meia", "1h e meia".
  const hourAndHalf = text.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)\s*(?:e\s*)?(?:meia)?/);
  if (text.includes("e meia") && hourAndHalf) {
    const hours = Number(hourAndHalf[1].replace(",", "."));
    const seconds = Math.round((hours + 0.5) * 3600);
    return { minSeconds: null, maxSeconds: null, representativeSeconds: seconds, hadRange: false };
  }

  // H:MM clock: "1:30".
  const clock = parseHhMm(text);
  if (clock !== null) {
    return { minSeconds: null, maxSeconds: null, representativeSeconds: clock, hadRange: false };
  }

  // "meia hora".
  if (/^(meia|meio)\s+hora/.test(text)) {
    return { minSeconds: null, maxSeconds: null, representativeSeconds: 1800, hadRange: false };
  }

  // Range: "2 a 3 minutos", "entre 10 e 15 min".
  const rangeMatch = text.match(
    /(?:\bentre\s+)?(\d+(?:[.,]\d+)?|\d+\s+\d+\/\d+|meia|meio|um|uma|dois|duas|três|tres)\s*(?:a|à|ate|até|-|–|e)\s*(\d+(?:[.,]\d+)?|\d+\s+\d+\/\d+|meia|meio|um|uma|dois|duas|três|tres)\s*(segundos?|s|min|minutos?|horas?|h|dias?)\b/i,
  );
  if (rangeMatch) {
    const unit = rangeMatch[3].toLocaleLowerCase("pt-BR");
    const low = durationValueToSeconds(rangeMatch[1], unit);
    const high = durationValueToSeconds(rangeMatch[2], unit);
    if (low !== null && high !== null && high >= low) {
      return { minSeconds: low, maxSeconds: high, representativeSeconds: high, hadRange: true };
    }
  }

  // Single value + unit: "30 minutos", "45 s", "2 horas".
  const singleMatch = text.match(
    /(\d+(?:[.,]\d+)?|\d+\s+\d+\/\d+|meia|meio|um|uma|dois|duas|três|tres)\s*(segundos?|s|min|minutos?|horas?|h|dias?)\b/i,
  );
  if (singleMatch) {
    const unit = singleMatch[2].toLocaleLowerCase("pt-BR");
    const seconds = durationValueToSeconds(singleMatch[1], unit);
    if (seconds !== null) {
      return { minSeconds: null, maxSeconds: null, representativeSeconds: seconds, hadRange: false };
    }
  }

  return null;
}

function durationValueToSeconds(token: string, unit: string): number | null {
  const normalizedUnit = unit.replace(/(es|s)$/, "") || unit;
  const canonicalUnit = pickDurationUnit(normalizedUnit);
  if (canonicalUnit === null) return null;

  const numeric = toDecimal(token);
  if (numeric !== null) return durationFromParts(numeric, canonicalUnit);

  const fraction = parseFraction(expandUnicodeFractions(token));
  if (fraction !== null) return durationFromParts(fraction, canonicalUnit);

  const word = WORD_NUMBERS[token];
  if (word !== undefined) return durationFromParts(word, canonicalUnit);

  return null;
}

function pickDurationUnit(unit: string): string | null {
  if (["s", "seg", "segundo", "segundos"].includes(unit)) return "s";
  if (["m", "min", "minuto", "minutos"].includes(unit)) return "m";
  if (["h", "hr", "hora", "horas"].includes(unit)) return "h";
  if (["d", "dia", "dias"].includes(unit)) return "d";
  return null;
}

/**
 * Returns true when a step instruction contains an explicit numeric time that
 * should have produced a duration. Used by coverage checks.
 */
export function instructionHasExplicitTime(instruction: string): boolean {
  return parseDurationText(extractTimePhrase(instruction)) !== null;
}

/**
 * Extracts the first time-like phrase from an instruction, if any.
 */
export * from "./cup-to-grams";

export function extractTimePhrase(instruction: string): string | null {
  const text = instruction.toLocaleLowerCase("pt-BR");
  const patterns = [
    /\d{1,3}\s*h(?:\s*\d{1,2}\s*(?:min)?)?/,
    /\d{1,2}:\d{2}/,
    /(?:meia|meio)\s+hora/,
    /\d+(?:[.,]\d+)?\s*(?:segundos?|s|min|minutos?|horas?|h|dias?)\b/,
    /\d+\s+\d+\/\d+\s*(?:min|horas?)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}
