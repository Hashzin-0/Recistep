import Link from "next/link";

export default function OfflinePage() {
  return <main className="offline-page">
    <div className="offline-mark" aria-hidden="true">R</div>
    <p className="kitchen-eyebrow">RECISTEP · MODO OFFLINE</p>
    <h1>Você está sem conexão.</h1>
    <p>O Recistep não armazena páginas privadas nem respostas da API para uso offline. Volte à receita já aberta no seu dispositivo ou reconecte-se para carregar suas receitas salvas.</p>
    <Link href="/">Tentar novamente</Link>
  </main>;
}
