# Recistep — Plano técnico completo do MVP

**Versão:** 1.0  
**Estado:** plano de implementação; itens marcados como planejados não devem ser interpretados como funcionalidades já entregues.  
**Produto:** aplicação web responsiva e PWA para transformar links de vídeos de receitas em receitas estruturadas, com ingredientes, etapas, tempos e planejamento de preparo.  
**Princípios aceitos:** Gemini como provedor principal de IA, arquitetura extensível a outros provedores; suporte progressivo a múltiplas plataformas por meios de acesso autorizados; equilíbrio entre qualidade, latência e custo; nenhuma simulação de importação ou de dados reais.

## Como usar este documento

- Este documento é a fonte de planejamento do MVP. Cada etapa deve atualizar o estado real dos itens e os critérios de aceite.
- **Implementado** significa que existe código verificável e os testes relevantes passaram; **parcial** significa que há apenas parte do fluxo; **planejado** significa que ainda não foi entregue.
- Não habilitar um conector apenas porque a URL foi reconhecida. O método de aquisição precisa ser permitido pela plataforma, compatível com seus termos e tecnicamente validado.
- Não declarar importação concluída antes de persistir o resultado e confirmar o estado final na fonte de verdade.
- Toda saída gerada por IA deve ser validável, rastreável até a fonte disponível e revisável pelo usuário.

## Critério 1 — Escopo funcional e limites do MVP

### Objetivo
Permitir que uma pessoa forneça um link de conteúdo culinário acessível e obtenha uma receita estruturada que possa revisar, ajustar porções, organizar ingredientes e planejar o preparo.

### Funcionalidades incluídas
1. Interface web responsiva para celular, tablet e desktop.
2. PWA instalável, com manifest, ícones, comportamento de instalação e estratégia explícita para conectividade limitada.
3. Formulário de importação de URL com validação no cliente para UX e validação obrigatória no servidor.
4. Detecção da plataforma reconhecida, sem inferir que o conteúdo pode ser baixado.
5. Pipeline assíncrono para fontes que possuam conector autorizado e funcional.
6. Extração estruturada de título, descrição disponível, ingredientes, quantidades, unidades, etapas, tempos por etapa, tempo total, porções e observações.
7. Revisão humana antes de tratar o resultado como receita confirmada.
8. Ajuste de porções com recálculo determinístico de quantidades quando a unidade e o valor permitirem.
9. Lista consolidada de ingredientes e organização por grupos/categorias quando houver dados suficientes.
10. Planejamento de preparo com ordem das etapas, durações estimadas e temporizadores.
11. Estados explícitos de importação: recebida, aguardando processamento, processando, revisão necessária, concluída, falhou ou cancelada.
12. Histórico de receitas importadas para usuário autenticado, após persistência e autorização estarem implementadas.
13. Mensagens de erro compreensíveis, com identificadores de correlação nos logs sem expor segredos.

### Fora do MVP inicial
- Contornar DRM, paywalls, autenticação, controles técnicos ou restrições de acesso.
- Baixar indiscriminadamente mídia de plataformas ou realizar scraping que viole termos aplicáveis.
- Comprar ingredientes, realizar pedidos ou efetuar transações.
- Recomendações nutricionais ou alegações de saúde sem uma especificação e fontes próprias.
- Planejamento colaborativo em tempo real, social feed, avaliações públicas e marketplace.
- Prometer funcionamento offline completo para importação ou processamento remoto.
- Garantir extração perfeita de áudio/vídeo sem uma etapa de revisão.

### Definição de pronto funcional
Um usuário consegue importar uma fonte elegível, acompanhar o estado real, revisar uma receita estruturada, corrigir os campos, salvar e usar ingredientes e etapas sem que a aplicação invente uma conclusão.

## Critério 2 — Arquitetura e princípios técnicos

### Stack inicial
- Next.js App Router e React com TypeScript.
- Zod para validar entradas e saídas nas fronteiras.
- Vitest para testes unitários.
- PostgreSQL via Supabase para persistência, quando provisionado.
- Gemini como modelo primário; camada de provedor isolada para permitir substituição.
- Fila durável para trabalho assíncrono, escolhida conforme integração real e ambiente de hospedagem.
- PWA com manifest, ícones e service worker após definição da política de cache.

### Camadas
1. **UI:** formulários, páginas, componentes, estados de loading/erro/vazio/sucesso e acessibilidade.
2. **Aplicação/casos de uso:** iniciar importação, consultar estado, revisar receita, salvar alterações, gerar lista e iniciar temporizadores.
3. **Domínio:** entidades e regras de receita, ingrediente, etapa, unidade, porções, importação e planejamento.
4. **Contratos:** schemas Zod, tipos de API, eventos da fila e saída estruturada de IA.
5. **Serviços:** orquestração de importação, extração, normalização, revisão e planejamento.
6. **Adaptadores:** conectores de plataforma, Gemini, banco, armazenamento, fila e observabilidade.
7. **Infraestrutura:** configurações, rate limiting, autenticação, migrations, políticas RLS e CI.

### Diretrizes
- Dependências externas ficam atrás de interfaces próprias; a lógica de domínio não importa SDK de plataforma ou provedor de IA diretamente.
- A UI não chama APIs de terceiros diretamente para operações privilegiadas.
- Não criar abstrações genéricas sem uso concreto, mas isolar os pontos que de fato variam: plataforma, provedor de IA, fila e armazenamento.
- Validar dados em runtime; TypeScript sozinho não valida payload externo.
- Definir timeout, limites de tamanho, concorrência, retries e idempotência.
- Respeitar a hospedagem na Vercel: não depender de processos persistentes, arquivos locais duráveis ou tarefas longas síncronas em uma rota serverless.
- Usar operações curtas nas rotas HTTP e processamento pesado em worker/fila compatível com o ambiente.

