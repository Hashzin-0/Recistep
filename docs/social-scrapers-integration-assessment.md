# Análise de integração: drawrowfly Instagram Scraper e TikTok Scraper

Data da análise: 2026-10-17

## Fontes consultadas

- Instagram Scraper / InstaTouch: https://github.com/drawrowfly/instagram-scraper
- Código principal do Instagram: https://github.com/drawrowfly/instagram-scraper/blob/master/src/core/InstaTouch.ts
- README do Instagram: https://github.com/drawrowfly/instagram-scraper/blob/master/Readme.md
- TikTok Scraper: https://github.com/drawrowfly/tiktok-scraper
- Código principal do TikTok: https://github.com/drawrowfly/tiktok-scraper/blob/master/src/core/TikTok.ts
- README do TikTok: https://github.com/drawrowfly/tiktok-scraper/blob/master/README.md

O ambiente de execução não conseguiu fazer `git clone` por falha de resolução DNS para `github.com`. Para não bloquear a análise, os arquivos públicos relevantes foram obtidos diretamente pelas URLs de conteúdo/API do GitHub. Isso permitiu inspecionar READMEs, manifests e os módulos principais, mas não equivale a um clone local completo nem a executar os projetos upstream.

## Resumo executivo

**Não adicionar os dois projetos como dependências de produção nem transplantar seus motores inteiros para o Recistep.** A arquitetura atual do Recistep já possui conectores server-only por plataforma, validação de URL/host, fetch com limite de bytes/tempo/redirecionamentos, tipagem estrita, testes Vitest e um pipeline durável de importação. Os scrapers upstream são ferramentas antigas de coleta em lote/download, com dependências e pressupostos diferentes do fluxo de importação de uma URL de receita.

A integração recomendada é seletiva: usar os repositórios como referência técnica, manter o contrato `SourceConnector` e implementar somente parsers/fallbacks compatíveis com a arquitetura existente, acompanhados de testes de fixtures sem chamadas reais às plataformas.

## Instagram Scraper (InstaTouch)

- Manifesto consultado: versão `2.3.20`, licença declarada MIT.
- Código principal: TypeScript, classe `InstaTouch`, coleta de feeds e comentários, paginação, opções de sessão/proxy, downloads e saída em arquivos.
- O README esclarece que feeds de usuário/hashtag/localização e alguns recursos exigem sessão ativa. Portanto, a afirmação genérica de que não precisa de login não vale para todas as operações.
- Dependências centrais incluem `request`, `request-promise`, `bluebird`, `async`, `archiver` e bibliotecas de CLI/CSV. São dependências antigas; o desenho inclui downloads e gravação de arquivos, que não se encaixam diretamente em uma função serverless que precisa retornar um resultado tipado.
- A abordagem de Graph API não é um contrato oficial estável e pode falhar quando a plataforma muda ou aplica bloqueios.

### Aplicação segura ao Recistep

O conector existente em `lib/providers/sources/instagram.ts` já tenta obter metadados públicos e, quando possível, localizar mídia pública. Preservar esse conector e seu tratamento de indisponibilidade. A contribuição útil do upstream é servir como referência para formatos de metadados e limitações de sessão, não como dependência runtime.

Não introduzir cookies de sessão, rotação de proxies, coleta de seguidores/curtidas ou download em lote como parte da importação de receitas. Isso aumentaria o risco operacional e não é necessário para resolver uma URL individual.

## TikTok Scraper

- Manifesto consultado: versão `1.4.35`, licença declarada MIT.
- Código principal: TypeScript, classe `TikTokScraper` baseada em `EventEmitter`, coleta paginada de feeds por usuário/hashtag/trending/música, metadados de vídeo, sessões, proxies, histórico e download.
- Dependências incluem `request`, `request-promise`, `canvas`, `jsdom`, `bluebird`, `async` e `archiver`. `canvas` e as rotinas de download em filesystem são especialmente inadequadas para adicionar diretamente a uma aplicação Next.js/Vercel sem validar compatibilidade, tamanho e custo.
- O código depende de endpoints e estruturas internas da Web API do TikTok, que não são um contrato estável. O repositório upstream consultado é antigo; não assumir que endpoints, assinatura ou extração de vídeo continuam funcionando.
- O README upstream também documenta limitações e comportamento dependente de sessão para alguns métodos.

