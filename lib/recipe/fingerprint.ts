import { createHash } from "node:crypto";
import type { RecipeExtraction } from "@/lib/schemas/recipe";

export function hashSourceUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.protocol = url.protocol.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    const id = url.searchParams.get("v");
    if (id) return sha256("youtube:video:" + id.trim());
  }
  if (url.hostname === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (id) return sha256("youtube:video:" + id.trim());
  }
  url.searchParams.sort();
  for (const key of ["si", "feature", "pp", "utm_source", "utm_medium", "utm_campaign"]) url.searchParams.delete(key);
  return sha256(url.toString().replace(/\/$/, ""));
}
export function hashSourceContent(content: string): string {
  return sha256(content.normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim());
}
export function fingerprintRecipe(recipe: RecipeExtraction): string {
  const canonical = {
    title: normalizeRecipeTitle(recipe.title),
    ingredients: recipe.ingredients.map((item) => ({ name: normalizeRecipeTitle(item.name), quantity: item.quantity, unit: normalizeRecipeTitle(item.unit ?? "") }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    steps: recipe.steps.map((step) => normalizeRecipeTitle(step.instruction)),
  };
  return sha256(JSON.stringify(canonical));
}
export function normalizeRecipeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