### Estrutura alvo sugerida
A estrutura atual usa diretórios `app/` e `lib/`. Evoluir sem migração estrutural desnecessária:

```text
app/
  api/v1/imports/route.ts
  api/v1/imports/[id]/route.ts
  api/v1/recipes/[id]/route.ts
  api/v1/recipes/[id]/ingredients/route.ts
  page.tsx
  manifest.ts
components/
  import/
  recipe/
  planner/
  ui/
lib/
  domain/
    recipe.ts
    ingredient.ts
    preparation-step.ts
    import-job.ts
  schemas/
    import.ts
    recipe.ts
    api.ts
  services/
    import-service.ts
    recipe-service.ts
    extraction-service.ts
  providers/
    ai/
      provider.ts
      gemini.ts
    sources/
      source-connector.ts
      registry.ts
  persistence/
    repositories/
    supabase/
  queue/
  security/
  observability/
  source-url.ts
supabase/
  migrations/
tests/
  unit/
  integration/
  e2e/
```

A estrutura é uma proposta de destino, não uma exigência de criar todos os diretórios de uma vez. Reutilizar arquivos existentes quando mantiver responsabilidades coesas.

## Critério 3 — Fluxo de importação ponta a ponta

### Fluxo esperado
1. Usuário envia URL e, opcionalmente, idioma e porções desejadas.
2. Frontend faz validação básica e envia `POST /api/v1/imports`.
3. Servidor valida JSON, tamanho, schema, protocolo, host e parâmetros.
4. Autenticação, autorização, rate limit e limites de uso são verificados antes de criar trabalho persistente.
5. Servidor resolve a plataforma por registry explícito e procura um conector habilitado.
6. Conector confirma que a fonte pode ser acessada pelo método permitido; valida redirects e destino final.
7. Cria-se registro de importação com identificador estável e chave de idempotência.
8. Trabalho é enfileirado duravelmente; a resposta HTTP confirma apenas o que foi realmente persistido/enfileirado.
9. Worker obtém metadados e conteúdo permitido; guarda referência de origem e proveniência, não a mídia inteira por padrão.
10. Pipeline prepara conteúdo para extração (transcrição, metadados ou frames permitidos, conforme a plataforma e o conector).
11. Gemini recebe apenas o contexto necessário, instruções delimitadas e schema de saída.
12. Saída é validada com schema estrito e normalizada. Valores ausentes permanecem desconhecidos; não inventar quantidade ou duração.
13. O sistema persiste resultado e estado `review_required`; não declara a receita confirmada automaticamente.
14. Usuário revisa, corrige e confirma.
15. O sistema salva a versão confirmada e habilita lista de ingredientes e planejamento.
16. Erros são classificados e registrados; retries são limitados e não duplicam importações.

### Regras de resiliência
- Idempotência por usuário + chave de requisição e/ou fingerprint estável da origem, com política explícita para reimportação.
- Limites de tamanho de transcrição, número de frames, duração de processamento e tokens.
- Timeout e retry com backoff apenas para falhas transitórias; não repetir erros de validação, autorização ou política.
- Dead-letter/falha terminal para trabalhos que excedam o número máximo de tentativas.
- Cancelamento e expiração de trabalho quando tecnicamente suportados.
- A UI consulta estado persistido; não assume sucesso pelo fato de ter enviado a requisição.
- Reimportação da mesma fonte deve reutilizar resultados somente quando a política de cache, titularidade, permissão e validade permitir.

### Condição de bloqueio
Se não houver conector autorizado e testado, a API deve retornar erro explícito de pipeline não configurado ou plataforma não suportada. Não criar registros falsos, resultados de demonstração ou “jobs” que não existam.

## Critério 4 — Contratos de API

Os contratos abaixo são a proposta de referência. Devem ser mantidos sincronizados com os schemas, testes e respostas reais.

### Iniciar importação
`POST /api/v1/imports`

Entrada:
```json
{
  "source_url": "https://www.youtube.com/watch?v=...",
  "locale": "pt-BR",
  "servings_target": 4,
  "idempotency_key": "client-generated-opaque-key"
}
```

- `source_url`: string HTTPS validada; limite inicial de 2048 caracteres.
- `locale`: BCP 47 ou subconjunto explicitamente suportado; padrão `pt-BR`.
- `servings_target`: número positivo dentro de limite de produto, opcional.
- `idempotency_key`: opcional para compatibilidade inicial; obrigatório quando a política de criação de jobs estiver consolidada.

Resposta de aceite real: `202 Accepted`, com `import_id`, `status`, `status_url` e timestamp, somente após persistência e enfileiramento confirmados. Não retornar 202 enquanto isso não estiver implementado.

### Consultar importação
`GET /api/v1/imports/{import_id}`

