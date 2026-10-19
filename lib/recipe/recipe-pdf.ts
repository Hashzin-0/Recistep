import type { RecipeApiData } from "@/lib/recipe/recipe-draft";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const BOTTOM = 50;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
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

function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/);
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
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds}s`;
}

function charLimit(size: number): number {
  const avg = size * 0.5;
  return Math.max(20, Math.floor(TEXT_WIDTH / avg));
}

type Page = { ops: string[] };

function newPage(): Page {
  return { ops: [] };
}

class Layout {
  pages: Page[] = [newPage()];

  y = PAGE_HEIGHT - MARGIN;

  get page(): Page {
    return this.pages[this.pages.length - 1];
  }

  ensureSpace(height: number) {
    if (this.y - height < BOTTOM) {
      this.pages.push(newPage());
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  textLine(text: string, size: number, font = "F1", indent = 0) {
    this.ensureSpace(size + 6);
    const x = MARGIN + indent;
    this.page.ops.push(`BT /${font} ${size} Tf ${x} ${this.y} Td <${hexEncode(text)}> Tj ET`);
    this.y -= size + 4;
  }

  paragraph(text: string, size: number, font = "F1", indent = 0, maxCharsOverride?: number) {
    const limit = maxCharsOverride ?? charLimit(size);
    for (const line of wrapText(text, limit)) {
      this.textLine(line, size, font, indent);
    }
  }

  gap(size = 6) {
    this.y -= size;
    if (this.y < BOTTOM) {
      this.pages.push(newPage());
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  heading(text: string, size: number) {
    this.gap(4);
    this.textLine(text, size, "F2");
    this.gap(2);
  }

  bullet(text: string, size: number, indent = 14) {
    this.paragraph(`• ${text}`, size, "F1", indent, charLimit(size) - 2);
  }
}

function buildContent(pages: Page[]): string[] {
  return pages.map((page, index) => {
    const ops = ["q", ...page.ops, "Q"];
    const footer = `BT /F1 8 Tf ${MARGIN} 30 Td <${hexEncode(`Pagina ${index + 1} de ${pages.length}`)}> Tj ET`;
    ops.push(footer);
    return ops.join("\n");
  });
}

export type RecipePdfOptions = {
  coverImage?: { bytes: Uint8Array; width: number; height: number };
};

export function buildRecipePdf(data: RecipeApiData, options?: RecipePdfOptions): Uint8Array {
  const recipe = data.recipe;
  const layout = new Layout();

  const cover = options?.coverImage;
  let hasCover = false;
  if (cover && cover.width > 0 && cover.height > 0) {
    hasCover = true;
    const maxW = TEXT_WIDTH;
    const maxH = 180;
    const scale = Math.min(maxW / cover.width, maxH / cover.height, 1);
    const drawW = Math.max(1, Math.round(cover.width * scale));
    const drawH = Math.max(1, Math.round(cover.height * scale));
    const yBottom = layout.y - drawH;
    layout.pages[0].ops.push(`q ${drawW} 0 0 ${drawH} ${MARGIN} ${yBottom} cm /Im1 Do Q`);
    layout.y = yBottom - 10;
  }

  layout.textLine(recipe.title || "Receita", 18, "F2");
  if (recipe.description) {
    layout.paragraph(recipe.description, 11);
    layout.gap(4);
  }

  const meta: string[] = [];
  if (recipe.servings !== null && recipe.servings !== undefined) meta.push(`Porcoes: ${recipe.servings}`);
  const prep = formatSeconds(recipe.timings.prep_seconds);
  const cook = formatSeconds(recipe.timings.cook_seconds);
  const total = formatSeconds(recipe.timings.total_seconds);
  if (prep) meta.push(`Preparo: ${prep}`);
  if (cook) meta.push(`Coccao: ${cook}`);
  if (total) meta.push(`Total: ${total}`);
  if (meta.length) {
    layout.paragraph(meta.join(" . "), 10, "F1");
    layout.gap(4);
  }

  if (data.source_url) {
    layout.paragraph(`Fonte: ${data.source_url}`, 9);
    layout.gap(4);
  }

  layout.heading("Ingredientes", 13);
  const groups = new Map<string, typeof recipe.ingredients>();
  for (const ingredient of recipe.ingredients) {
    const section = (ingredient.section || "Ingredientes").trim() || "Ingredientes";
    const items = groups.get(section) ?? [];
    items.push(ingredient);
    groups.set(section, items);
  }
  for (const [section, ingredients] of groups) {
    if (groups.size > 1) layout.textLine(section, 11, "F2", 0);
    for (const ingredient of ingredients) {
      const qty = ingredient.quantity_text
        || (ingredient.quantity !== null ? `${ingredient.quantity}${ingredient.unit ? " " + ingredient.unit : ""}` : "Quantidade nao informada");
      const notes = ingredient.notes ? ` - ${ingredient.notes}` : "";
      layout.bullet(`${qty} ${ingredient.name}${notes}`, 10);
    }
    layout.gap(2);
  }

  if ((recipe.utensils ?? []).length > 0) {
    layout.heading("Utensilios e equipamentos", 13);
    for (const utensil of recipe.utensils) {
      const qty = utensil.quantity ? ` (${utensil.quantity})` : "";
      const purpose = utensil.purpose ? ` - ${utensil.purpose}` : "";
      layout.bullet(`${utensil.name}${qty}${purpose}`, 10);
    }
    layout.gap(4);
  }

  layout.heading("Etapas", 13);
  const steps = [...recipe.steps].sort((a, b) => a.position - b.position);
  steps.forEach((step, index) => {
    const duration = step.duration_text
      || (step.duration_seconds !== null && step.duration_seconds !== undefined ? ` (${step.duration_seconds}s)` : "");
    layout.paragraph(`${index + 1}. ${step.instruction}${duration}`, 10, "F1", 0);
    layout.gap(2);
  });

  if ((recipe.uncertainties ?? []).length > 0) {
    layout.gap(4);
    layout.heading("Incertezas", 12);
    for (const item of recipe.uncertainties) layout.bullet(item, 9);
  }
  if ((recipe.warnings ?? []).length > 0) {
    layout.gap(4);
    layout.heading("Avisos", 12);
    for (const item of recipe.warnings) layout.bullet(item, 9);
  }

  const contents = buildContent(layout.pages);

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageCount = layout.pages.length;
  const pageObjectNumbers = layout.pages.map((_, i) => 3 + i * 2);
  const contentObjectNumbers = layout.pages.map((_, i) => 4 + i * 2);
  const font1Number = 3 + pageCount * 2;
  const font2Number = font1Number + 1;
  const imageNumber = hasCover ? font2Number + 1 : null;

  const kids = pageObjectNumbers.map((n) => `${n} 0 R`).join(" ");
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;

  for (let i = 0; i < pageCount; i += 1) {
    const pageNum = pageObjectNumbers[i];
    const contentNum = contentObjectNumbers[i];
    while (objects.length < pageNum) objects.push("");
    const resourceParts = [`/Font << /F1 ${font1Number} 0 R /F2 ${font2Number} 0 R >>`];
    if (hasCover && i === 0 && imageNumber) resourceParts.push(`/XObject << /Im1 ${imageNumber} 0 R >>`);
    objects[pageNum - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << ${resourceParts.join(" ")} >> /Contents ${contentNum} 0 R >>`;
    const stream = contents[i];
    while (objects.length < contentNum) objects.push("");
    objects[contentNum - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  while (objects.length < font1Number) objects.push("");
  objects[font1Number - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[font2Number - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  if (hasCover && imageNumber && cover) {
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

export const renderRecipePdf = buildRecipePdf;
export const generateRecipePdf = buildRecipePdf;
export const createRecipePdf = buildRecipePdf;
export const recipeToPdf = buildRecipePdf;
export const exportRecipeToPdf = buildRecipePdf;
export const pdfFromRecipe = buildRecipePdf;