### Aplicação segura ao Recistep

O conector existente em `lib/providers/sources/tiktok.ts` já interpreta o payload público de reidratação da página, extrai descrição/autor/capa, tenta resolver uma URL de mídia validada e considera legendas WebVTT. Isso é mais próximo do fluxo do Recistep do que importar a classe upstream.

Preservar a seleção de conteúdo por prioridade e os limites de host. Usar fixtures derivadas de estruturas documentadas para aumentar a cobertura de parsers, sem guardar cookies, baixar feeds inteiros ou incorporar assinatura de requests do upstream sem uma necessidade e revisão específicas.

## Compatibilidade com a arquitetura existente

- **Runtime:** Next.js App Router em Node.js 22.x e hospedagem Vercel.
- **Fronteira:** conectores em `lib/providers/sources/`, todos server-only; registry em `registry.ts`.
- **Segurança de rede:** `safe-fetch.ts` limita protocolo/host, redirects, timeout e tamanho do documento; mídia passa por validação de host e probe.
- **Contrato:** `SourceConnector.resolve(url)` retorna `ResolvedSource` com metadados e um tipo explícito de conteúdo. Não contornar esse contrato com respostas específicas do scraper.
- **Pipeline:** o reconhecimento de URL não garante acesso à mídia. Se o conteúdo público não puder ser obtido, o fluxo atual pode solicitar transcrição ao usuário; não simular sucesso nem inventar dados.
- **Qualidade:** novos parsers precisam de testes unitários com HTML/JSON de fixture, incluindo payload ausente/malformado, redirecionamentos, URLs de CDN não permitidas, captions vazias e falhas temporárias.

## Integração realizada nesta etapa

1. **Instagram:** o conector mantém o oEmbed como primeira opção e agora tenta recuperar uma legenda de metadados HTML públicos (`og:description`, `description`, `twitter:description`) ou do formato legado `_sharedData` quando o oEmbed está indisponível. O texto continua limitado e não se aceita mídia sem allowlist e probe.
2. **TikTok:** o conector mantém o payload atual `__UNIVERSAL_DATA_FOR_REHYDRATION__` como primeira opção e agora reconhece também `SIGI_STATE.ItemModule`, selecionando o vídeo pelo ID da URL. As URLs de mídia continuam sujeitas à allowlist e ao probe existentes.
3. **Testes:** foram adicionados testes determinísticos para a legenda HTML do Instagram e para o payload legado do TikTok. Nenhum teste precisa acessar as plataformas reais.
4. **Dependências:** nenhum motor upstream ou dependência legada foi adicionado. Foram reutilizados somente formatos públicos de payload, preservando o contrato `SourceConnector` e a execução server-only.
5. **Validação pendente:** executar/confirmar `npm test`, `npm run typecheck` e `npm run build` no CI antes de merge. Não declarar que os scrapers upstream completos foram clonados nem que scraping externo está garantido.

## Conclusão

Os dois repositórios foram obtidos por meio do conteúdo público do GitHub para inspeção, mas não foram clonados localmente por indisponibilidade de DNS no ambiente. A integração de menor risco é aproveitar conhecimento sobre formatos e falhas comuns, sem incorporar os motores legados. O Recistep deve continuar com conectores pequenos, tipados, isolados no servidor e protegidos por allowlists, mantendo a alternativa de transcrição manual quando a plataforma não disponibilizar conteúdo público suficiente.

**Estado desta alteração:** os conectores Instagram e TikTok e seus testes foram alterados nesta branch. A integração é seletiva e baseada em formatos de payload; não é um transplante dos motores completos. O clone local upstream continua indisponível por falha DNS do ambiente.
