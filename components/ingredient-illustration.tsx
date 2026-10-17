"use client";

import type { ReactNode } from "react";

type IngredientKind =
  | "sugar" | "milk-carton" | "milk" | "mint" | "vanilla" | "banana"
  | "butter" | "honey" | "cinnamon" | "lemon" | "orange" | "strawberry"
  | "apple" | "egg" | "flour" | "meat" | "fish" | "tomato" | "carrot"
  | "onion" | "garlic" | "potato" | "greens" | "rice" | "beans" | "oil"
  | "chocolate" | "salt" | "generic";

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

function classifyIngredient(name: string): IngredientKind {
  const value = normalize(name);
  // Order matters: compound dairy products and specific spices must win over broad matches.
  if (/\b(leite condensado|condensed milk|leite em po|powdered milk|leite de coco|coconut milk)\b/.test(value)) return "milk-carton";
  if (/\b(acucar|acucar mascavo|acucar refinado|acucar cristal|acucar demerara|sugar|sweetener|adocante)\b/.test(value)) return "sugar";
  if (/\b(fava de baunilha|baunilha|vanilla pod|vanilla bean|vanilla)\b/.test(value)) return "vanilla";
  if (/\b(hortela|menta|mint)\b/.test(value)) return "mint";
  if (/\b(banana|bananas)\b/.test(value)) return "banana";
  if (/\b(manteiga|butter)\b/.test(value)) return "butter";
  if (/\b(mel|honey)\b/.test(value)) return "honey";
  if (/\b(canela|cinnamon)\b/.test(value)) return "cinnamon";
  if (/\b(limao|lemon)\b/.test(value)) return "lemon";
  if (/\b(laranja|orange)\b/.test(value)) return "orange";
  if (/\b(morango|strawberry)\b/.test(value)) return "strawberry";
  if (/\b(maca|apple)\b/.test(value)) return "apple";
  if (/\b(ovo|ovos|egg|eggs)\b/.test(value)) return "egg";
  if (/\b(leite|milk|creme de leite|creme|iogurte|queijo|cream|yogurt|cheese)\b/.test(value)) return "milk";
  if (/\b(farinha|trigo|amido|fermento|flour|starch|yeast)\b/.test(value)) return "flour";
  if (/\b(frango|carne|bacon|beef|chicken|pork)\b/.test(value)) return "meat";
  if (/\b(peixe|sardinha|atum|fish|tuna)\b/.test(value)) return "fish";
  if (/\b(tomate|tomato)\b/.test(value)) return "tomato";
  if (/\b(cenoura|carrot)\b/.test(value)) return "carrot";
  if (/\b(cebola|onion)\b/.test(value)) return "onion";
  if (/\b(alho|garlic)\b/.test(value)) return "garlic";
  if (/\b(batata|potato)\b/.test(value)) return "potato";
  if (/\b(legume|verdura|vegetal|folhas|vegetable|greens)\b/.test(value)) return "greens";
  if (/\b(arroz|rice)\b/.test(value)) return "rice";
  if (/\b(feijao|lentilha|grao de bico|bean|lentil|chickpea)\b/.test(value)) return "beans";
  if (/\b(oleo|azeite|olive oil)\b/.test(value)) return "oil";
  if (/\b(chocolate|cacau|cocoa)\b/.test(value)) return "chocolate";
  if (/\b(sal|salt)\b/.test(value)) return "salt";
  return "generic";
}

