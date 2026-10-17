-- Durable per-user rate limits; counters are shared across Vercel serverless instances.
create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  route_key text not null check (length(route_key) between 1 and 80),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, route_key, window_start)
);
create index if not exists api_rate_limits_window_idx on public.api_rate_limits (window_start);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.api_rate_limits to service_role;

create or replace function public.consume_api_rate_limit(
  p_user_id uuid,
  p_route_key text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
  v_retry integer;
begin
  if p_user_id is null or p_route_key is null or length(p_route_key) not between 1 and 80
     or p_limit < 1 or p_limit > 1000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_RATE_LIMIT_ARGUMENTS' using errcode = '22023';
  end if;
  v_window_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into public.api_rate_limits(user_id, route_key, window_start, request_count, updated_at)
  values (p_user_id, p_route_key, v_window_start, 1, now())
  on conflict (user_id, route_key, window_start)
  do update set request_count = public.api_rate_limits.request_count + 1, updated_at = now()
  returning request_count into v_count;
  v_retry := greatest(1, ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - clock_timestamp())))::integer);
  -- Opportunistic bounded cleanup for this account only.
  delete from public.api_rate_limits
    where user_id = p_user_id and window_start < now() - interval '2 days';
  return jsonb_build_object('allowed', v_count <= p_limit, 'count', v_count,
    'limit', p_limit, 'window_seconds', p_window_seconds, 'retry_after_seconds', v_retry);
end;
$$;
revoke all on function public.consume_api_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(uuid, text, integer, integer) to service_role;
