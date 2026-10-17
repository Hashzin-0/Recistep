import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Recistep — receitas inteligentes",
    short_name: "Recistep",
    description: "Receitas, ingredientes e preparo organizados.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f5ef",
    theme_color: "#f6f5ef",
    lang: "pt-BR",
    icons: [{ src: "/icons/recistep.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    categories: ["food", "lifestyle"],
  };
}
