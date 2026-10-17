"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";

const TABS = [
  { href: "/", label: "Receitas" },
  { href: "/minhas-receitas", label: "Minhas receitas" },
  { href: "/lista-de-compras", label: "Lista de compras" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader() {
  const pathname = usePathname();
  const { signedInEmail, isAuthBusy, signIn, signOut } = useAuth();

  return (
    <div className="site-shell app-header">
      <div className="topbar">
        <Link className="brand" href="/" aria-label="Recistep, início">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none">
              <path d="M11 8.5h18a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3v-17a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M14 15h12M14 20h8M14 25h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <path d="m24 25 2.5 2.5L32 21" stroke="#D5F06D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <span>reci<span className="brand-light">step</span></span>
        </Link>
        <div className="header-right">
          <div className="topbar-note"><span className="status-dot" /> Seu próximo prato começa aqui</div>
          {signedInEmail ? (
            <div className="header-user">
              <span title={signedInEmail}>{signedInEmail}</span>
              <button className="auth-secondary-button" type="button" onClick={() => void signOut()} disabled={isAuthBusy}>
                Sair
              </button>
            </div>
          ) : (
            <button className="auth-secondary-button" type="button" onClick={() => void signIn()} disabled={isAuthBusy}>
              {isAuthBusy ? "Conectando…" : "Entrar"}
            </button>
          )}
        </div>
      </div>
      <nav className="app-tabs" aria-label="Navegação principal">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={"app-tab" + (isActive(pathname, tab.href) ? " is-active" : "")}
            aria-current={isActive(pathname, tab.href) ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
