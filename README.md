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

### Estados relevantes

- `queued`: registro persistido e evento agendado.
- `processing`: worker em execução.
- `source_content_required`: metadados públicos podem estar disponíveis, mas falta conteúdo de receita obtido por método autorizado.
- `review_required`: Gemini produziu rascunho estruturado; revisão humana é obrigatória.
- `failed`: falha terminal ou impossibilidade de agendar o evento.

O Recistep consulta o endpoint público oEmbed e, quando Gemini está configurado, envia a URL pública do YouTube à API Gemini para análise multimodal. Se o vídeo não puder ser processado, a interface solicita uma transcrição autorizada. TikTok e Instagram ainda não têm conectores de conteúdo. Não há scraping, bypass de controles de acesso nem dados simulados. A interface permite entrar/criar conta, acompanhar a importação, fornecer transcrição e revisar o rascunho; salvar a receita normalizada e confirmar a revisão ainda não estão implementados.

## Configuração de ambiente

Copie `.env.example` para `.env.local` e configure valores reais. As variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` são públicas e usadas apenas pelo cliente de Auth; mantenha `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` e chaves Inngest exclusivamente no servidor. Configure também as opções de confirmação de e-mail e URLs de redirecionamento no Supabase Auth. Em desenvolvimento local, use o Inngest Dev Server e `INNGEST_DEV=1`.

## Migração Supabase

O arquivo `supabase/migrations/20261016000100_recistep_core.sql` cria as tabelas e políticas RLS. Revise e aplique somente no projeto dedicado ao Recistep. A execução da migração e os testes de advisors ainda não foram confirmados.

## Plano técnico

O plano detalhado de 14 critérios está em [plano.md](./plano.md). Ele distingue implementação real de itens pendentes.
