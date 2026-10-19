import * as React from "react";
import type { ReactNode } from "react";

type ViewTransitionClass = string | Record<string, string>;

export interface ViewTransitionProps {
  name?: string;
  default?: ViewTransitionClass;
  enter?: ViewTransitionClass;
  exit?: ViewTransitionClass;
  share?: ViewTransitionClass;
  update?: ViewTransitionClass;
  children?: ReactNode;
}

// O Next resolve `react` para o seu próprio build canário, que já exporta o
// `ViewTransition` (React 19.3). Os tipos publicados do `@types/react` ainda não
// o declaram, então lemos o símbolo em runtime e caímos num passthrough quando
// ele não existe (ex.: Vitest em ambiente node). Assim as transições são um
// enfeite progressivo e nunca quebram o typecheck nem os testes.
const ViewTransitionImpl = (
  React as unknown as { ViewTransition?: React.ComponentType<ViewTransitionProps> }
).ViewTransition;

export function ViewTransition({ children, ...props }: ViewTransitionProps) {
  if (ViewTransitionImpl) return <ViewTransitionImpl {...props}>{children}</ViewTransitionImpl>;
  return <>{children}</>;
}

// Props padrão do conteúdo de página: navegação direcional entre abas desliza
// (`nav-forward` / `nav-back`) e qualquer outra troca de rota faz um morph suave
// (`page-enter` / `page-exit`).
const PAGE_ENTER: ViewTransitionClass = {
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  default: "page-enter",
};
const PAGE_EXIT: ViewTransitionClass = {
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  default: "page-exit",
};

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default="none" enter={PAGE_ENTER} exit={PAGE_EXIT}>
      {children}
    </ViewTransition>
  );
}
