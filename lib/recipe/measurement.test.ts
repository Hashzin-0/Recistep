import { describe, expect, it } from "vitest";
import {
  extractTimePhrase,
  instructionHasExplicitTime,
  normalizeUnit,
  parseDurationText,
  parseQuantityText,
} from "./measurement";

describe("parseQuantityText", () => {
  it("parses integers", () => {
    expect(parseQuantityText("2").representative).toBe(2);
    expect(parseQuantityText("2").kind).toBe("integer");
  });

  it("parses decimals with comma and dot", () => {
    expect(parseQuantityText("1,5").representative).toBe(1.5);
    expect(parseQuantityText("1.5").representative).toBe(1.5);
  });

  it("parses fractions", () => {
    expect(parseQuantityText("1/2").representative).toBeCloseTo(0.5);
    expect(parseQuantityText("1/2").kind).toBe("fraction");
    expect(parseQuantityText("3/4").representative).toBeCloseTo(0.75);
  });

  it("parses unicode fractions", () => {
    expect(parseQuantityText("½").representative).toBeCloseTo(0.5);
    expect(parseQuantityText("¾").representative).toBeCloseTo(0.75);
    expect(parseQuantityText("⅓").representative).toBeCloseTo(1 / 3);
  });

  it("parses mixed numbers", () => {
    expect(parseQuantityText("1 1/2").representative).toBeCloseTo(1.5);
    expect(parseQuantityText("1 1/2").kind).toBe("mixed");
    expect(parseQuantityText("2 ¾").representative).toBeCloseTo(2.75);
  });

  it("parses ranges with 'a'", () => {
    const parsed = parseQuantityText("2 a 3");
    expect(parsed.kind).toBe("range");
    expect(parsed.min).toBe(2);
    expect(parsed.max).toBe(3);
    expect(parsed.representative).toBe(3);
  });

  it("parses ranges with dash", () => {
    const parsed = parseQuantityText("10-15");
    expect(parsed.min).toBe(10);
    expect(parsed.max).toBe(15);
  });

  it("parses ranges with 'entre' and 'e'", () => {
    const parsed = parseQuantityText("entre 2 e 4");
    expect(parsed.min).toBe(2);
    expect(parsed.max).toBe(4);
  });

  it("marks descriptive phrases", () => {
    expect(parseQuantityText("a gosto").descriptive).toBe(true);
    expect(parseQuantityText("a gosto").representative).toBeNull();
    expect(parseQuantityText("q.b.").descriptive).toBe(true);
    expect(parseQuantityText("um punhado").descriptive).toBe(true);
    expect(parseQuantityText("uma pitada").descriptive).toBe(true);
  });

  it("parses word numbers", () => {
    expect(parseQuantityText("meia").representative).toBe(0.5);
    expect(parseQuantityText("duas").representative).toBe(2);
    expect(parseQuantityText("uma").representative).toBe(1);
  });

  it("returns none for empty or uninterpretable input", () => {
    expect(parseQuantityText("").kind).toBe("none");
    expect(parseQuantityText(null).kind).toBe("none");
    expect(parseQuantityText("xyz").kind).toBe("none");
  });
});

describe("normalizeUnit", () => {
  it("normalizes spoon units", () => {
    expect(normalizeUnit("colher de sopa").canonical).toBe("colher de sopa");
    expect(normalizeUnit("colher de sopa").dimension).toBe("spoon");
    expect(normalizeUnit("colher de chá").canonical).toBe("colher de chá");
  });

  it("normalizes mass and volume", () => {
    expect(normalizeUnit("g").canonical).toBe("g");
    expect(normalizeUnit("gramas").canonical).toBe("g");
    expect(normalizeUnit("kg").canonical).toBe("kg");
    expect(normalizeUnit("ml").canonical).toBe("ml");
    expect(normalizeUnit("litros").canonical).toBe("l");
  });

  it("normalizes count and pieces", () => {
    expect(normalizeUnit("dentes").canonical).toBe("dente");
    expect(normalizeUnit("unidades").canonical).toBe("unidade");
    expect(normalizeUnit("fatias").canonical).toBe("fatia");
  });

  it("normalizes packages", () => {
    expect(normalizeUnit("latas").canonical).toBe("lata");
    expect(normalizeUnit("pacote").canonical).toBe("pacote");
    expect(normalizeUnit("envelope").canonical).toBe("envelope");
  });

  it("keeps unknown units with null dimension", () => {
    expect(normalizeUnit("colheres de tupperware").canonical).toBe("colheres de tupperware");
    expect(normalizeUnit("colheres de tupperware").dimension).toBeNull();
    expect(normalizeUnit(null).canonical).toBeNull();
  });
});

describe("parseDurationText", () => {
  it("parses minutes", () => {
    expect(parseDurationText("30 minutos")?.representativeSeconds).toBe(1800);
    expect(parseDurationText("45 min")?.representativeSeconds).toBe(2700);
  });

  it("parses hours", () => {
    expect(parseDurationText("2 horas")?.representativeSeconds).toBe(7200);
    expect(parseDurationText("1 hora")?.representativeSeconds).toBe(3600);
  });

  it("parses seconds", () => {
    expect(parseDurationText("30 segundos")?.representativeSeconds).toBe(30);
  });

  it("parses compact clock 1h30", () => {
    expect(parseDurationText("1h30")?.representativeSeconds).toBe(5400);
    expect(parseDurationText("2h")?.representativeSeconds).toBe(7200);
  });

  it("parses H:MM clock", () => {
    expect(parseDurationText("1:30")?.representativeSeconds).toBe(5400);
    expect(parseDurationText("0:45")?.representativeSeconds).toBe(2700);
  });

  it("parses '1 hora e meia'", () => {
    expect(parseDurationText("1 hora e meia")?.representativeSeconds).toBe(5400);
  });

  it("parses 'meia hora'", () => {
    expect(parseDurationText("meia hora")?.representativeSeconds).toBe(1800);
  });

  it("parses ranges", () => {
    const parsed = parseDurationText("10 a 15 minutos");
    expect(parsed?.hadRange).toBe(true);
    expect(parsed?.minSeconds).toBe(600);
    expect(parsed?.maxSeconds).toBe(900);
    expect(parsed?.representativeSeconds).toBe(900);
  });

  it("returns null for non-numeric time cues", () => {
    expect(parseDurationText("até dourar")).toBeNull();
    expect(parseDurationText("")).toBeNull();
    expect(parseDurationText(null)).toBeNull();
  });
});

describe("extractTimePhrase / instructionHasExplicitTime", () => {
  it("extracts minutes phrase", () => {
    expect(extractTimePhrase("Asse por 30 minutos em forno médio.")).toContain("30 minutos");
    expect(instructionHasExplicitTime("Asse por 30 minutos.")).toBe(true);
  });

  it("extracts compact clock", () => {
    expect(instructionHasExplicitTime("Descanse por 1h30.")).toBe(true);
  });

  it("detects no explicit time", () => {
    expect(instructionHasExplicitTime("Misture até ficar homogêneo.")).toBe(false);
    expect(extractTimePhrase("Misture até ficar homogêneo.")).toBeNull();
  });
});
