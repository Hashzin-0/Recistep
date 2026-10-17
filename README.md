# Recistep

Aplicativo web responsivo/PWA para organizar receitas a partir de fontes culinárias, estruturar ingredientes e etapas, ajustar porções e planejar o preparo.

## Estado implementado nesta branch

- Next.js App Router, React, TypeScript, Zod e Vitest.
- Validação de URL sem buscar a mídia na rota HTTP.
- Schema de extração de receita com validação estrita e utilitário determinístico de escala de porções.
- Migração Supabase com importações, receitas, ingredientes, etapas e políticas RLS por proprietário.
- Adaptador REST server-only para validar tokens Supabase e persistir importações usando a chave de serviço apenas no servidor.
- Workflow durável Inngest para análise de vídeos públicos do YouTube e extração de transcrições.
- Conector YouTube oEmbed para metadados públicos e análise de vídeos públicos diretamente pela API Gemini. O Recistep não baixa o vídeo por conta própria; o recurso de URL do YouTube na API Gemini está em prévia e só aceita vídeos públicos.
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

O Recistep consulta o endpoint público oEmbed e, quando Gemini está configurado, envia a URL pública do YouTube à API Gemini para análise multimodal. Se o vídeo não puder ser processado, a interface solicita uma transcrição autorizada. TikTok e Instagram ainda não têm conectores de conteúdo. Não há scraping, bypass de controles de acesso nem dados simulados. A interface permite entrar/criar conta, acompanhar a importação, fornecer transcrição, revisar e confirmar a receita, ajustar porções e gerar lista de compras persistida.

## Login com Google pelo Supabase

O login da interface usa `supabase.auth.signInWithOAuth({ provider: "google" })` e retorna à origem atual da aplicação. Para ativá-lo no projeto Supabase:

1. No Supabase Dashboard, abra **Authentication → Sign In / Providers → Google** e habilite Google.
2. Cadastre no Google Cloud um OAuth Client ID do tipo **Web application**. Em **Authorized redirect URIs**, use o callback exibido na configuração do provedor Supabase (normalmente `https://<project-ref>.supabase.co/auth/v1/callback`).
3. Insira o Client ID e o Client Secret no provedor Google do Supabase; não os coloque em variáveis `NEXT_PUBLIC_*`.
4. Em **Authentication → URL Configuration → Redirect URLs**, permita a URL de produção do Recistep e `http://localhost:3000/**` para desenvolvimento. Adicione URLs de preview apenas se quiser testar OAuth em previews.
5. Confirme que a Site URL do Supabase aponta para a origem de produção correta.

O código não consegue ativar o provedor Google sem as credenciais OAuth do proprietário do projeto. Se o provedor estiver desabilitado ou as URLs não estiverem na allowlist, a interface mostrará uma mensagem de configuração.

## Configuração de ambiente

Copie `.env.example` para `.env.local` e configure valores reais. As variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` são públicas e usadas apenas pelo cliente de Auth; mantenha `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` e chaves Inngest exclusivamente no servidor. Configure também as opções de confirmação de e-mail e URLs de redirecionamento no Supabase Auth. Em desenvolvimento local, use o Inngest Dev Server e `INNGEST_DEV=1`.

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

## Planejamento e lista de compras

- O ajuste de porções usa a função determinística scaleIngredients, preserva ingredientes sem quantidade e não converte unidades incompatíveis.
- POST /api/v1/shopping-lists cria uma lista a partir de uma ou mais receitas confirmadas do próprio usuário.
- GET /api/v1/shopping-lists/{id} consulta a lista pertencente ao usuário.
- PATCH /api/v1/shopping-lists/{id}/items/{itemId} persiste a marcação de item comprado.
- A consolidação agrupa apenas nomes normalizados com unidade igual; itens sem quantidade conhecida não recebem soma inventada. Cada item guarda IDs das receitas e dos ingredientes de origem.
- As migrations 20261017120637_recipe_cache_and_shopping.sql e 20261017120831_recipe_cache_service_policy.sql criam o cache, hashes, listas, itens, políticas RLS e função transacional de criação da lista.