Resposta conceitual:
```json
{
  "id": "opaque-id",
  "status": "processing",
  "progress": null,
  "recipe_id": null,
  "error": null,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

- Progresso pode ser nulo quando não houver medição confiável.
- A autorização deve garantir que o solicitante possa consultar aquela importação.
- Erros públicos usam códigos estáveis e mensagens seguras.

### Consultar receita
`GET /api/v1/recipes/{recipe_id}`

Retorna receita estruturada e seu estado de revisão apenas ao titular ou a um ator autorizado.

### Atualizar/revisar receita
`PATCH /api/v1/recipes/{recipe_id}`

Aceita somente campos editáveis explicitamente permitidos. Validar unidades, quantidades, limites e autorização no servidor. Não aceitar atualizações arbitrárias de proprietário, estado interno, proveniência ou metadados de auditoria.

### Lista de ingredientes
`GET /api/v1/recipes/{recipe_id}/ingredients`

Retorna ingredientes normalizados; eventual consolidação entre receitas precisa considerar unidades compatíveis e não somar quantidades incompatíveis.

### Padrão de erro
```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Mensagem compreensível.",
    "retryable": false,
    "request_id": "opaque-correlation-id"
  }
}
```

Códigos esperados incluem `INVALID_JSON`, `INVALID_REQUEST`, `UNSUPPORTED_PLATFORM`, `SOURCE_ACCESS_DENIED`, `RATE_LIMITED`, `IMPORT_PIPELINE_NOT_CONFIGURED`, `IMPORT_NOT_FOUND`, `AI_PROVIDER_UNAVAILABLE`, `AI_OUTPUT_INVALID` e `INTERNAL_ERROR`. Só expor códigos que correspondam a comportamentos implementados.

## Critério 5 — Esquema PostgreSQL e persistência

### Entidades propostas
- `profiles`: referência ao usuário autenticado e preferências mínimas.
- `source_imports`: usuário, URL canônica, plataforma, estado, idempotência, erro público, timestamps e referência da origem.
- `recipes`: titular, título, descrição, porções, tempos, estado de revisão, proveniência e versão.
- `ingredients`: ingrediente pertencente a uma receita, nome original, nome normalizado, quantidade numérica opcional, unidade original, unidade normalizada opcional, observações e ordem.
- `preparation_steps`: receita, posição, instrução, duração estimada opcional, temperatura opcional com unidade e observações.
- `recipe_source_evidence`: referências a trechos, timestamps ou metadados que sustentam campos extraídos, quando permitido e disponível.
- `shopping_lists` e `shopping_list_items`: entram apenas quando o fluxo de lista consolidada for implementado.
- `preparation_sessions`: sessões/temporizadores persistentes apenas se o produto exigir retomada entre dispositivos.

### Regras de schema
- UUID ou IDs opacos; chaves estrangeiras e cascatas avaliadas explicitamente.
- `created_at` e `updated_at` em UTC.
- Estados com CHECK/enum controlado; não permitir estados arbitrários.
- Quantidades e durações podem ser nulas quando a fonte não informar. Nulo significa desconhecido, não zero.
- Guardar valor original e normalizado quando normalização puder perder contexto.
- Índices nas chaves de titularidade, estado da importação, idempotência e relacionamentos consultados com frequência.
- Unicidade da chave de idempotência no escopo definido pela política; nunca global sem considerar titular.
- Migrations versionadas em `supabase/migrations/`; não alterar manualmente banco de produção sem migration revisável.
- Não introduzir dados mockados para preencher telas ou testar o fluxo de produção.

### Esboço SQL inicial
O SQL definitivo deve ser uma migration revisada após confirmar o modelo de autenticação e as necessidades reais. Forma conceitual:

```sql
create table public.source_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null,
  canonical_url text,
  platform text not null,
  status text not null check (status in (
    'received', 'queued', 'processing', 'review_required',
    'completed', 'failed', 'cancelled'
  )),
  idempotency_key text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index source_imports_user_idempotency_uq
  on public.source_imports(user_id, idempotency_key)
  where idempotency_key is not null;

create index source_imports_user_status_created_idx
  on public.source_imports(user_id, status, created_at desc);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_import_id uuid references public.source_imports(id) on delete set null,
  title text not null,
  description text,
  servings numeric,
  prep_time_seconds integer check (prep_time_seconds is null or prep_time_seconds >= 0),
  cook_time_seconds integer check (cook_time_seconds is null or cook_time_seconds >= 0),
  total_time_seconds integer check (total_time_seconds is null or total_time_seconds >= 0),
  review_status text not null default 'review_required'
    check (review_status in ('review_required', 'confirmed')),
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position integer not null check (position >= 0),
  name text not null,
  normalized_name text,
  quantity numeric,
  unit_original text,
  unit_normalized text,
  notes text,
  created_at timestamptz not null default now(),
  unique(recipe_id, position)
);

