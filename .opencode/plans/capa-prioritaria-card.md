# Plano: capa prioritária no card horizontal

## Objetivo
Aumentar a proporção da capa no card horizontal da aba "Minhas receitas" para ~60% da largura, deixando o conteúdo (título, descrição, meta, ações) em ~40%.

## Arquivo
- `app/globals.css`

## Mudanças
Em `.recipe-card-horizontal`:
- `.recipe-card-media`: `flex: 3 1 0` (em vez de largura fixa 116px/88px).
- `.recipe-card-body`: `flex: 2 1 0`.
- Manter `min-width: 0` e `object-fit: cover` na capa.
- Em mobile, manter a mesma proporção (sem voltar a largura fixa), apenas reduzir gap se necessário.

## Verificação
- `npm run build`.
