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

## Plano recomendado de integração incremental

1. **Manter as implementações upstream fora das dependências de produção.** Registrar origem/licença e limitações, como feito neste documento.
2. **Comparar as estruturas de metadados** com os parsers já existentes antes de alterar comportamento. Não assumir que os formatos antigos seguem atuais.
3. **Implementar apenas fallback de metadados públicos** quando houver evidência de que melhora o caso de uso de uma URL individual; revalidar todas as URLs externas através de `safe-fetch.ts` e `platform-hosts.ts`.
4. **Adicionar testes de regressão antes de mudar o fluxo**: Instagram com oEmbed indisponível, TikTok sem bloco de reidratação, legendas ausentes, mídia expirada e página de login/bloqueio.
5. **Validar CI na ordem definida pelo projeto:** `npm test`, `npm run typecheck`, `npm run build`. Testes reais contra Instagram/TikTok são separados dos testes determinísticos e podem falhar por bloqueios externos; não usar isso como motivo para remover as proteções de segurança.
6. **Revisar comportamento e política de acesso** antes de adicionar sessões autenticadas, proxies ou extração de feeds em lote.

## Conclusão

Os dois repositórios foram obtidos por meio do conteúdo público do GitHub para inspeção, mas não foram clonados localmente por indisponibilidade de DNS no ambiente. A integração de menor risco é aproveitar conhecimento sobre formatos e falhas comuns, sem incorporar os motores legados. O Recistep deve continuar com conectores pequenos, tipados, isolados no servidor e protegidos por allowlists, mantendo a alternativa de transcrição manual quando a plataforma não disponibilizar conteúdo público suficiente.

**Estado desta alteração:** documentação de análise adicionada; nenhum código de runtime, dependência, segredo, migration ou comportamento de produção foi alterado nesta etapa.
