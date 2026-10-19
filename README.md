# Recistep

Aplicativo web responsivo/PWA para organizar receitas a partir de fontes culinárias, estruturar ingredientes e etapas, ajustar porções e planejar o preparo.

## Extração pública de Instagram e TikTok

A extração usa os conectores TypeScript do próprio Recistep, sem serviço externo pago, token de scraper ou servidor Python separado. O TikTok é analisado pelo HTML público de reidratação e tenta obter o vídeo do CDN e, como alternativa, legendas WebVTT. O Instagram usa o oEmbed público para metadados/legenda e tenta encontrar uma URL de vídeo em metadados HTML públicos quando a página os disponibiliza.

Esses métodos são best-effort: as plataformas podem exigir login, bloquear tráfego de servidor ou alterar seu HTML/CDN. Conteúdo privado, removido ou protegido não é contornado. Se o vídeo não estiver acessível, o fluxo existente pode usar uma legenda pública suficiente ou solicitar uma transcrição fornecida pelo usuário. Nenhuma API paga nem configuração adicional é necessária para ativar os conectores.


## Estado implementado nesta branch

- Next.js App Router, React, TypeScript, Zod e Vitest.
- Validação de URL sem buscar a mídia na rota HTTP.
- Schema de extração de receita com validação estrita e utilitário determinístico de escala de porções.
- Migração Supabase com importações, receitas, ingredientes, etapas e políticas RLS por proprietário.
- Adaptador REST server-only para validar tokens Supabase e persistir importações usando a chave de serviço apenas no servidor.
- Workflow durável Inngest para análise de vídeos públicos do YouTube e extração de transcrições.
- Conector YouTube oEmbed para metadados públicos e análise de vídeos públicos diretamente pela API Gemini. O Recistep não baixa o vídeo por conta própria; o recurso de URL do YouTube na API Gemini está em prévia e só aceita vídeos públicos.
- Conectores de conteúdo Instagram e TikTok por métodos públicos best-effort: Instagram usa o oEmbed para legenda/metadados e tenta localizar vídeo em metadados HTML públicos; TikTok analisa o HTML de reidratação, tenta o CDN e usa legendas WebVTT como alternativa.
- Extração estruturada Gemini, com schema de saída e validação Zod posterior.
- Interface de autenticação Supabase (entrar/criar conta), envio de importação e acompanhamento de estado.
- Interface de envio de transcrição fornecida pelo usuário e visualização do rascunho gerado, necessário quando não há conector autorizado para conteúdo.
- A importação não vira receita confirmada automaticamente: o resultado Gemini permanece em `review_required`.

**Limite importante:** o projeto Supabase Recistep não foi provisionado/configurado neste ambiente. A migração está versionada no repositório, mas ainda precisa ser aplicada ao projeto Supabase dedicado. Não há credenciais reais de Supabase, Gemini ou Inngest no repositório. Não declare a aplicação operacional até configurar os serviços e validar a execução.

## Desenvolvimento local

Requer Node.js 22 ou superior.

```bash
npm install
npm run dev
```

Para verificar:

```bash
npm test
npm run typecheck
npm run build
```

## Fluxo API atual

### Iniciar importação

`POST /api/v1/imports`

Requer cabeçalho `Authorization: Bearer <Supabase access token>`. O corpo aceita:

```json
{
  "source_url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "locale": "pt-BR",
  "servings_target": 4
}
```

Opcionalmente envie `Idempotency-Key` para permitir repetição segura da mesma solicitação. A API responde `202` somente após persistir o registro e a fila confirmar o evento. A chave de serviço Supabase nunca deve ser enviada ao navegador.

### Consultar estado

`GET /api/v1/imports/{id}`

Requer autenticação e retorna apenas o registro pertencente ao usuário autenticado; a transcrição bruta não é retornada.

### Fornecer transcrição autorizada

`POST /api/v1/imports/{id}/transcript`

Requer autenticação e JSON `{"transcript":"..." }` com 80 a 80.000 caracteres. A transcrição é guardada temporariamente no banco para o worker; após extração bem-sucedida ou erro terminal, é apagada. O evento Inngest contém apenas o ID, não o texto da transcrição.

### Revisar e confirmar uma receita

Quando uma importação chega ao estado `review_required`, o rascunho pode ser editado e salvo:

`PATCH /api/v1/imports/{id}/review`

O corpo é a receita estruturada completa e deve passar pelo schema Zod estrito. O endpoint exige token Supabase válido, titularidade da importação e estado `review_required`.

A confirmação explícita usa:

`POST /api/v1/imports/{id}/confirm`

O corpo contém a versão revisada. Uma função PostgreSQL transacional grava a receita, os ingredientes e as etapas e atualiza a importação para `completed`. Repetir a confirmação da mesma importação retorna a receita já criada em vez de duplicá-la. A migration `supabase/migrations/20261017114621_recipe_review_confirmation.sql` precisa estar aplicada no projeto Supabase antes de ativar este fluxo.

