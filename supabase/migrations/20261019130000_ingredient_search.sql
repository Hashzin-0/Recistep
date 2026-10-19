-- Busca de receitas por ingrediente (assistente de voz em "Minhas receitas").
-- Índice trigram para acelerar o ILIKE '%termo%' em ingredients.name.
create extension if not exists pg_trgm;

create index if not exists ingredients_name_trgm_idx
  on public.ingredients using gin (name gin_trgm_ops);
