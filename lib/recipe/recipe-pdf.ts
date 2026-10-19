import type { RecipeApiData } from "@/lib/recipe/recipe-draft";
import { QRCode } from "@/lib/qr/qrcode";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const BOTTOM = 46;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLOR_PRIMARY = "#E07A28";
const COLOR_TEXT = "#333333";
const COLOR_MUTED = "#666666";
const COLOR_LIGHT = "#EEEEEE";
const COLOR_DOTTED = "#E5E5E5";
const COLOR_FOOTER = "#A0A0A0";
const COLOR_ING_BG = "#FFF9F5";
const COLOR_OBS = "#888888";

const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

function winAnsiCode(char: string): number {
  const code = char.charCodeAt(0);
  if (code <= 0xff) return code;
  return WIN_ANSI[code] ?? 0x3f;
}

function hexEncode(text: string): string {
  let hex = "";
  for (let i = 0; i < text.length; i += 1) {
    hex += winAnsiCode(text[i]).toString(16).padStart(2, "0");
  }
  return hex;
}

export function cleanPdfText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\$\$?/g, "")
    .replace(/\^\{?\\?circ\}?/gi, "°")
    .replace(/\\circ/gi, "°")
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\times/gi, "×")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/[\u2610\u2611\u25a1\u25a0]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIngredientNotes(value: string | null | undefined): string {
  const notes = cleanPdfText(value);
  if (!notes) return "";
  if (notes.length > 48) return "";
  if (/(modo de preparo|indicado como|conforme|ver instru|utilizad[ao]s? para untar|acrescentad[ao])/i.test(notes)) return "";
  return notes;
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) lines.push("");
  return lines;
}

