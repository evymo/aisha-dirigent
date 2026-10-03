-- ============================================================================
-- Source of Truth: get_twin_ref_pending_block
-- Popis: GENERICKÝ 'kpi_tile' blok — počet navržených (neratifikovaných)
--        twin identity vazeb z daného zdroje; >0 = warning (fronta na
--        člověka). Zdroj je KONFIGURACE bloku, ne konstanta v kódu.
--
-- Konfigurace (p_params):
--   source  POVINNÉ   twin_external_refs.source (slug lane, který blok hlídá)
--   state   volitelné default 'proposed' (slovník mechanismu, ne instance)
--
-- Poctivá degradace: bez source → error='missing_config'.
-- Vzniklo vykostěním get_porada_pending (07-25).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_twin_ref_pending_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  select case
    -- ⛔ NÁROK, NE JEN PŘIHLÁŠENÍ (naměřeno 2026-09-11): guard ověřoval, že jsi
    -- přihlášený, ne že na to máš nárok — řidič bez rolí dostával totéž co admin.
    when not (public.is_admin_or_staff() or public.is_service_role()) then
      -- ⭐ POCTIVÁ DEGRADACE MUSÍ BÝT KONTRAKTNÍ, jinak se zahodí i ona.
      -- Do 2026-08-08 tu stálo `'provenance', jsonb_build_object('error', …)`:
      -- provenance je uzavřená na {source_slug, freshness_at, trace_id}, takže
      -- klient CELÝ blok zahodil a přiznání se k uživateli nikdy nedostalo.
      -- Důvod patří do `trace_id` — stejně jako u get_doc_expiry_review_block.
      -- `value` je null, ne nula: nula by tvrdila měření, které nikdo neprovedl.
      jsonb_build_object('data', jsonb_build_object('value', null),
        'provenance', jsonb_build_object('source_slug', 'twin-identity',
          'trace_id', 'twin-ref-pending:unauthenticated', 'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    when p_params->>'source' is null then
      jsonb_build_object('data', jsonb_build_object('value', null),
        'provenance', jsonb_build_object('source_slug', 'twin-identity',
          'trace_id', 'twin-ref-pending:missing_config', 'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    else (
      select jsonb_build_object(
        'data', jsonb_build_object('value', n, 'state', case when n > 0 then 'warning' else 'ok' end),
        'provenance', jsonb_build_object('source_slug', 'twin-identity',
          'trace_id', 'twin-ref-pending:' || (p_params->>'source'), 'freshness_at', now()))
      from (select count(*) as n
            from twin_external_refs
            where source = p_params->>'source'
              and state = coalesce(p_params->>'state', 'proposed')) q)
  end;
$$;

REVOKE ALL ON FUNCTION public.get_twin_ref_pending_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_twin_ref_pending_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_twin_ref_pending_block(jsonb) TO service_role;
