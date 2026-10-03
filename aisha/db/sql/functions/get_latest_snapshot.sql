-- Poslední platný podepsaný snímek pro surface. SECURITY INVOKER (RLS: jen neexpirované).
-- Vrací payload + podpisová pole — klient si podpis ověřuje pinovaným public klíčem.

create or replace function public.get_latest_snapshot(p_surface text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.payload || jsonb_build_object(
           'sha256',    s.sha256,
           'signature', s.signature,
           'key_id',    s.key_id
         )
  from public.surface_snapshots s
  where s.surface = p_surface
    and s.expires_at > now()
  order by s.published_at desc
  limit 1;
$$;

-- Grants: authenticated + service_role (NOT anon, #566 floor); RLS on the underlying
-- tables is the real access boundary (SECURITY INVOKER — runs as the caller).
REVOKE ALL ON FUNCTION public.get_latest_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_snapshot(text) TO authenticated, service_role;