function formatSeconds(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const totalMinutes = Math.round(value / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  const num = parseInt(value, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

function rgbOp(hex: string): string {
  const c = hexToRgb(hex);
  return `${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} rg`;
}

function charsForWidth(width: number, size: number): number {
  return Math.max(12, Math.floor(width / Math.max(1, size * 0.5)));
}

type Page = { ops: string[] };

function newPage(): Page {
  return { ops: [] };
}

class Layout {
  pages: Page[] = [newPage()];
  y = PAGE_HEIGHT - MARGIN;
  overflow = false;

  get page(): Page {
    return this.pages[this.pages.length - 1];
  }

  trackOverflow() {
    if (this.y < BOTTOM) this.overflow = true;
  }

  ensureSpace(height: number) {
    if (this.y - height < BOTTOM) {
      this.pages.push(newPage());
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  setFill(hex: string) {
    this.page.ops.push(rgbOp(hex));
  }

  setStroke(hex: string) {
    const c = hexToRgb(hex);
    this.page.ops.push(`${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} RG`);
  }

  textLine(text: string, size: number, font = "F1", indent = 0, color = COLOR_TEXT) {
    this.ensureSpace(size + 5);
    this.setFill(color);
    this.page.ops.push(`BT /${font} ${size.toFixed(2)} Tf ${(MARGIN + indent).toFixed(2)} ${this.y.toFixed(2)} Td <${hexEncode(text)}> Tj ET`);
    this.y -= size + 3;
    this.trackOverflow();
  }

  gap(size = 5) {
    this.y -= size;
    if (this.y < BOTTOM) {
      this.pages.push(newPage());
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  heading(text: string, size: number) {
    this.gap(3);
    this.textLine(text, size, "F2", 0, COLOR_PRIMARY);
    this.gap(1);
  }

  hLine(x1: number, x2: number, y: number, width: number, color: string, dash?: string) {
    this.setStroke(color);
    this.page.ops.push(`${width} w`);
    if (dash) this.page.ops.push(dash);
    this.page.ops.push(`${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
    if (dash) this.page.ops.push("[] 0 d");
  }

  rect(x: number, yBottom: number, w: number, h: number, fill: string | null, stroke: string | null, radius = 0, lineWidth = 1) {
    this.page.ops.push("q");
    if (fill) this.setFill(fill);
    if (stroke) this.setStroke(stroke);
    this.page.ops.push(`${lineWidth} w`);
    if (radius > 0) {
      const r = Math.min(radius, w / 2, h / 2);
      const k = 0.5522847498 * r;
      const x2 = x + w;
      const y2 = yBottom + h;
      this.page.ops.push(`${(x + r).toFixed(2)} ${yBottom.toFixed(2)} m`);
      this.page.ops.push(`${(x2 - r).toFixed(2)} ${yBottom.toFixed(2)} l`);
      this.page.ops.push(`${(x2 - r + k).toFixed(2)} ${yBottom.toFixed(2)} ${x2.toFixed(2)} ${(yBottom + r - k).toFixed(2)} ${x2.toFixed(2)} ${(yBottom + r).toFixed(2)} c`);
      this.page.ops.push(`${x2.toFixed(2)} ${(y2 - r).toFixed(2)} l`);
      this.page.ops.push(`${x2.toFixed(2)} ${(y2 - r + k).toFixed(2)} ${(x2 - r + k).toFixed(2)} ${y2.toFixed(2)} ${(x2 - r).toFixed(2)} ${y2.toFixed(2)} c`);
      this.page.ops.push(`${(x + r).toFixed(2)} ${y2.toFixed(2)} l`);
      this.page.ops.push(`${(x + r - k).toFixed(2)} ${y2.toFixed(2)} ${x.toFixed(2)} ${(y2 - r + k).toFixed(2)} ${x.toFixed(2)} ${(y2 - r).toFixed(2)} c`);
      this.page.ops.push(`${x.toFixed(2)} ${(yBottom + r).toFixed(2)} l`);
      this.page.ops.push(`${x.toFixed(2)} ${(yBottom + r - k).toFixed(2)} ${(x + r - k).toFixed(2)} ${yBottom.toFixed(2)} ${(x + r).toFixed(2)} ${yBottom.toFixed(2)} c`);
      this.page.ops.push("h");
    } else {
      this.page.ops.push(`${x.toFixed(2)} ${yBottom.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    }
    if (fill && stroke) this.page.ops.push("B");
    else if (fill) this.page.ops.push("f");
    else this.page.ops.push("S");
    this.page.ops.push("Q");
  }

  circle(cx: number, cy: number, r: number, fill: string) {
    this.page.ops.push("q");
    this.setFill(fill);
    const k = 0.5522847498 * r;
    this.page.ops.push(`${(cx + r).toFixed(2)} ${cy.toFixed(2)} m`);
    this.page.ops.push(`${(cx + r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + r).toFixed(2)} ${cx.toFixed(2)} ${(cy + r).toFixed(2)} c`);
    this.page.ops.push(`${(cx - k).toFixed(2)} ${(cy + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - r).toFixed(2)} ${cy.toFixed(2)} c`);
    this.page.ops.push(`${(cx - r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - r).toFixed(2)} ${cx.toFixed(2)} ${(cy - r).toFixed(2)} c`);
    this.page.ops.push(`${(cx + k).toFixed(2)} ${(cy - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + r).toFixed(2)} ${cy.toFixed(2)} c`);
    this.page.ops.push("h f Q");
  }

  clipImage(x: number, yBottom: number, w: number, h: number, radius: number, imageOp: string) {
    this.page.ops.push("q");
    const r = Math.min(radius, w / 2, h / 2);
    const k = 0.5522847498 * r;
    const x2 = x + w;
    const y2 = yBottom + h;
    this.page.ops.push(`${(x + r).toFixed(2)} ${yBottom.toFixed(2)} m`);
    this.page.ops.push(`${(x2 - r).toFixed(2)} ${yBottom.toFixed(2)} l`);
    this.page.ops.push(`${(x2 - r + k).toFixed(2)} ${yBottom.toFixed(2)} ${x2.toFixed(2)} ${(yBottom + r - k).toFixed(2)} ${x2.toFixed(2)} ${(yBottom + r).toFixed(2)} c`);
    this.page.ops.push(`${x2.toFixed(2)} ${(y2 - r).toFixed(2)} l`);
    this.page.ops.push(`${x2.toFixed(2)} ${(y2 - r + k).toFixed(2)} ${(x2 - r + k).toFixed(2)} ${y2.toFixed(2)} ${(x2 - r).toFixed(2)} ${y2.toFixed(2)} c`);
    this.page.ops.push(`${(x + r).toFixed(2)} ${y2.toFixed(2)} l`);
    this.page.ops.push(`${(x + r - k).toFixed(2)} ${y2.toFixed(2)} ${x.toFixed(2)} ${(y2 - r + k).toFixed(2)} ${x.toFixed(2)} ${(y2 - r).toFixed(2)} c`);
    this.page.ops.push(`${x.toFixed(2)} ${(yBottom + r).toFixed(2)} l`);
    this.page.ops.push(`${x.toFixed(2)} ${(yBottom + r - k).toFixed(2)} ${(x + r - k).toFixed(2)} ${yBottom.toFixed(2)} ${(x + r).toFixed(2)} ${yBottom.toFixed(2)} c`);
    this.page.ops.push("h W n");
    this.page.ops.push(imageOp);
    this.page.ops.push("Q");
  }
}

type QrMatrix = { size: number; isDark: (row: number, col: number) => boolean };

function buildQrMatrix(url: string): QrMatrix | null {
  try {
    const qr = new QRCode(-1, 1);
    qr.addData(url);
    qr.make();
    const count = qr.getModuleCount();
    return { size: count, isDark: (row, col) => qr.isDark(row, col) };
  } catch {
    return null;
  }
}

function qrOps(matrix: QrMatrix, x: number, yBottom: number, size: number): string[] {
  const moduleSize = size / matrix.size;
  const ops: string[] = ["q", "0 0 0 rg"];
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.isDark(row, col)) {
        const px = x + col * moduleSize;
        const py = yBottom + (matrix.size - 1 - row) * moduleSize;
        ops.push(`${px.toFixed(2)} ${py.toFixed(2)} ${moduleSize.toFixed(2)} ${moduleSize.toFixed(2)} re`);
      }
    }
  }
  ops.push("f Q");
  return ops;
}

export type RecipePdfOptions = {
  coverImage?: { bytes: Uint8Array; width: number; height: number };
};

type LayoutResult = { layout: Layout };

function layoutRecipe(data: RecipeApiData, options: RecipePdfOptions | undefined, scale: number, qr: QrMatrix | null): LayoutResult {
  const recipe = data.recipe;
  const layout = new Layout();
  const u = (value: number) => value * scale;
  const fs = (value: number) => Math.max(7, value * scale);

  const cover = options?.coverImage;
  const photoSize = u(66);
  const headerTop = layout.y;
  const photoX = MARGIN;
  const photoYBottom = headerTop - photoSize;

  if (cover && cover.width > 0 && cover.height > 0) {
    const drawScale = Math.min(photoSize / cover.width, photoSize / cover.height);
    const drawW = Math.max(1, Math.round(cover.width * drawScale));
    const drawH = Math.max(1, Math.round(cover.height * drawScale));
    const offX = photoX + Math.round((photoSize - drawW) / 2);
    const offY = photoYBottom + Math.round((photoSize - drawH) / 2);
    const imageOp = `q ${drawW} 0 0 ${drawH} ${offX} ${offY} cm /Im1 Do Q`;
    layout.clipImage(photoX, photoYBottom, photoSize, photoSize, u(5), imageOp);
  }

  const titleX = MARGIN + photoSize + u(11);
  const titleText = cleanPdfText(recipe.title) || "Receita";
  const qrSize = u(66);
  const qrX = PAGE_WIDTH - MARGIN - qrSize;
  const titleAvailable = qrX - titleX - u(10);
  let titleSize = fs(22);
  const estimatedTitleWidth = titleText.length * titleSize * 0.53;
  if (estimatedTitleWidth > titleAvailable) {
    titleSize = Math.max(fs(13), titleSize * (titleAvailable / estimatedTitleWidth));
  }
  const titleY = headerTop - u(18);
  layout.setFill(COLOR_TEXT);
  layout.page.ops.push(`BT /F2 ${titleSize.toFixed(2)} Tf ${titleX.toFixed(2)} ${titleY.toFixed(2)} Td <${hexEncode(titleText)}> Tj ET`);

  const metaSize = fs(10);
  const metaY = headerTop - u(47);
  const metaParts: { label: string; value: string }[] = [];
  if (recipe.servings !== null && recipe.servings !== undefined) metaParts.push({ label: "Servings:", value: String(recipe.servings) });
  const prep = formatSeconds(recipe.timings.prep_seconds);
  const cook = formatSeconds(recipe.timings.cook_seconds);
  const total = formatSeconds(recipe.timings.total_seconds);
  if (prep) metaParts.push({ label: "Prep:", value: prep });
  if (cook) metaParts.push({ label: "Cook:", value: cook });
  if (total) metaParts.push({ label: "Total:", value: total });

  let mx = titleX;
  for (let i = 0; i < metaParts.length; i++) {
    const part = metaParts[i];
    layout.page.ops.push(rgbOp(COLOR_PRIMARY));
    layout.page.ops.push(`BT /F2 ${metaSize.toFixed(2)} Tf ${mx.toFixed(2)} ${metaY.toFixed(2)} Td <${hexEncode(part.label)}> Tj ET`);
    const labelWidth = part.label.length * metaSize * 0.54;
    const valueX = mx + labelWidth + 2;
    layout.page.ops.push(rgbOp(COLOR_TEXT));
    layout.page.ops.push(`BT /F1 ${metaSize.toFixed(2)} Tf ${valueX.toFixed(2)} ${metaY.toFixed(2)} Td <${hexEncode(part.value)}> Tj ET`);
    const valueWidth = part.value.length * metaSize * 0.5;
    mx = valueX + valueWidth + u(9);
    if (i < metaParts.length - 1) {
      layout.page.ops.push(rgbOp(COLOR_LIGHT));
      layout.page.ops.push(`BT /F1 ${metaSize.toFixed(2)} Tf ${(mx - u(5)).toFixed(2)} ${metaY.toFixed(2)} Td <${hexEncode("|")}> Tj ET`);
    }
  }

  const qrYBottom = headerTop - qrSize;
  if (qr) layout.page.ops.push(...qrOps(qr, qrX, qrYBottom, qrSize));

  const sepY = photoYBottom - u(9);
  layout.hLine(MARGIN, PAGE_WIDTH - MARGIN, sepY, 1.8, COLOR_PRIMARY);
  layout.y = sepY - u(15);

  const groups = new Map<string, typeof recipe.ingredients>();
  for (const ingredient of recipe.ingredients) {
    const section = cleanPdfText(ingredient.section) || "Ingredientes";
    const items = groups.get(section) ?? [];
    items.push(ingredient);
    groups.set(section, items);
  }

  const ingItemFont = fs(9.6);
  const ingLineHeight = u(12.6);
  const ingSubFont = fs(12);
  const ingSubHeight = u(15);
  const ingPadX = u(13);
  const ingPadTop = u(9);
  const ingPadBottom = u(9);
  const ingQtyCol = u(76);
  const ingNameX = MARGIN + ingPadX + ingQtyCol;
  const ingNameWidth = PAGE_WIDTH - MARGIN - u(12) - ingNameX;
  const ingNameChars = charsForWidth(ingNameWidth, ingItemFont);

  function ingredientRenderInfo(ingredient: (typeof recipe.ingredients)[number]) {
    const notes = cleanIngredientNotes(ingredient.notes);
    const name = cleanPdfText(ingredient.name);
    const nameLines = wrapText(name, ingNameChars);
    const noteText = notes ? ` (${notes})` : "";
    const lastLine = nameLines[nameLines.length - 1] ?? "";
    const inlineNoteX = ingNameX + lastLine.length * ingItemFont * 0.5;
    const noteWidth = noteText.length * ingItemFont * 0.5;
    const rightEdge = PAGE_WIDTH - MARGIN - u(12);
    const noteOnNewLine = Boolean(noteText) && inlineNoteX + noteWidth > rightEdge;
    const lineCount = Math.max(1, nameLines.length + (noteOnNewLine ? 1 : 0));
    return { notes, name, nameLines, noteText, inlineNoteX, noteOnNewLine, lineCount };
  }

  let blockHeight = ingPadTop + ingPadBottom;
  for (const [, ingredients] of groups) {
    if (groups.size > 1) blockHeight += ingSubHeight + u(2);
    for (const ingredient of ingredients) {
      blockHeight += ingredientRenderInfo(ingredient).lineCount * ingLineHeight + u(4);
    }
    blockHeight += u(3);
  }

  layout.gap(3);
  layout.textLine("Ingredients", fs(16.5), "F2", 0, COLOR_PRIMARY);
  layout.gap(2);

  const containerYBottom = layout.y - blockHeight;
  layout.rect(MARGIN, containerYBottom, TEXT_WIDTH, blockHeight, COLOR_ING_BG, null, u(4), 1);
  layout.y -= ingPadTop;

  for (const [section, ingredients] of groups) {
    if (groups.size > 1) {
      layout.page.ops.push(rgbOp(COLOR_TEXT));
      layout.page.ops.push(`BT /F2 ${ingSubFont.toFixed(2)} Tf ${(MARGIN + ingPadX).toFixed(2)} ${(layout.y - ingSubFont).toFixed(2)} Td <${hexEncode(section)}> Tj ET`);
      layout.y -= ingSubHeight + u(2);
    }
    for (const ingredient of ingredients) {
      const info = ingredientRenderInfo(ingredient);
      const qty = cleanPdfText(
        ingredient.quantity_text
          || (ingredient.quantity !== null ? `${ingredient.quantity}${ingredient.unit ? " " + ingredient.unit : ""}` : ""),
      );
      const itemTop = layout.y;
      const baseline = itemTop - ingItemFont;
      if (qty) {
        layout.page.ops.push(rgbOp(COLOR_PRIMARY));
        layout.page.ops.push(`BT /F2 ${ingItemFont.toFixed(2)} Tf ${(MARGIN + ingPadX).toFixed(2)} ${baseline.toFixed(2)} Td <${hexEncode(qty)}> Tj ET`);
      }
      layout.page.ops.push(rgbOp(COLOR_TEXT));
      for (let i = 0; i < info.nameLines.length; i++) {
        const lineY = baseline - i * ingLineHeight;
        layout.page.ops.push(`BT /F1 ${ingItemFont.toFixed(2)} Tf ${ingNameX.toFixed(2)} ${lineY.toFixed(2)} Td <${hexEncode(info.nameLines[i])}> Tj ET`);
      }
      if (info.notes) {
        const noteX = info.noteOnNewLine ? ingNameX : info.inlineNoteX;
        const noteY = info.noteOnNewLine
          ? baseline - info.nameLines.length * ingLineHeight
          : baseline - (info.nameLines.length - 1) * ingLineHeight;
        layout.page.ops.push(rgbOp(COLOR_OBS));
        layout.page.ops.push(`BT /F3 ${ingItemFont.toFixed(2)} Tf ${noteX.toFixed(2)} ${noteY.toFixed(2)} Td <${hexEncode(info.noteText)}> Tj ET`);
        layout.page.ops.push(rgbOp(COLOR_TEXT));
      }
      const itemHeight = info.lineCount * ingLineHeight + u(4);
      layout.y = itemTop - itemHeight;
      layout.hLine(MARGIN + ingPadX, PAGE_WIDTH - MARGIN - u(12), layout.y + u(1.5), 0.8, COLOR_DOTTED, "[1.5 2] 0 d");
    }
    layout.y -= u(3);
  }
  layout.y -= ingPadBottom;
  layout.trackOverflow();

  const steps = [...recipe.steps].sort((a, b) => a.position - b.position);
  layout.gap(5);
  layout.textLine("Instructions", fs(16.5), "F2", 0, COLOR_PRIMARY);
  layout.hLine(MARGIN, PAGE_WIDTH - MARGIN, layout.y + u(2), 0.9, COLOR_PRIMARY);
  layout.gap(2);
  layout.textLine("Modo de Preparo", fs(12), "F2", 0, COLOR_MUTED);
  layout.gap(3);

  const stepFont = fs(9.6);
  const stepLineHeight = u(12.6);
  const circleR = u(9);
  const stepTextX = MARGIN + u(27);
  const stepTextWidth = PAGE_WIDTH - MARGIN - stepTextX;
  const stepChars = charsForWidth(stepTextWidth, stepFont);

  steps.forEach((step, index) => {
    const instruction = cleanPdfText(step.instruction).replace(/^\s*\d+\s*[.)-]\s*/, "");
    const lines = wrapText(instruction, stepChars);
    const stepHeight = Math.max(circleR * 2 + u(2), lines.length * stepLineHeight) + u(6);
    const stepTop = layout.y;
    const circleY = stepTop - circleR - u(2);
    layout.circle(MARGIN + circleR, circleY, circleR, COLOR_PRIMARY);
    const numStr = String(index + 1);
    const numX = MARGIN + circleR - (numStr.length === 1 ? u(2.4) : u(4.6));
    const numY = circleY - u(2.6);
    layout.page.ops.push("1 1 1 rg");
    layout.page.ops.push(`BT /F2 ${fs(9).toFixed(2)} Tf ${numX.toFixed(2)} ${numY.toFixed(2)} Td <${hexEncode(numStr)}> Tj ET`);
    layout.page.ops.push(rgbOp(COLOR_TEXT));
    for (let i = 0; i < lines.length; i++) {
      const lineY = stepTop - stepFont - i * stepLineHeight;
      layout.page.ops.push(`BT /F1 ${stepFont.toFixed(2)} Tf ${stepTextX.toFixed(2)} ${lineY.toFixed(2)} Td <${hexEncode(lines[i])}> Tj ET`);
    }
    layout.y = stepTop - stepHeight;
    if (index < steps.length - 1) {
      layout.hLine(MARGIN, PAGE_WIDTH - MARGIN, layout.y + u(3), 0.8, COLOR_LIGHT);
      layout.y -= u(4);
    }
    layout.trackOverflow();
  });

  for (const page of layout.pages) {
    const footerText = "Generated by Recistep";
    const footerSize = fs(9);
    const footerWidth = footerText.length * footerSize * 0.5;
    const footerX = (PAGE_WIDTH - footerWidth) / 2;
    page.ops.push(rgbOp(COLOR_FOOTER));
    page.ops.push(`BT /F1 ${footerSize.toFixed(2)} Tf ${footerX.toFixed(2)} 28 Td <${hexEncode(footerText)}> Tj ET`);
  }

  return { layout };
}

function assemblePdf(layout: Layout, cover: RecipePdfOptions["coverImage"]): Uint8Array {
  const contents = layout.pages.map((page) => ["q", ...page.ops, "Q"].join("\n"));

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageCount = layout.pages.length;
  const pageObjectNumbers = layout.pages.map((_, i) => 3 + i * 2);
  const contentObjectNumbers = layout.pages.map((_, i) => 4 + i * 2);
  const font1Number = 3 + pageCount * 2;
  const font2Number = font1Number + 1;
  const font3Number = font2Number + 1;
  const imageNumber = cover ? font3Number + 1 : null;

  const kids = pageObjectNumbers.map((n) => `${n} 0 R`).join(" ");
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;

  for (let i = 0; i < pageCount; i += 1) {
    const pageNum = pageObjectNumbers[i];
    const contentNum = contentObjectNumbers[i];
    while (objects.length < pageNum) objects.push("");
    const resourceParts = [`/Font << /F1 ${font1Number} 0 R /F2 ${font2Number} 0 R /F3 ${font3Number} 0 R >>`];
    if (cover && i === 0 && imageNumber) resourceParts.push(`/XObject << /Im1 ${imageNumber} 0 R >>`);
    objects[pageNum - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << ${resourceParts.join(" ")} >> /Contents ${contentNum} 0 R >>`;
    const stream = contents[i];
    while (objects.length < contentNum) objects.push("");
    objects[contentNum - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  while (objects.length < font1Number) objects.push("");
  objects[font1Number - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[font2Number - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[font3Number - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>";

  if (cover && imageNumber) {
    while (objects.length < imageNumber) objects.push("");
    const hex = Array.from(cover.bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const streamData = `${hex}\n`;
    objects[imageNumber - 1] = `<< /Type /XObject /Subtype /Image /Width ${cover.width} /Height ${cover.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${streamData.length} >>\nstream\n${streamData}endstream`;
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

export function buildRecipePdf(data: RecipeApiData, options?: RecipePdfOptions): Uint8Array {
  const cover = options?.coverImage;
  const qr = data.source_url ? buildQrMatrix(data.source_url) : null;

  let best: LayoutResult | null = null;
  for (const scale of [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64]) {
    const result = layoutRecipe(data, options, scale, qr);
    best = result;
    if (result.layout.pages.length === 1 && !result.layout.overflow) break;
  }

  return assemblePdf(best!.layout, cover);
}

export const renderRecipePdf = buildRecipePdf;
export const generateRecipePdf = buildRecipePdf;
export const createRecipePdf = buildRecipePdf;
export const recipeToPdf = buildRecipePdf;
export const exportRecipeToPdf = buildRecipePdf;
export const pdfFromRecipe = buildRecipePdf;