### Estados relevantes

- `queued`: registro persistido e evento agendado.
- `processing`: worker em execução.
- `source_content_required`: metadados públicos podem estar disponíveis, mas falta conteúdo de receita obtido por método autorizado.
- `review_required`: Gemini produziu rascunho estruturado; revisão humana é obrigatória.
- `failed`: falha terminal ou impossibilidade de agendar o evento.

O Recistep consulta o endpoint público oEmbed e, quando Gemini está configurado, envia a URL pública do YouTube à API Gemini para análise multimodal. Se o vídeo não puder ser processado, a interface solicita uma transcrição autorizada. Para Instagram, o conector tenta primeiro obter metadados públicos de vídeo no HTML e valida a URL de mídia antes de usá-la; se a plataforma bloquear a página, usa a legenda pública do oEmbed quando suficiente. Para TikTok, o CDN é tentado como best-effort e, se recusar, a fala é lida da trilha de legendas WebVTT pública. Não há scraping, bypass de controles de acesso nem dados simulados. A interface permite entrar/criar conta, acompanhar a importação, fornecer transcrição, revisar e confirmar a receita, ajustar porções e gerar lista de compras persistida.

## Login com Google pelo Supabase

O login da interface usa `supabase.auth.signInWithOAuth({ provider: "google" })` e retorna à origem atual da aplicação. Para ativá-lo no projeto Supabase:

1. No Supabase Dashboard, abra **Authentication → Sign In / Providers → Google** e habilite Google.
2. Cadastre no Google Cloud um OAuth Client ID do tipo **Web application**. Em **Authorized redirect URIs**, use o callback exibido na configuração do provedor Supabase (normalmente `https://<project-ref>.supabase.co/auth/v1/callback`).
3. Insira o Client ID e o Client Secret no provedor Google do Supabase; não os coloque em variáveis `NEXT_PUBLIC_*`.
4. Em **Authentication → URL Configuration → Redirect URLs**, permita a URL de produção do Recistep e `http://localhost:3000/**` para desenvolvimento. Adicione URLs de preview apenas se quiser testar OAuth em previews.
5. Confirme que a Site URL do Supabase aponta para a origem de produção correta.

O código não consegue ativar o provedor Google sem as credenciais OAuth do proprietário do projeto. Se o provedor estiver desabilitado ou as URLs não estiverem na allowlist, a interface mostrará uma mensagem de configuração.

## Assistente de voz (Gemini Live)

O Recistep inclui um agente de voz baseado na Gemini Live API, com dois contextos independentes de sessão:

- **Edição da receita**: durante a revisão, o agente altera nome, descrição, porções, ingredientes e etapas por voz. Toda alteração passa pelo mesmo schema Zod da revisão e nada é salvo até o usuário tocar em “Confirmar receita”.
- **Modo cozinha**: depois de confirmada, o agente lê a receita, conduz uma etapa por vez, confere ingredientes e cuida do temporizador, avisando quando o tempo termina. O progresso continua salvo somente no `localStorage` do dispositivo.

Como funciona:

- `POST /api/v1/voice/token` emite um token efêmero de sessão (um uso, validade máxima de 30 minutos) que autoriza o navegador a abrir o WebSocket `BidiGenerateContentConstrained`. O endpoint exige token Supabase válido e aplica rate limit de 10 emissões por 10 minutos por usuário; `GEMINI_API_KEY` não sai do servidor.
- O áudio sai do microfone em PCM 16 kHz e o modelo responde em PCM 24 kHz. Não há captura de vídeo e o Recistep não grava áudio.
- As declarações de função declaradas para o agente usam `behavior: "NON_BLOCKING"`, exigido pelo modelo `gemini-3.8-live-extended-thinking`.
- Requer navegador com `getUserMedia` (Chrome, Edge ou Safari recente). Use fones de ouvido para evitar eco.
- A interface é um HUD flutuante no canto inferior direito, desenhado em canvas 2D (sem dependências novas): conectado, mostra só o orb, que pulsa com a voz — toque para encerrar a conversa e segure para silenciar o microfone; desconectado, mostra o orb parado com o botão “Ativar assistente de voz”. O orb respeita `prefers-reduced-motion` e pausa quando a aba fica oculta.

Código: `lib/voice/` (configuração, sessão, áudio, ferramentas, prompts e geometria do orb em `orb-visuals.ts`), `app/api/v1/voice/token/route.ts` (token) e `components/voice-orb.tsx` + `components/voice-assistant-hud.tsx` (interface).

## Configuração de ambiente