function Illustration({ kind }: { kind: IngredientKind }): ReactNode {
  const common = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "sugar": return <><path d="M7 9 12 6l5 3-5 3-5-3Z" fill="#fff4d6" stroke="#b78b4c"/><path d="m7 9 5 3 5-3v6l-5 3-5-3V9Z" fill="#f4e5bd" stroke="#b78b4c"/><path d="m10 8 2-1m1 4 2-1m-6 4 2 1" stroke="#fff" strokeWidth="1.3"/></>;
    case "milk-carton": return <><path d="M7 7 11 3h5l2 4v13H7V7Z" fill="#f8fafc" stroke="#7c9bb4" strokeWidth="1.6"/><path d="M7 7h11M11 3l1 4" fill="none" stroke="#7c9bb4" strokeWidth="1.6"/><path d="M8 12h9v5H8z" fill="#b9e2f5"/><path d="M10 14h5" stroke="#5c9ab9" strokeWidth="1.4"/></>;
    case "milk": return <><path d="M7 5h10l-1 15H8L7 5Z" fill="#d9f0fb" stroke="#6b9bb7" strokeWidth="1.6"/><path d="M7 5c2 2 8 2 10 0M9 10c2 1 4 1 6 0" fill="none" stroke="#fff" strokeWidth="1.6"/></>;
    case "mint": return <><path d="M12 20V7" {...common}/><path d="M12 14C3 15 3 7 4 5c6 0 9 3 8 9Z" fill="#9ad6a2" stroke="#43885b" strokeWidth="1.5"/><path d="M12 11c0-6 5-8 9-7 1 6-2 10-9 10" fill="#c0e8a8" stroke="#43885b" strokeWidth="1.5"/><path d="m6 7 6 7m7-8-7 7" stroke="#43885b" strokeWidth="1"/></>;
    case "vanilla": return <><path d="M7 4c5 4 3 11 10 16" fill="none" stroke="#78502f" strokeWidth="4" strokeLinecap="round"/><path d="M15 3c-2 5-1 11-5 17" fill="none" stroke="#a97844" strokeWidth="3.5" strokeLinecap="round"/><path d="M6 5c2 1 3 2 4 4m2 4 2 2m-5 2 2 2" stroke="#e8c18b" strokeWidth="1"/></>;
    case "banana": return <><path d="M4 5c3 9 8 12 16 9-2 5-7 7-12 4C4 15 2 9 4 5Z" fill="#ffdb55" stroke="#bc8a23" strokeWidth="1.5"/><path d="M4 5 3 3m17 11 1-2" stroke="#6b5834" strokeWidth="2" strokeLinecap="round"/></>;
    case "butter": return <><path d="m4 10 12-4 5 3-12 4-5-3Z" fill="#fff0a3" stroke="#c4a34e" strokeWidth="1.5"/><path d="M4 10v6l5 4v-7m0 7 12-4V9" fill="#f6d96b" stroke="#c4a34e" strokeWidth="1.5"/></>;
    case "honey": return <><path d="M9 4h6v3l3 3v9H6v-9l3-3V4Z" fill="#f7c34b" stroke="#b57923" strokeWidth="1.5"/><path d="M8 12h8v4H8z" fill="#fff0a1" stroke="#b57923" strokeWidth="1"/><path d="M10 2h4v2h-4z" fill="#d9a33b" stroke="#b57923"/></>;
    case "cinnamon": return <><path d="M5 6 17 3l2 3L7 9 5 6Zm1 5 12-3 2 3-12 3-2-3Zm2 5 10-3 2 3-10 3-2-3Z" fill="#bc8150" stroke="#87552f" strokeWidth="1.4"/><path d="m16 4 2 2m-1 3 2 2m-2 3 2 2" stroke="#e7bb8b" strokeWidth="1.2"/></>;
    case "lemon": return <><path d="M4 12c2-6 12-9 16 0-4 9-14 6-16 0Z" fill="#ffe56b" stroke="#bda02a" strokeWidth="1.5"/><path d="M12 5c1-2 3-2 4-2" stroke="#4f9852" strokeWidth="2"/></>;
    case "orange": return <><circle cx="12" cy="12" r="8" fill="#ffb45c" stroke="#c8752b" strokeWidth="1.5"/><path d="M12 4c1-2 3-2 4-2m-4 10 0-8m0 8 6-4m-6 4 5 5m-5-5-5 5m5-5-6-4" stroke="#ffe2ad" strokeWidth="1.2"/></>;
    case "strawberry": return <><path d="M4 8c4-5 12-5 16 0-1 7-5 12-8 13-3-1-7-6-8-13Z" fill="#f66a73" stroke="#bd3f4b" strokeWidth="1.5"/><path d="M12 7 9 3m3 4 4-4m-4 4-5-1" stroke="#4d9b5c" strokeWidth="2"/><path d="m8 10 1 1m6 1 1 1m-5 3 1 1" stroke="#ffe5a6" strokeWidth="1.5"/></>;
    case "apple": return <><path d="M12 7c-7-5-12 3-7 10 3 5 5 3 7 2 2 1 4 3 7-2 5-7 0-15-7-10Z" fill="#ef6662" stroke="#b94242" strokeWidth="1.5"/><path d="M12 7c-1-3 1-5 3-5m-2 4c2-3 5-2 6-1-1 3-3 4-6 3" fill="#75bd70" stroke="#4a8e4e" strokeWidth="1.3"/></>;
    case "egg": return <><path d="M12 3c-4 0-7 7-7 11a7 7 0 0 0 14 0c0-4-3-11-7-11Z" fill="#fff5d9" stroke="#cbbd9a" strokeWidth="1.5"/></>;
    case "flour": return <><path d="M5 8h14l-1 12H6L5 8Z" fill="#f5eee0" stroke="#b8a98e" strokeWidth="1.5"/><path d="M5 8c1-4 13-4 14 0M8 12h8m-7 3h6" fill="none" stroke="#c9b99b" strokeWidth="1.3"/></>;
    case "meat": return <><path d="M5 7c4-4 7 0 10-1 4-1 7 3 4 7-2 4-9 7-13 3-3-2-3-6-1-9Z" fill="#ee9b9b" stroke="#b55d65" strokeWidth="1.5"/><circle cx="14" cy="11" r="2.5" fill="#fff0e7" stroke="#b55d65" strokeWidth="1.2"/></>;
    case "fish": return <><path d="M4 12 2 7l6 2c4-4 9-3 12 3-3 6-8 7-12 3l-6 2 2-5Z" fill="#a9d8e8" stroke="#528da5" strokeWidth="1.5"/><circle cx="15" cy="11" r="1" fill="#345968"/></>;
    case "tomato": return <><circle cx="12" cy="13" r="8" fill="#f36f5f" stroke="#b94639" strokeWidth="1.5"/><path d="m12 5 2-3-1 4 4-2-2 4-4-1-4 1 1-3 3 2Z" fill="#65a95d" stroke="#47864a" strokeWidth="1.2"/></>;
    case "carrot": return <><path d="m6 7 13 2-7 12L6 7Z" fill="#f8a44b" stroke="#bf6e29" strokeWidth="1.5"/><path d="M10 6 8 3m4 3 2-4m-1 5 5-3M8 11l4 1m-2 2 3 1" stroke="#4f9852" strokeWidth="1.6"/></>;
    case "onion": return <><path d="M12 3c1 3 7 5 7 11a7 7 0 0 1-14 0c0-6 6-8 7-11Z" fill="#d6b6e5" stroke="#9169aa" strokeWidth="1.5"/><path d="M12 5v13m-4-9c-2 4-1 7 2 9m6-9c2 4 1 7-2 9" fill="none" stroke="#aa85bf" strokeWidth="1.2"/></>;
    case "garlic": return <><path d="M12 5c-2 3-7 4-7 9a7 7 0 0 0 14 0c0-5-5-6-7-9Z" fill="#f4ead2" stroke="#b9a98b" strokeWidth="1.5"/><path d="M12 5V2m0 6c-2 3-3 6-2 10m2-10c2 3 3 6 2 10" fill="none" stroke="#b9a98b" strokeWidth="1.3"/></>;
    case "potato": return <><path d="M4 10c0-5 6-7 11-5s7 7 4 12-12 5-15 0c-1-2-1-5 0-7Z" fill="#d6ad73" stroke="#987044" strokeWidth="1.5"/><circle cx="9" cy="9" r=".8" fill="#987044"/><circle cx="16" cy="14" r=".8" fill="#987044"/><circle cx="11" cy="17" r=".8" fill="#987044"/></>;
    case "greens": return <><path d="M12 20V8m0 7C3 16 3 8 4 5c6 0 9 3 8 10Zm0-4c0-6 5-8 9-7 1 6-2 10-9 10" fill="#9dd9a2" stroke="#4c9558" strokeWidth="1.5"/></>;
    case "rice": return <><path d="M4 12h16l-2 7H6l-2-7Z" fill="#9bc9e6" stroke="#5889a6" strokeWidth="1.5"/><path d="M5 12c1-5 13-5 14 0" fill="#fff9e8" stroke="#b8a98b" strokeWidth="1.4"/><path d="m8 10 1-2m3 2 1-3m2 3 1-2" stroke="#c5b99f" strokeWidth="1.4"/></>;
    case "beans": return <><path d="M5 6c4-3 8 2 6 6s-7 8-9 3 0-7 3-9Zm10 2c4-3 8 2 6 6s-7 8-9 3 0-7 3-9Z" fill="#bd8a62" stroke="#875b3e" strokeWidth="1.4"/><path d="M5 8c2 1 3 3 2 5m10-3c2 1 3 3 2 5" fill="none" stroke="#e7c5a3" strokeWidth="1.3"/></>;
    case "oil": return <><path d="M9 3h6v3l3 3v11H6V9l3-3V3Z" fill="#e6d76b" stroke="#a99a38" strokeWidth="1.5"/><path d="M9 3h6m-8 9h10v5H7z" fill="#a8c86e" stroke="#829c45" strokeWidth="1.1"/></>;
    case "chocolate": return <><path d="M5 5h14v14H5z" fill="#8b553e" stroke="#603827" strokeWidth="1.5"/><path d="M12 5v14M5 12h14" stroke="#c18a69" strokeWidth="1.5"/><path d="M7 7h3v3H7zm7 0h3v3h-3zm-7 7h3v3H7zm7 0h3v3h-3z" fill="#a86c4f"/></>;
    case "salt": return <><path d="M8 7h8l2 13H6L8 7Z" fill="#f3f5f7" stroke="#9aa6b2" strokeWidth="1.5"/><path d="M9 3h6v4H9z" fill="#b6c0c9" stroke="#7d8a96" strokeWidth="1.3"/><path d="M10 5h.1m2-.1h.1m2 .1h.1" stroke="#fff" strokeWidth="1.5"/></>;
    default: return <><path d="M4 10h16l-2 9H6l-2-9Z" fill="#e8edf0" stroke="#9ba8b1" strokeWidth="1.5"/><path d="M5 10c1-5 13-5 14 0" fill="#fff" stroke="#9ba8b1" strokeWidth="1.5"/><path d="M8 13h8" stroke="#c3ccd2" strokeWidth="1.3"/></>;
  }
}

export function IngredientIllustration({ name }: { name: string }) {
  const kind = classifyIngredient(name);
  const labels: Record<IngredientKind, string> = {
    sugar: "Açúcar", "milk-carton": "Embalagem de leite ou leite condensado", milk: "Leite ou laticínio",
    mint: "Hortelã", vanilla: "Fava de baunilha", banana: "Banana", butter: "Manteiga",
    honey: "Mel", cinnamon: "Canela", lemon: "Limão", orange: "Laranja", strawberry: "Morango",
    apple: "Maçã", egg: "Ovo", flour: "Farinha", meat: "Carne", fish: "Peixe", tomato: "Tomate",
    carrot: "Cenoura", onion: "Cebola", garlic: "Alho", potato: "Batata", greens: "Verduras",
    rice: "Arroz", beans: "Feijão ou leguminosas", oil: "Óleo ou azeite", chocolate: "Chocolate",
    salt: "Sal", generic: "Ingrediente",
  };
  return (
    <svg className="ingredient-illustration" viewBox="0 0 24 24" role="img" aria-label={labels[kind]} focusable="false">
      <Illustration kind={kind} />
    </svg>
  );
}
