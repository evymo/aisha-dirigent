-- ============================================================================
-- Source of Truth: get_twin_ref_review_block
-- Popis: GENERICKÝ 'review_queue' blok — navržené twin identity vazby
--        k lidské ratifikaci (návrh není zápis). Texty položek se skládají
--        z ŠABLON v konfiguraci bloku — žádná prezentace v kódu.
--
-- Konfigurace (p_params):
--   source            POVINNÉ   twin_external_refs.source
--   title_template    POVINNÉ   placeholdery: {label} {filename} {confidence} {note}
--   quote_template    POVINNÉ   tytéž placeholdery
--   entity_type       volitelné filtr twin_entities.entity_type
--   filename_fallback volitelné text místo chybějícího filename (default '')
--   limit             volitelné počet položek (výchozí 100, strop 500)
--
-- Placeholder sémantika: {confidence} = round(conf*100) · {note} = ' · <note>'
--   nebo prázdno (oddělovač je součást hodnoty, šablona ho nedubluje).
-- Vzniklo vykostěním get_porada_review (07-25).
--
-- ⛔ OBÁLKA review_queue (naměřeno 2026-09-15): funkce vracela jen {items}.
-- Maska review_queue vyžaduje {entity_kind, items, actions} (packages/
-- surface-blocks/src/schemas.ts) — klient takový blok ZAHODIL, takže 907
-- návrhů identit z ingestu Raynetu správce nikdy neviděl, a i kdyby, neměl
-- by čím rozhodnout. Brána kontraktu to nechytila: bez konfigurace funkce
-- vracela {items:[]}, což měřidlo zařadilo jako „nemíří na žádnou masku".
-- Teď nese obálku KAŽDÁ větev; akce jsou tytéž jako u sesterské
-- get_twin_identity_queue a zápis jde přes submit_evidence_review_audited
-- (entity_kind 'twin_identity' → twin_identity_confirm/reject_binding).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_twin_ref_review_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
-- ⛔ SECURITY INVOKER, NE DEFINER (bezpečnostní oprava 2026-07-31).
-- Jako DEFINER běžela funkce pod právy vlastníka → RLS nad twin_external_refs
-- a li_source_registry se NEUPLATNILA a jediný guard byl `auth.uid() is null`,
-- tedy pouhé PŘIHLÁŠENÍ. Změřeno na produkci: uživatel BEZ JAKÝCHKOLI ROLÍ
-- dostal přes blok pd_review 14 položek twin identity návrhů (jména reálných
-- protistran), zatímco sesterské bloky nad týmiž daty (get_document_register,
-- get_obligation_queue, get_evidence_findings — všechny INVOKER) mu správně
-- vracely prázdno. Dva bloky z pěti tedy obcházely nárok.
-- Po přepnutí (změřeno v rollback transakci): bez rolí 0 · admin 14 (beze změny).
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with akce as (
    -- Tytéž rozhodnutí jako get_twin_identity_queue; dispečer je přeloží
    -- na twin_identity_confirm_binding / twin_identity_reject_binding.
    select jsonb_build_array(
      jsonb_build_object('action_key', 'app.twins.action.confirm', 'decision', 'confirmed', 'intent', 'approve'),
      jsonb_build_object('action_key', 'app.twins.action.reject',  'decision', 'rejected',  'intent', 'reject')
    ) as a
  ),
  cfg as (
    select p_params->>'source' as src,
           p_params->>'entity_type' as etype,
           p_params->>'title_template' as t_tpl,
           p_params->>'quote_template' as q_tpl,
           coalesce(p_params->>'filename_fallback', '') as f_fb,
           least(greatest(coalesce(nullif(p_params->>'limit', '')::int, 100), 1), 500) as lim,
           -- Osa „podle firmy" (2026-09-28) jen tam, kde ji konfigurace bloku zapne
           -- (`scope_map.owner_company.via = 'document'`): návrh patří firmě přes
           -- doklad, ze kterého vzešel. Návrhy BEZ dokladu (např. „naše firma" z agendy
           -- Money) by filtr vyprázdnil — takový blok osu nezapíná a klient ho označí
           -- jako nefiltrovaný, místo aby mlčky ukázal nic.
           nullif(p_params->>'owner_company', '') as firma,
           p_params#>>'{scope_map,owner_company,via}' = 'document' as po_dokladu
  ),
  items as (
    select r.id, r.confidence as conf,
           replace(replace(replace(replace((select t_tpl from cfg),
             '{label}', coalesce(c.label, '')),
             '{filename}', coalesce(li.filename, (select f_fb from cfg))),
             '{confidence}', round(coalesce(r.confidence, 0) * 100)::text),
             '{note}', coalesce(' · ' || r.note, '')) as title,
           replace(replace(replace(replace((select q_tpl from cfg),
             '{label}', coalesce(c.label, '')),
             '{filename}', coalesce(li.filename, (select f_fb from cfg))),
             '{confidence}', round(coalesce(r.confidence, 0) * 100)::text),
             '{note}', coalesce(' · ' || r.note, '')) as quote
    from twin_external_refs r
    join twin_entities c on c.id = r.twin_id
      and ((select etype from cfg) is null or c.entity_type = (select etype from cfg))
    -- Dokument se dohledá OBĚMA identitami, které návrhy nosí: platformní UUID
    -- (porada lane) i content-addressed sha256 (promoce z ingestu — engine
    -- platformní UUID nezná a znát nemá; sha je identita dokladu napříč světy).
    --
    -- ⛔ DVA JOINY, NE JEDEN S `OR` (naměřeno 2026-09-23 na produkci): blok
    -- `sm_identifikace` (source local-ingest, tisíce návrhů) neodpověděl do 30 s
    -- a držel kostru celé sekce Smlouvy ~20 s. `id::text = k OR source_sha256 = k`
    -- nesmí použít ani funkční index na id::text, ani unikátní index na
    -- source_sha256 — plánovač porovná každý návrh s každým dokladem. Každá
    -- identita zvlášť jde po svém indexu.
    left join li_source_registry li_id  on li_id.id::text = r.source_key
    left join li_source_registry li_sha on li_sha.source_sha256 = r.source_key
    cross join lateral (select coalesce(li_id.filename, li_sha.filename) as filename) li
    where r.source = (select src from cfg)
      and r.state = 'proposed'
      and ((select firma from cfg) is null
           or (select po_dokladu from cfg) is not true
           or coalesce(li_id.fields, li_sha.fields)->'owner_company'->>'value' = (select firma from cfg))
  ),
  -- Fronta k ratifikaci je pracovní seznam, ne export: bez stropu vydala VŠECHNY
  -- návrhy zdroje (tisíce položek) v jedné odpovědi.
  vybrane as (
    select * from items order by conf desc nulls last, id limit (select lim from cfg)
  )
  select case
    -- ⛔ NÁROK, NE JEN PŘIHLÁŠENÍ (naměřeno 2026-09-11): ratifikace vazeb je práce
    -- správce; guard ověřoval jen přihlášení, takže ji viděl kterýkoli řidič.
    when not (public.is_admin_or_staff() or public.is_service_role()) then
      -- ⭐ Provenance je UZAVŘENÁ na {source_slug, trace_id, freshness_at} —
      -- `error` ji poruší a klient zahodí CELÝ blok, takže se přiznání
      -- k uživateli nikdy nedostane (týž nález jako u get_twin_ref_pending_block
      -- a get_doc_expiry_review_block). Důvod patří do `trace_id`.
      -- Do 2026-09-12 tahle větev nevadila, protože na ni dosáhl jen
      -- NEPŘIHLÁŠENÝ; od zpřísnění guardu na nárok ji potká každý běžný člen.
      jsonb_build_object('data', jsonb_build_object('entity_kind', 'twin_identity', 'items', '[]'::jsonb,
          'actions', (select a from akce)),
        'provenance', jsonb_build_object('source_slug', 'twin-identity',
          'trace_id', 'twin-ref-review:unauthorized', 'freshness_at', now()))
    when (select src from cfg) is null
      or (select t_tpl from cfg) is null or (select q_tpl from cfg) is null then
      jsonb_build_object('data', jsonb_build_object('entity_kind', 'twin_identity', 'items', '[]'::jsonb,
          'actions', (select a from akce)),
        'provenance', jsonb_build_object('source_slug', 'twin-identity',
          'trace_id', 'twin-ref-review:missing_config', 'freshness_at', now()))
    else jsonb_build_object(
      'data', jsonb_build_object('entity_kind', 'twin_identity', 'items', coalesce(
        (select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'quote', quote)
                          order by conf desc nulls last, id) from vybrane), '[]'::jsonb),
        'actions', (select a from akce)),
      'provenance', jsonb_build_object('source_slug', 'twin-identity',
        'trace_id', 'twin-ref-review:' || (select src from cfg), 'freshness_at', now())
        || case when (select po_dokladu from cfg) then public.scope_applied(p_params, 'owner_company')
                else '{}'::jsonb end)
  end;
$$;

REVOKE ALL ON FUNCTION public.get_twin_ref_review_block(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_twin_ref_review_block(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_twin_ref_review_block(jsonb) TO service_role;
