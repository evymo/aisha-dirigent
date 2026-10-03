-- ============================================================================
-- Source of Truth: get_twin_relation_proposal_queue
-- Popis: GENERICKÝ 'review_queue' blok — skupiny návrhů hran mezi dvojčaty,
--        které čekají na člověka. Položka = SKUPINA (jednotka rozhodnutí),
--        ne jednotlivá hrana: „19 podružných měřidel pod elektroměrem X" je
--        jedna otázka se společným důkazem.
--
-- Konfigurace (p_params, vše volitelné):
--   source    filtr navrhovatele (twin_relation_proposal_groups.source)
--   rule_key  filtr pravidla
--   sample    kolik čekajících hran ukázat v citaci (výchozí 5, strop 20)
--   limit     počet skupin (výchozí 50, strop 200)
--
-- Texty: nadpis skupiny a štítky dvojčat jsou DATA (od navrhovatele a ze zdroje),
-- popisky polí jdou přes klíče app.twins.proposal.* (i18n). Druh vazby se
-- ukazuje přes value_key app.twins.relation.<kind> — nepřeložený klíč je vidět,
-- to je vlastnost (i18n.ts), ne vada.
--
-- Zápis rozhodnutí: submit_evidence_review_audited(entity_kind 'twin_relation',
-- id skupiny) → twin_relation_proposal_decide.
--
-- ⛔ OBÁLKA: maska review_queue vyžaduje {entity_kind, items, actions} a
-- provenance je UZAVŘENÁ na {source_slug, trace_id, freshness_at} — větev bez
-- nároku proto nese tutéž obálku s prázdnými položkami a důvod v trace_id
-- (naměřeno u get_twin_ref_review_block 2026-09-15: jinak klient zahodí blok).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_twin_relation_proposal_queue(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
-- INVOKER: viditelnost rozhoduje RLS nad návrhy i dvojčaty (admin/staff), týž
-- nárok jako sesterské fronty identit. Guard níž jen zajistí tvar odpovědi.
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with akce as (
    select jsonb_build_array(
      jsonb_build_object('action_key', 'app.twins.proposal.action.approve', 'decision', 'approved', 'intent', 'approve'),
      jsonb_build_object('action_key', 'app.twins.proposal.action.reject',  'decision', 'rejected', 'intent', 'reject')
    ) as a
  ),
  cfg as (
    select nullif(p_params->>'source', '')   as src,
           nullif(p_params->>'rule_key', '') as rule,
           least(greatest(coalesce(nullif(p_params->>'sample', '')::int, 5), 1), 20)  as smp,
           least(greatest(coalesce(nullif(p_params->>'limit', '')::int, 50), 1), 200) as lim
  ),
  cekajici as (
    select x.group_id,
           count(*)                                   as pending,
           min(x.confidence)                          as conf_min,
           array_agg(distinct x.relation_kind)        as kinds,
           max(x.updated_at)                          as fresh
      from twin_relation_proposals x
     where x.state = 'proposed'
     group by x.group_id
  ),
  skupiny as (
    select g.id, g.source, g.rule_key, coalesce(g.title, g.group_key) as title,
           c.pending, c.conf_min, c.kinds, greatest(c.fresh, g.updated_at) as fresh,
           (select count(*) from twin_relation_proposals d
             where d.group_id = g.id and d.state in ('approved', 'rejected', 'superseded')) as decided
      from twin_relation_proposal_groups g
      join cekajici c on c.group_id = g.id
     where ((select src from cfg) is null or g.source = (select src from cfg))
       and ((select rule from cfg) is null or g.rule_key = (select rule from cfg))
     order by g.source, coalesce(g.title, g.group_key), g.id
     limit (select lim from cfg)
  ),
  ukazky as (
    -- Prvních N čekajících hran skupiny jako „zdroj → cíl". Štítek dvojčete je
    -- to, co člověk ze zdroje zná (číslo OM, název místnosti), ne UUID.
    select s.id,
           string_agg(coalesce(se.label, x.source_twin_id::text) || ' → ' || coalesce(te.label, x.target_twin_id::text),
                      '; ' order by x.proposal_key) as hrany
      from skupiny s
      cross join lateral (
        select y.proposal_key, y.source_twin_id, y.target_twin_id
          from twin_relation_proposals y
         where y.group_id = s.id and y.state = 'proposed'
         order by y.proposal_key
         limit (select smp from cfg)
      ) x
      left join twin_entities se on se.id = x.source_twin_id
      left join twin_entities te on te.id = x.target_twin_id
     group by s.id
  ),
  polozky as (
    select s.*, u.hrany
      from skupiny s
      left join ukazky u on u.id = s.id
  )
  select case
    when not (public.is_admin_or_staff() or public.is_service_role()) then
      jsonb_build_object(
        'data', jsonb_build_object('entity_kind', 'twin_relation', 'items', '[]'::jsonb,
                                   'actions', (select a from akce)),
        'provenance', jsonb_build_object('source_slug', 'twin-relation-proposals',
          'trace_id', 'twin-relation-queue:unauthorized', 'freshness_at', now()))
    else jsonb_build_object(
      'data', jsonb_build_object(
        'entity_kind', 'twin_relation',
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id',    p.id::text,
                   'title', p.title,
                   'quote', coalesce(p.hrany, '')
                            || case when p.pending > (select smp from cfg)
                                    then ' … (+' || (p.pending - (select smp from cfg))::text || ')'
                                    else '' end,
                   'fields', jsonb_build_array(
                       jsonb_build_object('key', 'pending', 'label_key', 'app.twins.proposal.pending',
                                          'value', p.pending),
                       case when cardinality(p.kinds) = 1
                            then jsonb_build_object('key', 'relation_kind', 'label_key', 'app.twins.proposal.kind',
                                                    'value_key', 'app.twins.relation.' || p.kinds[1])
                            else jsonb_build_object('key', 'relation_kind', 'label_key', 'app.twins.proposal.kind',
                                                    'value', array_to_string(p.kinds, ', '))
                       end,
                       jsonb_build_object('key', 'source', 'label_key', 'app.twins.proposal.source',
                                          'value', p.source)
                     )
                     || case when p.conf_min is null then '[]'::jsonb
                             else jsonb_build_array(jsonb_build_object(
                                    'key', 'confidence', 'label_key', 'app.twins.proposal.confidence',
                                    'value', round(p.conf_min * 100)::text || ' %',
                                    'confidence', p.conf_min)) end
                     || case when p.decided = 0 then '[]'::jsonb
                             else jsonb_build_array(jsonb_build_object(
                                    'key', 'decided', 'label_key', 'app.twins.proposal.decided',
                                    'value', p.decided)) end
                 ) order by p.source, p.title, p.id)
            from polozky p), '[]'::jsonb),
        'actions', (select a from akce)),
      'provenance', jsonb_build_object(
        'source_slug',  'twin-relation-proposals',
        'trace_id',     'twin-relation-queue:' || coalesce((select src from cfg), 'all')
                        || case when not exists (select 1 from polozky) then ':no_data' else '' end,
        'freshness_at', coalesce((select max(fresh) from polozky), now())))
  end;
$$;

REVOKE ALL ON FUNCTION public.get_twin_relation_proposal_queue(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_twin_relation_proposal_queue(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_twin_relation_proposal_queue(jsonb) TO service_role;
