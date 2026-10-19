import Link from "next/link";
import { PageTransition } from "@/components/view-transition";

export default function OfflinePage() {
  return <PageTransition><main className="offline-page">
    <div className="offline-mark" aria-hidden="true">R</div>
    <p className="kitchen-eyebrow">Recistep · modo offline</p>
    <h1>Você está sem conexão.</h1>
    <p>O Recistep não armazena páginas privadas nem respostas da API para uso offline. Volte à receita já aberta no seu dispositivo ou reconecte-se para carregar suas receitas salvas.</p>
    <Link href="/">Tentar novamente</Link>
  </main></PageTransition>;
}
