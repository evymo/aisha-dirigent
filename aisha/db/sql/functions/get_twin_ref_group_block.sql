-- ============================================================================
-- Source of Truth: get_twin_ref_group_block
-- Popis: 'review_queue' blok SKUPIN návrhů identit — jedna položka = jedna třída
--        shody (twin_ref_tridy), kterou konfigurace bloku povoluje schválit
--        hromadně. Potvrzení položky schválí celou skupinu: dispečer
--        submit_evidence_review_audited (entity_kind 'twin_identity_group') →
--        twin_ref_group_decide, který třídu v okamžiku provedení spočítá ZNOVU.
--        Týž vzor jako skupiny návrhů vazeb (položka fronty = skupina) — žádná
--        nová pole v masce, žádný nový ovladač v klientech.
--
-- ⛔ Majitel 2026-09-28: „teprve dva zdroje pravdy se shodou sto procent
-- opravňují k návrhu na hromadné sloučení". Které třídy smějí do dávky, říkají
-- DATA bloku (`batch_classes`), ne kód; třída, která tam není, se nenabídne.
--
-- Konfigurace (p_params) — táž jako twin_ref_tridy, navíc:
--   batch_classes   POVINNÉ  pole tříd, které smějí do dávky (např. ["shoda_dva_zdroje"]);
--                            chybí (i JSON null) → `missing_config`, není pole → `bad_config`
--   title_template  POVINNÉ  placeholdery {trida} {pocet} {zdroje}
--   quote_template  POVINNÉ  tytéž placeholdery
--   class_titles    volitelné {trida: text} — text za {trida} (jinak kód třídy)
--
-- Id položky = md5('twin_ref_group:' || source || ':' || entity_type || ':' ||
-- group_key)::uuid — deterministické, takže dávka najde konfiguraci v bloku
-- (surface_blocks) a nic se neukládá navíc.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_twin_ref_group_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
-- SECURITY INVOKER jako sesterský get_twin_ref_review_block (bezpečnostní oprava
-- 2026-07-31): RLS nad návrhy a doklady se uplatní a guard níž je nárok, ne přihlášení.
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with akce as (
    select jsonb_build_array(
      jsonb_build_object('action_key', 'app.twins.action.confirm', 'decision', 'confirmed', 'intent', 'approve')
    ) as a
  ),
  cfg as (
    select p_params->>'source' as src,
           coalesce(p_params->>'entity_type', '') as etype,
           p_params->'batch_classes' as bc,
           p_params->>'title_template' as t_tpl,
           p_params->>'quote_template' as q_tpl,
           coalesce(p_params->'class_titles', '{}') as ct
  ),
  -- Třídy se spočítají JEDNOU (jeden průchod pravidlem nese celý korpus).
  t as (select x.group_key, x.trida, x.zdroje from public.twin_ref_tridy(p_params) x),
  skupiny as (
    select t.group_key, t.trida, count(*) as pocet,
           (select string_agg(distinct z, ' + ' order by z)
              from t t2 cross join lateral unnest(t2.zdroje) z
             where t2.group_key = t.group_key) as zdroje
    from t
    where t.trida in (select jsonb_array_elements_text((select bc from cfg)))
    group by t.group_key, t.trida
  ),
  -- ČERSTVOST Z DAT: nejnovější změna návrhů, ze kterých fronta vzniká (ne hodiny
  -- serveru); prázdná fronta → trace_id přizná :no_data.
  cerstvost as (
    select max(r.updated_at) as vznik
    from public.twin_external_refs r
    where r.source = (select src from cfg) and r.state = 'proposed'
  ),
  polozky as (
    select md5('twin_ref_group:' || (select src from cfg) || ':' || (select etype from cfg)
               || ':' || s.group_key)::uuid as id,
           s.pocet,
           replace(replace(replace((select t_tpl from cfg),
             '{trida}', coalesce((select ct from cfg)->>s.trida, s.trida)),
             '{pocet}', s.pocet::text),
             '{zdroje}', coalesce(s.zdroje, '')) as title,
           replace(replace(replace((select q_tpl from cfg),
             '{trida}', coalesce((select ct from cfg)->>s.trida, s.trida)),
             '{pocet}', s.pocet::text),
             '{zdroje}', coalesce(s.zdroje, '')) as quote
    from skupiny s
  )
  select case
    when not (public.is_admin_or_staff() or public.is_service_role()) then
      jsonb_build_object('data', jsonb_build_object('entity_kind', 'twin_identity_group',
          'items', '[]'::jsonb, 'actions', (select a from akce)),
        'provenance', jsonb_build_object('source_slug', 'twin-identity',
          'trace_id', 'twin-ref-group:unauthorized', 'freshness_at', now()))
    when (select src from cfg) is null or (select t_tpl from cfg) is null
      or (select q_tpl from cfg) is null
      or coalesce(jsonb_typeof((select bc from cfg)), 'null') = 'null'
      or p_params->'date_fields' is null then
      jsonb_build_object('data', jsonb_build_object('entity_kind', 'twin_identity_group',
          'items', '[]'::jsonb, 'actions', (select a from akce)),
        'provenance', jsonb_build_object('source_slug', 'twin-identity',
          'trace_id', 'twin-ref-group:missing_config', 'freshness_at', now()))
    -- `batch_classes` v datech JE, ale není to pole tříd → vadná konfigurace, ne „chybí“
    -- (slovník důvodů: brána cerstvost-z-dat). Dávka se nenabídne.
    when jsonb_typeof((select bc from cfg)) <> 'array' then
      jsonb_build_object('data', jsonb_build_object('entity_kind', 'twin_identity_group',
          'items', '[]'::jsonb, 'actions', (select a from akce)),
        'provenance', jsonb_build_object('source_slug', 'twin-identity',
          'trace_id', 'twin-ref-group:bad_config', 'freshness_at', now()))
    else jsonb_build_object(
      'data', jsonb_build_object('entity_kind', 'twin_identity_group', 'items', coalesce(
        (select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'quote', quote)
                          order by pocet desc, id) from polozky), '[]'::jsonb),
        'actions', (select a from akce)),
      'provenance', jsonb_build_object('source_slug', 'twin-identity',
        'trace_id', 'twin-ref-group:' || (select src from cfg)
          || case when (select vznik from cerstvost) is null then ':no_data' else '' end,
        'freshness_at', coalesce((select vznik from cerstvost), now())))
  end;
$$;

REVOKE ALL ON FUNCTION public.get_twin_ref_group_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_twin_ref_group_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_twin_ref_group_block(jsonb) TO service_role;