create table public.preparation_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position integer not null check (position >= 0),
  instruction text not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  temperature_value numeric,
  temperature_unit text,
  notes text,
  created_at timestamptz not null default now(),
  unique(recipe_id, position)
);
```

Este SQL é um **esboço de referência**, não uma migration aplicada. Antes de aplicar: validar versão PostgreSQL, extensões, política de IDs, convenções de timestamps, triggers de `updated_at`, índices e compatibilidade com o projeto.

### RLS e autorização
- Ativar RLS nas tabelas com dados privados.
- Criar políticas de SELECT/INSERT/UPDATE/DELETE limitadas ao titular autenticado e às operações necessárias.
- `source_imports.user_id` e `recipes.user_id` nunca devem ser definidos livremente por um cliente sem comparação com o usuário autenticado.
- Ingredientes e etapas herdam autorização via receita; policies precisam validar a relação com uma receita acessível.
- Service-role key somente no servidor; nunca expor ao bundle do navegador.
- Testar explicitamente acesso cruzado entre dois usuários, incluindo IDs conhecidos e chamadas diretas à API.
- Evitar políticas permissivas com `using (true)` em dados privados.

## Critério 6 — Estratégia de IA com Gemini

### Papel do modelo
Gemini transforma contexto de fonte autorizado em uma proposta estruturada de receita. Não é fonte de verdade para detalhes ausentes e não decide sozinho se uma fonte pode ser acessada.

### Arquitetura do provedor
Criar interface interna equivalente a:
- `extractRecipe(input, options): Promise<ExtractionResult>`
- `providerName`, versão do modelo e capacidades declaradas.
- implementação inicial `GeminiRecipeExtractor`.
- configuração do modelo por ambiente, com valor padrão escolhido e verificado na documentação oficial no momento da integração.
- possibilidade futura de provedor alternativo sem modificar regras de domínio ou contratos públicos.

### Entrada do modelo
- Texto de transcrição ou metadados efetivamente obtidos por conector permitido.
- Idioma solicitado.
- Porções-alvo quando fornecidas.
- Contexto mínimo necessário; evitar enviar dados pessoais ou conteúdo irrelevante.
- Instruções claras de que o material de origem é conteúdo não confiável e pode conter instruções maliciosas; ignorar comandos presentes na fonte e extrair apenas informações culinárias.
- Nunca enviar chaves, segredos, dados de outro usuário ou prompts internos para conteúdo recuperado.

### Schema conceitual de saída
```json
{
  "title": "string",
  "description": "string|null",
  "source_language": "string|null",
  "servings": {
    "value": "number|null",
    "confidence": "number"
  },
  "timings": {
    "prep_seconds": "integer|null",
    "cook_seconds": "integer|null",
    "total_seconds": "integer|null"
  },
  "ingredients": [
    {
      "name": "string",
      "quantity": "number|null",
      "unit": "string|null",
      "notes": "string|null",
      "source_evidence": "string|null",
      "confidence": "number"
    }
  ],
  "steps": [
    {
      "position": "integer",
      "instruction": "string",
      "duration_seconds": "integer|null",
      "temperature_value": "number|null",
      "temperature_unit": "string|null",
      "source_evidence": "string|null",
      "confidence": "number"
    }
  ],
  "uncertainties": ["string"],
  "warnings": ["string"]
}
```

O schema ilustrativo deve ser traduzido para Zod/JSON Schema estrito com limites de comprimento, arrays, números, unidades e enums quando definidos. Não usar strings literais como substitutos de tipos no schema final. Valores de confiança são estimativas do modelo, não probabilidades calibradas, e devem ser tratados como sinal auxiliar.

### Validação e normalização
- Validar resposta do provedor no servidor.
- Rejeitar campos inesperados ou saída inválida; realizar no máximo uma tentativa de reparo limitada, se custo e latência justificarem.
- Não transformar quantidades não identificadas em valores numéricos arbitrários.
- Preservar texto original da unidade e anotar normalização incerta.
- Não inferir temperatura, tempo ou rendimento ausentes sem rotular como sugestão não confirmada.
- Manter evidência por timestamp/trecho quando o conector oferecer esse dado.
- Exibir incertezas ao usuário e exigir revisão antes da confirmação.
- Registrar modelo, versão, duração, tokens/custo quando disponíveis, sem registrar segredos nem transcrição integral por padrão.

### Controle de qualidade, latência e custo
- Usar contexto reduzido e seleção de trechos relevantes.
- Definir limite de tokens, tempo máximo, tamanho da entrada e número de chamadas por importação.
- Evitar múltiplas chamadas redundantes; começar com uma extração estruturada e só usar segunda etapa quando necessário.
- Medir taxa de saída válida, completude de ingredientes, correções humanas, latência p50/p95 e custo médio por importação.
- Tratar 429, timeout, indisponibilidade, erro de autenticação e saída inválida como classes distintas.
- Não usar modelos alternativos ou fallback silencioso sem telemetria e configuração explícita.

## Critério 7 — Planejamento culinário, compras, porções e unidades

### Ingredientes
Cada ingrediente deve manter nome original, quantidade opcional, unidade original, observações e posição na receita. Normalização de nomes não deve apagar distinções culinárias importantes.

### Ajuste de porções
Quando a receita contém rendimento conhecido e quantidade numérica confiável:
`quantidade_nova = quantidade_original × (porções_desejadas / porções_originais)`.
- Implementar em função determinística e testada, fora da UI.
- Não recalcular ingredientes sem quantidade numérica.
- Evitar conversão automática entre massa, volume e unidade sem densidade ou regra culinária válida.
- Arredondamentos devem ser específicos por unidade e transparentes; preservar valor original para permitir reversão.
- Mostrar que a escala de porções é uma estimativa e permitir edição.

### Lista de compras
- Consolidar apenas itens equivalentes com unidades compatíveis.
- Não somar “1 xícara” com “200 g” sem conversão válida.
- Manter referência às receitas que originaram cada item.
- Permitir marcar itens como comprados sem alterar a receita original.
- Persistir em banco quando usuário estiver autenticado e a funcionalidade estiver ativa.

### Planejamento do preparo
- Ordenar etapas pela sequência da receita; paralelizar apenas quando houver dependência explicitamente representada.
- Cada etapa pode ter duração desconhecida. Não exibir timer como se houvesse tempo confirmado quando o tempo não foi fornecido.
- Temporizadores locais podem funcionar com a página em primeiro plano; execução confiável em segundo plano depende do suporte do navegador/OS e deve ser comunicada.
- Ao reabrir uma sessão, reconstruir o tempo restante a partir de timestamps, não confiar apenas em intervalos JavaScript.
- Tratar suspensão de aba, recarga, relógio do dispositivo e permissões de notificação.
- Notificações são opt-in e não são garantia de entrega.

## Critério 8 — Segurança, privacidade, direitos de acesso e abuso

### URLs e SSRF
- Aceitar somente HTTPS por padrão e hosts/subdomínios estritamente verificados por parser de URL; nunca usar comparação ingênua por substring.
- Rejeitar userinfo, portas não permitidas, esquemas alternativos, endereços IP inesperados e nomes que apenas imitem um host permitido.
- O conector deve validar cada redirect e resolver DNS/destino final para bloquear loopback, link-local, endereços privados e endpoints de metadados cloud.
- Não fazer fetch server-side de URLs arbitrárias. A validação inicial atual não deve ser confundida com proteção SSRF completa de um downloader.
- Aplicar timeout, limites de bytes, MIME type esperado e limite de redirects.

### Autorização e abuso
- Autenticação antes de criar importações persistidas.
- Rate limiting por usuário e, quando necessário, por IP/rota.
- Limite de jobs simultâneos, reimportações, tamanho e custo por conta.
- Idempotência e proteção contra replay.
- Não permitir que a IA acione ferramentas privilegiadas nem use conteúdo externo como instrução de sistema.
- Mensagens públicas não devem incluir stack traces, tokens ou respostas internas do provedor.
- Headers de segurança, CSP e proteção contra XSS conforme a arquitetura Next.js.
- Proteger operações de mutação contra CSRF quando o modelo de autenticação/cookies exigir.

### Privacidade e retenção
- Coletar somente dados necessários.
- Definir política de retenção para URLs, transcrições, artefatos temporários, logs e resultados.
- Preferir armazenar metadados e referências em vez de mídia bruta; se mídia temporária for necessária, definir TTL e exclusão.
- Não registrar transcrições completas por padrão.
- Fornecer meios de excluir receitas/importações e dados associados, conforme as capacidades de persistência e a política do produto.
- Não publicar receitas privadas nem tornar URLs privadas acessíveis por IDs previsíveis.
- Documentar quais dados são enviados ao Gemini e para qual finalidade.

### Direitos e permissões de plataforma
- Usar APIs oficiais, embeds, metadados públicos ou outros métodos permitidos conforme as regras específicas da plataforma.
- Não contornar DRM, autenticação, paywall, CAPTCHA, limites ou medidas antiabuso.
- Revisar termos aplicáveis e requisitos de atribuição/retention antes de habilitar cada conector.
- Se a plataforma não permitir extração pelo método escolhido, comunicar a limitação e manter o conector desabilitado.

## Critério 9 — PWA, offline, UX responsiva e temporizadores

### PWA
- Manifest com nome, short name, descrição, cores, display e ícones de dimensões corretas.
- Service worker implementado somente após definir cache e invalidação.
- Cache de assets estáticos; não cachear indiscriminadamente APIs privadas, respostas com credenciais ou dados pessoais.
- Estratégia de atualização que avise quando uma nova versão estiver disponível sem descartar silenciosamente edições.
- Instalação verificada em navegadores móveis suportados e desktop compatível.

### Offline
- Offline não significa importação offline: criação de importações e extração exigem rede.
- Definir se receitas já abertas podem ser guardadas localmente e por quanto tempo.
- Indicar estado de conectividade e fila local se ela for realmente implementada.
- Não mostrar sincronização concluída até o servidor confirmar.
- Resolver conflitos entre edição local e remota com timestamps/versionamento ou pedir decisão ao usuário.

### Responsividade e acessibilidade
- Priorizar mobile, áreas de toque adequadas, formulários curtos e layout adaptável.
- Navegação por teclado, foco visível, labels, landmarks e mensagens de erro associadas aos campos.
- Contraste suficiente e suporte a `prefers-reduced-motion`.
- Estados de carregamento, vazio, erro, indisponibilidade e sucesso.
- Não depender só de cor ou ícone para comunicar estado.
- Não usar hover como único mecanismo de interação.
- Respeitar zoom e tamanhos de texto do dispositivo.

### Temporizadores
- Guardar hora de início/fim e duração, não depender de um `setInterval` como relógio de verdade.
- Recalcular tempo restante ao retomar a aba.
- Notificações são opcionais e dependem de permissões e suporte do sistema.
- Evitar prometer alertas em segundo plano quando o navegador não oferece garantia.

## Critério 10 — Organização do código e convenções

### Convenções
- TypeScript estrito, evitando `any`.
- Nomes claros para schemas, casos de uso e adaptadores.
- Validar entradas e saídas de rede com Zod.
- Não colocar regras de domínio complexas dentro de componentes React ou handlers de rota.
- Manter chamadas de Gemini, Supabase, fila e conectores isoladas em adaptadores.
- Usar variáveis de ambiente server-side para segredos; somente variáveis `NEXT_PUBLIC_*` não secretas podem chegar ao browser.
- `.env.example` contém nomes e descrições, nunca valores reais.
- Não sobrescrever ou excluir arquivos `.env*` existentes.

### Configuração prevista
Os nomes definitivos dependem das integrações efetivamente escolhidas. Candidatos:
- `GEMINI_API_KEY`: segredo server-side para Gemini.
- `GEMINI_MODEL`: identificador de modelo validado na documentação vigente.
- `NEXT_PUBLIC_APP_URL`: URL pública não secreta, se necessária.
- `SUPABASE_URL` e `SUPABASE_ANON_KEY`: acesso público controlado por RLS.
- `SUPABASE_SERVICE_ROLE_KEY`: apenas servidor, quando estritamente necessário.
- variáveis do provedor de fila/worker e rate limit após escolha.
Não adicionar segredos nem declarar configuração pronta sem testar a integração real.

### Observabilidade
- IDs de correlação por requisição e importação.
- Eventos estruturados por etapa: recebido, validado, enfileirado, conector iniciado, extração iniciada, validação concluída, revisão pendente, concluído/falhou.
- Medir duração e erro por estágio.
- Redigir URLs e parâmetros sensíveis quando necessário.
- Não logar tokens, cookies, chaves, transcrições integrais ou conteúdo privado desnecessário.

## Critério 11 — Testes, qualidade e critérios de aceite

### Testes unitários
- Validação de URL: HTTPS, host exato, subdomínios permitidos, host parecido, credenciais, portas, comprimento e redirects.
- Schemas de requisição e resposta: JSON inválido, campos extras, números fora de faixa e conteúdo incompleto.
- Normalização de ingredientes e unidades.
- Escala de porções e arredondamento.
- Máquina de estados de importação e transições inválidas.
- Classificação de erros e política de retry.
- Schema de saída Gemini com valores ausentes e saída malformada.
- Cálculo de temporizadores usando timestamps.

### Testes de integração
- API de importação com conector desabilitado, conector permitido, rate limit e falhas transitórias.
- Idempotência com requisições concorrentes.
- Persistência de importação/receita e recuperação após falha.
- Autorização/RLS, incluindo tentativa de acesso cruzado entre usuários.
- Erros Gemini: 429, timeout, credencial ausente, indisponibilidade e resposta que não passa no schema.
- Worker reiniciado e retomada de trabalho, se a fila escolhida suportar.

### Testes end-to-end
- Submeter link inválido e receber erro compreensível.
- Submeter fonte elegível, ver estado real, abrir resultado e revisar receita.
- Editar ingrediente/etapa e recarregar para confirmar persistência.
- Ajustar porções e verificar valores.
- Montar lista e usar temporizador.
- Testar mobile, navegação por teclado e estados de erro.
- Instalar PWA e verificar comportamento sem rede conforme o escopo offline.

### CI e comandos
O pipeline deve executar instalação reproduzível com lockfile, testes, typecheck e build. Incluir lint quando configurado e testes de integração sem depender de credenciais pessoais. Testes que exigem serviços externos devem usar doubles controlados para testar contratos, mas não devem ser confundidos com validação real do provedor.

Comandos-alvo:
```bash
npm ci
npm test
npm run typecheck
npm run build
```

### Metas iniciais de qualidade (a medir, não presumir)
- 100% das entradas externas validadas no servidor.
- Nenhum resultado declarado concluído sem persistência confirmada.
- 0 acesso cruzado entre contas nos testes de autorização.
- Saída IA sempre validada antes de persistir.
- Métricas de latência p50/p95 e custo médio coletadas antes de estabelecer metas de produção.
- Cobertura de testes priorizada para segurança, idempotência, contratos e cálculo determinístico; percentual global não substitui cobertura dos caminhos críticos.

## Critério 12 — Plano de implementação por etapas

### Etapa 0 — Fundação (parcial)
- App Next.js/TypeScript e UI responsiva.
- Manifest PWA inicial.
- Validador de URL com testes.
- API `POST /api/v1/imports` que rejeita entradas inválidas e declara pipeline não configurado para URLs válidas.
- CI inicial.
- **Limite atual:** sem conector de mídia, Gemini, autenticação, banco, fila durável, histórico ou lista de compras. Testes/build devem ser confirmados por execução do CI.

### Etapa 1 — Contratos de domínio e persistência
- Finalizar schemas Zod de receita, ingrediente, etapa, importação e estados.
- Selecionar/provisionar Supabase e confirmar configuração de autenticação.
- Criar migrations versionadas, índices e RLS.
- Implementar repositórios server-side e testes de isolamento.
- Não habilitar rotas de escrita até que autorização seja verificada.

### Etapa 2 — Fila durável e importação idempotente
- Selecionar fila/worker compatível com Vercel.
- Criar job persistido, chave idempotente, status, retries limitados e falha terminal.
- Separar API rápida do processamento de mídia.
- Implementar consulta de estado e recuperação após falha.
- Confirmar que jobs são reais e duráveis antes de responder 202.

### Etapa 3 — Primeiro conector autorizado (vertical slice)
- Escolher uma plataforma inicial e documentar o método de acesso permitido.
- Verificar termos, API/SDK, autenticação exigida, limites e dados disponíveis.
- Implementar um conector isolado com timeout, limite de bytes, validação de redirects e telemetria.
- Testar com fontes reais permitidas e com casos de acesso negado.
- Não adicionar várias plataformas simultaneamente antes de comprovar o primeiro fluxo.

### Etapa 4 — Gemini com saída estruturada
- Implementar interface do provedor e adapter Gemini.
- Definir schema estrito e instruções anti-prompt-injection.
- Validar saída, armazenar proveniência e incertezas.
- Medir latência, tokens/custo, saída inválida e necessidade de correção.
- Adicionar testes de contrato com respostas representativas e testes reais autorizados sem registrar dados sensíveis.

### Etapa 5 — Revisão e persistência da receita
- UI de revisão de título, porções, ingredientes, quantidades, unidades, etapas e tempos.
- Salvar alterações com autorização e validação.
- Marcar receita confirmada somente após ação explícita do usuário.
- Tratar campos desconhecidos e avisos da IA.

### Etapa 6 — Planejamento e lista de ingredientes
- Ajuste determinístico de porções.
- Lista por receita e consolidação apenas entre unidades compatíveis.
- Estados de itens comprados.
- Testes de unidades, arredondamento e rastreabilidade.

### Etapa 7 — Temporizadores e PWA
- Temporizadores baseados em timestamps.
- Persistência local/remota conforme o requisito definido.
- Ícones PWA, service worker, política de cache e atualização.
- Testes de instalação, conectividade e recuperação após suspensão.

### Etapa 8 — Segurança, performance e lançamento
- Rate limiting, quotas e limites de custo.
- Revisão SSRF/redirects, RLS, exposição de dados, headers e logs.
- Testes e2e e CI verde.
- Observabilidade e painel mínimo de falhas.
- Implantação gradual com critérios de rollback e verificação pós-deploy.

## Critério 13 — Riscos, decisões pendentes e mitigação

| Risco/decisão | Impacto | Estratégia |
|---|---|---|
| Plataforma não fornece acesso permitido ao conteúdo | Importação indisponível | Começar com uma plataforma e um método oficialmente permitido; não contornar controles |
| Link reconhecido, mas mídia inacessível | Falha de extração | Separar validação da URL de aquisição real; mostrar erro específico |
| Transcrição incompleta ou vídeo sem fala | Ingredientes/etapas ausentes | Evidências por trecho, campos desconhecidos e revisão humana |
| Gemini inventa quantidades/tempos | Receita incorreta | Schema estrito, evidência, null para desconhecido e revisão obrigatória |
| Prompt injection no conteúdo de origem | Saída insegura ou desviada | Tratar fonte como dado não confiável; sem ferramentas privilegiadas; schema/validação |
| SSRF por URL/redirect/DNS | Acesso a rede interna | Não fazer fetch arbitrário; allowlist, validação de cada redirect e destino final |
| Custo imprevisível de IA/mídia | Abuso e gasto elevado | Quotas, limites de conteúdo/tokens, retries limitados e métricas |
| Limites da Vercel para tarefas longas | Jobs interrompidos | Fila durável e worker adequado, nunca depender de request longa |
| Duplicação de jobs | Custo e receitas duplicadas | Idempotência no servidor e restrições no banco |
| Falha de RLS | Vazamento de receitas | Políticas por titular e testes de acesso cruzado |
| Conversões incorretas de unidades | Lista de compras errada | Não somar unidades incompatíveis; preservar original |
| Temporizador suspenso pelo navegador | Alerta atrasado | Timestamps, recálculo na retomada e limitações claras |
| Cache PWA expõe dados privados | Vazamento local | Não cachear APIs privadas sem política explícita |
| API/modelo Gemini muda | Regressões | Adapter isolado, configuração, testes de contrato e verificação da documentação vigente |
| Fonte ou conteúdo protegido por direitos | Risco jurídico/contratual | Revisar termos, atribuição, retenção e permissões por conector |

### Decisões que precisam ser confirmadas durante a implementação
1. Qual plataforma será o primeiro conector, após validação de acesso autorizado.
2. Qual serviço de fila/worker será usado no ambiente Vercel.
3. Modelo Gemini exato e limites atuais, conferidos na documentação oficial quando a integração for criada.
4. Política de autenticação e se histórico exige login desde o primeiro fluxo persistido.
5. Retenção de URLs, transcrições e metadados; se qualquer mídia será armazenada temporariamente.
6. Se lista de compras será por receita ou consolidada entre receitas no MVP.
7. Escopo offline: apenas assets/receitas já abertas ou edição local com sincronização.
8. Se timers devem sobreviver à troca de dispositivo ou apenas à recarga no mesmo dispositivo.
9. Limites iniciais de quota/custo por usuário e mecanismo de rate limiting.
10. Política de remoção de dados e exclusão em cascata.

## Critério 14 — Critério de conclusão do MVP

O MVP só pode ser considerado concluído quando todos os critérios abaixo forem demonstrados por código e testes:

- [ ] Aplicação responsiva e acessível, com estados reais de carregamento, erro, vazio e sucesso.
- [ ] PWA com manifest, ícones e política de cache verificada.
- [ ] Pelo menos um conector real autorizado e documentado, testado com fontes acessíveis e recusas de acesso.
- [ ] API de importação autenticada/autorizada, validada no servidor, com rate limit e idempotência.
- [ ] Fila durável e estado de job persistido; recuperação de falha e retry limitado testados.
- [ ] Integração Gemini server-side, com segredo fora do cliente e saída estruturada validada.
- [ ] Ingredientes, etapas e tempos com proveniência/indicação de incerteza; ausência de dado não vira dado inventado.
- [ ] Receita persiste, pode ser revisada e só fica confirmada após ação do usuário.
- [ ] Ajuste de porções testado; lista de ingredientes não soma unidades incompatíveis.
- [ ] Temporizadores recalculam com timestamps e comunicam limites de notificações em segundo plano.
- [ ] RLS e autorização testadas contra acesso cruzado entre usuários.
- [ ] Proteções contra SSRF, redirects perigosos, prompt injection, abuso, vazamento de segredo e logs sensíveis revisadas.
- [ ] Testes unitários, integração, typecheck e build executados; CI verde no commit que será integrado.
- [ ] Métricas iniciais de latência, falha e custo coletadas; limites de uso definidos.
- [ ] Documentação e variáveis de ambiente correspondem às integrações realmente implementadas.
- [ ] Deploy e smoke tests realizados em ambiente alvo, com rollback conhecido.

### Vertical slice mínimo obrigatório
Demonstrar um fluxo completo, sem mocks de produto: um usuário autorizado fornece uma URL de uma fonte que o conector pode acessar legalmente; a importação é persistida e enfileirada; o worker obtém contexto permitido; Gemini produz uma proposta que passa no schema; a receita e suas evidências são persistidas; o usuário revisa e confirma; ingredientes e etapas são exibidos e podem ser usados no planejamento. O fluxo também deve demonstrar ao menos um caso de erro real sem afirmar sucesso.

### Estado atual conhecido
A fundação inicial já contém UI responsiva, manifest PWA, validação de URL e endpoint que retorna explicitamente `IMPORT_PIPELINE_NOT_CONFIGURED` para URLs válidas. Isso é intencional e honesto, mas não satisfaz o vertical slice. Não considerar Gemini, banco, autenticação, fila, conectores, lista de compras ou temporizadores como implementados até que o código e os testes comprovem esses recursos.

## Registro de execução

### 2026-10-16 — Fundação e contratos iniciais (parcial)

- **Branch:** `feat/recistep-mvp-foundation`.
- **Documentação:** este arquivo `plano.md` foi adicionado com os 14 critérios do MVP.
- **Contratos:** `lib/schemas/recipe.ts` define validação estrita da proposta de receita extraída, ingredientes, etapas, tempos, incertezas e avisos. Campos ausentes são representados explicitamente como `null` quando aplicável; campos inesperados são rejeitados.
- **Regra determinística:** `lib/recipe/scale-portions.ts` calcula ajuste proporcional de ingredientes sem conversão de unidades e sem inventar quantidades desconhecidas.
- **Testes adicionados:** `lib/schemas/recipe.test.ts` e `lib/recipe/scale-portions.test.ts`.
- **Verificação:** os arquivos foram gravados e relidos via GitHub MCP. Não foi possível executar `npm test`, `npm run typecheck` ou `npm run build` neste ambiente; o CI deve confirmar os resultados.
- **Limites:** nenhuma conexão real com Gemini, Supabase, worker/fila ou conector de plataforma foi ativada. O pipeline de importação continua deliberadamente não configurado; portanto, esta etapa é parcial e não representa o vertical slice completo.

Atualizar esta seção a cada etapa concluída com commit/PR, arquivos alterados, testes realmente executados, resultados e limitações. Não marcar uma etapa como concluída apenas porque o código foi escrito; exigir verificação observável.


## Registro de execução — 2026-10-16 (etapa seguinte)

### Implementado no repositório (ainda não validado por execução local)
- Migração SQL com `source_imports`, `recipes`, `ingredients` e `preparation_steps`, índices e RLS por proprietário.
- Adaptador server-only que valida access tokens por Supabase Auth e usa a chave de serviço somente no servidor.
- `POST /api/v1/imports` com autenticação, limite de corpo, idempotência, persistência antes de confirmar e envio de evento Inngest.
- `GET /api/v1/imports/{id}` com escopo de usuário.
- `POST /api/v1/imports/{id}/transcript` para transcrição fornecida pelo usuário, com validação de tamanho e evento que carrega somente o ID.
- Workflow Inngest com retries limitados para metadados públicos, análise direta de vídeo e extração de transcrição.
- Conector YouTube oEmbed para metadados públicos e análise multimodal de URL pública diretamente via Gemini, sem download de vídeo pela aplicação.
- Adaptador Gemini server-only com saída JSON estruturada, validação Zod posterior, evidências literais e preservação de valores desconhecidos como `null`.
- A transcrição é removida do banco após extração bem-sucedida ou erro terminal.

### Limitações e bloqueios explícitos
- Não foi encontrado um projeto Supabase dedicado ao Recistep entre os projetos conectados. A migração não foi aplicada a outro projeto.
- Nenhuma credencial Supabase/Gemini/Inngest foi configurada ou exposta. A rota não funcionará até o ambiente ser configurado.
- A análise de URL do YouTube usa o recurso de vídeo público da API Gemini (em prévia e sujeito a limites do provedor); só vídeos públicos são elegíveis. TikTok e Instagram ainda não têm conector de conteúdo implementado.
- Para YouTube público, a extração Gemini pode analisar diretamente o vídeo; se isso não funcionar ou não houver chave Gemini, o fluxo solicita transcrição autorizada. O rascunho fica em `review_required` e não é salvo como receita confirmada automaticamente.
- O arquivo de migração foi criado diretamente via API do GitHub, pois não havia checkout/CLI Supabase disponível para gerar o nome. Deve ser revisado e validado antes da aplicação.
- Testes, typecheck, build, execução da migração e Supabase advisors **não foram executados** nesta sessão.


### Complemento de interface — 2026-10-16
- A página inicial agora usa o cliente browser Supabase Auth para criar conta, entrar e sair; os access tokens são enviados somente nos cabeçalhos das rotas autenticadas.
- A interface acompanha estados `queued` e `processing`, permite atualização manual e apresenta o campo de transcrição quando o estado exigir conteúdo.
- A UI apresenta ingredientes e etapas do rascunho em `review_required`; persistência normalizada e ação de confirmação humana permanecem como próxima etapa.
- O cliente browser usa apenas variáveis públicas Supabase. A service-role key continua exclusiva do servidor.
- Essas alterações ainda não foram verificadas por uma execução de CI correspondente ao head atual.


### Controles de throughput — 2026-10-16
- Os workers Inngest agora limitam a concorrência e aplicam throttling durável por usuário (2 inícios/minuto com burst 1), enfileirando excesso em vez de descartar o trabalho.
- Isso protege contra rajadas e limita a pressão simultânea sobre Gemini. Cotas rígidas por dia/conta e proteção anti-abuso na camada HTTP ainda precisam ser adicionadas antes de uma implantação pública.