Copie `.env.example` para `.env.local` e configure valores reais. As variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` são públicas e usadas apenas pelo cliente de Auth; mantenha `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` e chaves Inngest exclusivamente no servidor. Configure também as opções de confirmação de e-mail e URLs de redirecionamento no Supabase Auth. Em desenvolvimento local, use o Inngest Dev Server e `INNGEST_DEV=1`.

## Fallback de modelos (Gemini → OpenRouter)

A extração de receitas e a geração de fluxograma tentam primeiro os modelos Gemini configurados e, somente quando **todos** falham, recorrem ao OpenRouter. Não há fallback silencioso: cada tentativa é registrada (`[ai-provider] ...`) com provedor e modelo, e o fallback é explicitamente habilitado por ambiente.

- `GEMINI_MODELS` (opcional): lista ordenada de modelos Gemini separada por vírgulas. Se definida, cada modelo é tentado em sequência. Se ausente, usa-se `GEMINI_MODEL` ou, quando este também não está definido, a lista padrão embutida — todos modelos multimodais `generateContent` do catálogo oficial (https://ai.google.dev/gemini-api/docs/models), do mais capaz ao mais econômico: `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` e o alias `gemini-flash-latest`.
- `GEMINI_MODEL` (opcional): sobrescreve a lista padrão com um único modelo.
- `OPENROUTER_API_KEY` (opcional, server-only): habilita o fallback. Sem ela, o último erro do Gemini é propagado como antes.
- `OPENROUTER_MODEL` (opcional): padrão `openrouter/free`, o roteador gratuito do OpenRouter que escolhe automaticamente um modelo free compatível com as modalidades de entrada do pedido (texto/imagem/vídeo/áudio) e com saída estruturada. Não é feita consulta extra à API de modelos: o próprio roteador aplica o filtro de capacidade.

Para mídia de plataformas (TikTok/Instagram) já enviada ao Gemini Files API, o fallback baixa novamente o vídeo (mesma allowlist de host e limite de tamanho) e o envia inline, porque uma URI do Gemini Files não pode ser resolvida por outro provedor. URLs do YouTube vão como `video_url`.

Para o assistente de voz, além de `GEMINI_API_KEY`, são opcionais: `GEMINI_LIVE_MODEL` (padrão `gemini-3.8-live-extended-thinking`), `GEMINI_LIVE_VOICE` (padrão `Puck`) e `GEMINI_LIVE_TOKEN_TTL_MINUTES` (padrão 30, limitado a 1 a 30).

## Migração Supabase

O arquivo `supabase/migrations/20261016000100_recistep_core.sql` cria as tabelas e políticas RLS. Revise e aplique somente no projeto dedicado ao Recistep. A execução da migração e os testes de advisors ainda não foram confirmados.

## Plano técnico

O plano detalhado de 14 critérios está em [plano.md](./plano.md). Ele distingue implementação real de itens pendentes.


## Hash de receita, deduplicação e cache

- source_url_hash: SHA-256 da URL canônica; links do YouTube watch?v= e youtu.be do mesmo vídeo geram o mesmo hash.
- recipe_fingerprint: SHA-256 determinístico do título, ingredientes, quantidades/unidades e etapas normalizados.
- recipe_cache armazena apenas rascunhos estruturados derivados de fontes públicas elegíveis; não armazena mídia bruta, credenciais nem transcrições privadas fornecidas pelo usuário.
- A busca tenta primeiro cache em memória (TTL de 5 minutos, LRU de até 500 chaves) e depois o Data Cache do Next.js (TTL de 1 hora), antes de consultar o Supabase. Escritas invalidam a tag do cache.
- Uma URL já conhecida pode receber o rascunho persistido sem chamar Gemini. No worker, títulos normalizados idênticos também podem reutilizar o rascunho; o fingerprint completo é guardado para identificar receitas iguais após extração. Títulos genéricos curtos são ignorados para reduzir colisões.
- O cache é uma otimização, não a fonte final da receita confirmada: cada usuário ainda confirma a receita na própria conta.

## Abas de navegação e CRUD de receitas

A interface agora é dividida em quatro abas por rota, com um cabeçalho compartilhado (`components/app-header.tsx`) e estado de autenticação em contexto (`components/auth-provider.tsx`):

- **Receitas** (`/`): importação de links, revisão, confirmação, modo cozinha e o botão para criar uma receita manualmente.
- **Minhas receitas** (`/minhas-receitas`): lista das receitas salvas do usuário autenticado — somente o dono tem acesso. Abre o detalhe (`/minhas-receitas/{id}`), inicia o preparo (modo cozinha), edita (`/minhas-receitas/{id}/editar`) e exclui.
- **Temporizadores** (`/temporizadores`): reúne os temporizadores criados no modo cozinha, com contagem em tempo real, pausa, retomada e remoção. O modo cozinha continua criando os timers, que aparecem automaticamente nesta aba e também podem ser controlados por voz.
- **Lista de compras** (`/lista-de-compras`): lista as listas do usuário, cria uma nova a partir das receitas salvas selecionadas, marca itens comprados e exclui listas.

Endpoints:

- `GET /api/v1/recipes` lista as receitas confirmadas do usuário.
- `POST /api/v1/recipes` cria uma receita manual (valida pelo schema Zod estrito; rate limit por usuário).
- `GET /api/v1/recipes/{id}` retorna a receita com ingredientes e etapas (apenas do próprio usuário).
- `PATCH /api/v1/recipes/{id}` substitui ingredientes e etapas de forma atômica.
- `DELETE /api/v1/recipes/{id}` exclui a receita (cascata em ingredientes e etapas).
- `GET /api/v1/shopping-lists` lista as listas do usuário.
- `DELETE /api/v1/shopping-lists/{id}` exclui a lista.

A migração `supabase/migrations/20261017150000_recipe_crud.sql` cria as funções transacionais `create_manual_recipe` e `update_recipe` usadas pela API. Ela ainda precisa ser aplicada ao projeto Supabase dedicado antes de ativar o CRUD manual.

## Planejamento e lista de compras

- O ajuste de porções usa a função determinística scaleIngredients, preserva ingredientes sem quantidade e não converte unidades incompatíveis.
- POST /api/v1/shopping-lists cria uma lista a partir de uma ou mais receitas confirmadas do próprio usuário.
- GET /api/v1/shopping-lists lista as listas e GET /api/v1/shopping-lists/{id} consulta a lista pertencente ao usuário.
- PATCH /api/v1/shopping-lists/{id}/items/{itemId} persiste a marcação de item comprado. DELETE /api/v1/shopping-lists/{id} exclui a lista.
- A consolidação agrupa apenas nomes normalizados com unidade igual; itens sem quantidade conhecida não recebem soma inventada. Cada item guarda IDs das receitas e dos ingredientes de origem.
- As migrations 20261017120637_recipe_cache_and_shopping.sql e 20261017120831_recipe_cache_service_policy.sql criam o cache, hashes, listas, itens, políticas RLS e função transacional de criação da lista.


## Camadas, capa, avaliações e fluxograma

A ficha de receita permite separar ingredientes em camadas nomeadas (por exemplo, **Massa**, **Calda**, **Recheio** e **Banho-maria**). A extração Gemini atribui uma camada quando a fonte a explicita; receitas antigas ou fontes sem separação usam **Ingredientes**. A camada é editável e persistida no banco.

Na página de detalhe da receita:
- ingredientes são exibidos com ícones visuais por tipo de ingrediente;
- o proprietário pode enviar uma capa JPG, PNG ou WebP de até 8 MB;
- a capa também pode ser escolhida no próprio rascunho (arquivo, transcrição, link e criação manual), antes de salvar; o upload é feito automaticamente logo após a receita ser criada;
- ao importar um PDF, a maior imagem embutida (ignorando ícones e máscaras) é extraída no servidor e pré-selecionada como capa do rascunho; se nenhuma imagem compatível existir, a capa fica em aberto;
- o proprietário pode avaliar de 1 a 5 estrelas, com média e quantidade de avaliações;
- o botão **Gerar fluxograma do preparo** solicita ao modelo de imagem um infográfico das etapas salvas e guarda o resultado no bucket Supabase Storage `recipe-media`.

### Ativação das mudanças

As migrations abaixo estão versionadas no repositório e já foram aplicadas ao projeto Supabase Recistep conectado:
- `supabase/migrations/20261017170000_recipe_layers_media_ratings.sql`
- `supabase/migrations/20261017170100_recipe_confirmation_layers.sql`

As migrations alteram `ingredients` e `recipes`, criam `recipe_ratings`, configuram políticas RLS por usuário, indexam avaliações e permitem SVG no bucket público `recipe-media`. As imagens de capa e fluxogramas ficam acessíveis por URL pública do Storage; não envie fotos privadas ou sensíveis.

A variável de servidor `GEMINI_IMAGE_MODEL` é opcional e, por padrão, usa `gemini-3.1-flash-image`, modelo documentado pela API Gemini para geração de imagens. `GEMINI_API_KEY` deve continuar apenas no servidor. O nome `gemini-3.8-flash` usado para extração de texto não consta na documentação oficial consultada como modelo de geração de imagens; por isso a geração visual usa o modelo de imagem separado. Geração de fluxogramas tem limite de 3 solicitações por usuário por hora e uploads de capa, 20 por dia.

As migrations são versionadas no repositório, mas **não são aplicadas automaticamente** ao projeto Supabase. Confirme a aplicação no projeto dedicado antes de testar as rotas; sem isso, a API pode responder com erro de coluna/tabela ausente.
