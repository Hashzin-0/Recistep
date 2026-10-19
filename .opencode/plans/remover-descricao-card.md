# Plano: remover descrição do card de receita

## Objetivo
Não exibir a descrição da receita no card da aba "Minhas receitas".

## Arquivo
- `app/minhas-receitas/page.tsx`

## Mudança
Remover a linha:
```
{recipe.description && <p className="recipe-card-description">{recipe.description}</p>}
```
dentro do `.recipe-card-body`.

## Verificação
- `npm run typecheck && npm run build`.
