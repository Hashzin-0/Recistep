import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Recistep — receitas inteligentes",
    short_name: "Recistep",
    description: "Receitas, ingredientes e preparo organizados.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5ef",
    theme_color: "#f6f5ef",
    lang: "pt-BR",
    categories: ["food", "lifestyle"],
  };
}
