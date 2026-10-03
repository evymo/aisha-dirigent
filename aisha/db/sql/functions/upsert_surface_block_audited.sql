-- Admin zápis definice bloku. SERVICE-ROLE-ONLY přes NULL-safe public.is_service_role() (#588)
-- — fail-closed: bez jwt claims / s cizí rolí končí výjimkou.

create or replace function public.upsert_surface_block_audited(
  p_block_slug     text,
  p_block_type     text,
  p_title_key      text,
  p_source_rpc     text,
  p_source_params  jsonb default '{}'::jsonb,
  p_namespace      text default '',
  p_sensitivity    text default 'internal',
  p_schema_version integer default 1,
  p_is_active      boolean default false
)
returns uuid
language plpgsql
security definer
SET search_path TO 'public'
as $$
declare
  v_id uuid;
begin
  if not public.is_service_role() then
    raise exception 'service role required' using errcode = '42501';
  end if;

  insert into public.surface_blocks as sb
    (block_slug, block_type, title_key, source_rpc, source_params,
     namespace, sensitivity, schema_version, is_active)
  values
    (p_block_slug, p_block_type, p_title_key, p_source_rpc, coalesce(p_source_params, '{}'::jsonb),
     p_namespace, p_sensitivity, p_schema_version, p_is_active)
  on conflict (block_slug) do update set
    block_type     = excluded.block_type,
    title_key      = excluded.title_key,
    source_rpc     = excluded.source_rpc,
    source_params  = excluded.source_params,
    namespace      = excluded.namespace,
    sensitivity    = excluded.sensitivity,
    schema_version = excluded.schema_version,
    is_active      = excluded.is_active,
    updated_at     = now()
  returning sb.id into v_id;

  -- Audit — platformní vzor (přímý INSERT do audit_journal, aditivně, hash-chain #585);
  -- tvar sloupců ověřen proti HEAD 3c731b11 (aitg_get_coverage_audited).
  insert into public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  values (auth.uid(), 'surface.block_upserted', 'surface.block_upserted', 'content', 'info',
          array['surface', 'write'],
          jsonb_build_object('block_slug', p_block_slug, 'block_type', p_block_type,
                             'sensitivity', p_sensitivity, 'is_active', p_is_active));

  return v_id;
end;
$$;

revoke all on function public.upsert_surface_block_audited(text,text,text,text,jsonb,text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.upsert_surface_block_audited(text,text,text,text,jsonb,text,text,integer,boolean) to service_role;
