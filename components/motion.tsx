"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Camada de movimento do Recistep (filosofia determinística, sem dependências).
 *
 * O conteúdo é visível por padrão; só depois que este componente monta o
 * `html.js` é que os estados iniciais animados se aplicam. Assim nada some se
 * o JavaScript falhar e `prefers-reduced-motion` mantém o estado final.
 *
 * O componente vive no layout, que persiste entre rotas, então re-escaneia o
 * DOM a cada navegação para alcançar os `[data-reveal]` das novas páginas.
 */
export function Motion() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("js");

    const targets = document.querySelectorAll("[data-reveal], [data-lines]");

    if (typeof IntersectionObserver === "undefined") {
      targets.forEach((element) => element.classList.add("is-in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
    );

    targets.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
