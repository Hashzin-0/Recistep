# Recistep

Aplicativo de receitas inteligentes para transformar fontes de vídeo acessíveis em receitas estruturadas, listas de ingredientes e sessões de preparo.

## Estado atual

Esta branch contém a fundação da aplicação: interface responsiva inicial, metadados PWA, validação de URLs no servidor e testes unitários para a validação. **A extração de mídia, Gemini, autenticação, banco, fila durável e salvamento de receitas ainda não estão integrados.** A API responde explicitamente com `IMPORT_PIPELINE_NOT_CONFIGURED` após validar uma URL, em vez de simular uma importação.

## Stack inicial

- Next.js App Router + React + TypeScript
- Zod para validação da entrada HTTP
- Vitest para testes unitários
- PWA manifest
- CSS responsivo com foco em acessibilidade e estados de interação

## Desenvolvimento local

Requer Node.js 20.9 ou superior.

```bash
npm install
npm run dev
```

## Verificações

```bash
npm test
npm run typecheck
npm run build
```

## Importação por URL

`POST /api/v1/imports`

```json
{
  "source_url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "locale": "pt-BR"
}
```

A rota valida o corpo e restringe os hosts reconhecidos. No estado atual, retorna HTTP 503 com o código `IMPORT_PIPELINE_NOT_CONFIGURED` para fontes válidas, porque a aquisição e o processamento durável ainda não foram implementados. Não faz requisições de rede à URL fornecida.

## Segurança e configuração

- Não adicione segredos a arquivos versionados.
- `.env.example` lista apenas nomes de configuração futuros.
- Validar a URL não autoriza baixar a mídia. Cada conector precisará de método de acesso permitido e validação dos redirecionamentos.
- Antes de habilitar o processamento, implementar autenticação/autorização, rate limiting, fila idempotente, limites de custo e políticas de retenção.
- Nenhuma credencial Supabase, Gemini ou Inngest está configurada por esta alteração.

## Próxima etapa

Implementar um conector autorizado real e o pipeline assíncrono com persistência, seguido da integração Gemini com saída estruturada, evidências e revisão humana. A integração só deve ser considerada pronta após testes com conteúdo acessível e confirmação dos limites do provedor.
