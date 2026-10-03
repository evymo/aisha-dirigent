-- ============================================================================
-- Source of Truth: get_counterparty_web
-- Popis: blok `relation_web` — SÍŤ VAZEB protistrany (ESDK es-web): entita
--        uprostřed, skupiny vazeb kolem. Každá vazba nese JISTOTU:
--          confirmed  vazbu potvrdil člověk (twin_external_refs.state = confirmed)
--          proposed   navrhl stroj, čeká na člověka (fronta identifikace)
--          derived    odvozeno shodou parametru (IČO/jméno na dokladu, lokalita)
--        Graf nesmí z návrhu udělat fakt — proto se jistota nese v datech a
--        kreslí stylem hrany + slovem.
--
-- ⭐ STAV MODELU, NE PŘÁNÍ (naměřeno 2026-09-23 na <fork>-instanci): `twin_relations` je
--    PRÁZDNÁ (0 řádků). Vazby firma–jednotka–areál–smlouva v modelu jako relace
--    nejsou; žijí jako parametry slovy (jednotka.metadata.lokalita, pronajimatel)
--    a jako návrhy identifikace (identified_tenant: 185 smluv, vše proposed).
--    Tahle funkce je proto skládá z toho, co JE, a každou označí `derived`
--    nebo `proposed` — až vzniknou relace, přibude skupina s `confirmed`.
--
-- Skupiny: identity (twiny firmy — víc uzlů = duplicitní identita) · firmy
--   (naše firmy z faktur: hodnota = dluh, stav po splatnosti) · smlouvy
--   (podle IČO + návrhy identified_tenant) · jednotky (nájemce = jméno
--   protistrany) · arealy (lokalita těch jednotek).
-- Uzel nese `kind` = druh detailu (twin/document), host otevře proklik.
-- ⭐ NEZNÁMÉ ≠ „bez dluhu" (2026-09-28): když žádná faktura naší firmy u téhle
--    protistrany nenese stav úhrady (zdroj ho nedodal), uzel má stav `wait`
--    se slovem „stav úhrady neznámý" a bez částky — ne 0 Kč „bez dluhu".
-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, dohoda 2026-09-24 „opraví se v PR karty"):
--    `freshness_at` = nejnovější příchod verze dokladu (`created_at`) ve STEJNÉM univerzu
--    dokladů protistrany, ze kterého je hodnota — ne čas zavolání. Karta tak neřekne
--    „dnes", když poslední doklad té firmy dorazil před týdny. Prázdné univerzum →
--    `trace_id` nese `:no_data` a `now()` je jen záloha coalesce.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_counterparty_web(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with id as (select icos, names, twins, label from public.counterparty_resolve(p_params)),
  tw as (select (x->>'id')::uuid as id, x->>'label' as label, x->>'certainty' as certainty
           from id, jsonb_array_elements(id.twins) x),
  fa as (
    select d.fields f, d.created_at vznik from id, public.counterparty_docs(id.icos, id.names, 'invoice') d
     where d.fields->'document_subtype'->>'value' = 'issued'
  ),
  -- ── identita: twiny firmy ──
  g_identity as (
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', tw.id::text, 'kind', 'twin', 'label', tw.label,
             'state', case when (select count(*) from tw) > 1 then 'wait' end,
             'state_key', case when (select count(*) from tw) > 1 then 'app.cp.state.duplicate' end,
             'certainty', tw.certainty)) order by tw.label) as nodes
      from tw
  ),
  -- ── naše firmy (z faktur) ──
  firmy as (
    select f->'owner_company'->>'value' as firma,
           sum((f->'amount_unpaid'->>'value')::numeric) filter (
             where f->'amount_unpaid'->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$'
               and (f->'amount_unpaid'->>'value')::numeric > 0.005) as dluh,
           bool_or(f->'amount_unpaid'->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$'
               and (f->'amount_unpaid'->>'value')::numeric > 0.005
               and f->'due_date'->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
               and (f->'due_date'->>'value')::date < current_date) as po_splatnosti,
           count(*) filter (where f->'amount_unpaid'->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$') as se_stavem,
           count(*) as n
      from fa where coalesce(f->'owner_company'->>'value', '') <> ''
     group by 1
  ),
  g_firmy as (
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             -- proklik jen na JEDNOZNAČNÝ twin naší firmy (jméno → twin je shoda parametru)
             'id', (select min(t.id::text) from public.twin_entities t
                     where t.entity_type = 'company' and t.status = 'active' and t.label = firmy.firma
                    having count(*) = 1),
             'kind', 'twin', 'label', firma,
             -- bez jediného stavu úhrady: žádná částka (strip_nulls ji vypustí)
             'value', case when se_stavem > 0 then round(coalesce(dluh, 0)) end,
             'unit_key', case when se_stavem > 0 then 'app.units.czk' end,
             'state', case when se_stavem = 0 then 'wait' when po_splatnosti then 'fault' else 'ok' end,
             'state_key', case when se_stavem = 0 then 'app.cp.state.payment_unknown'
                               when po_splatnosti then 'app.cp.state.overdue' else 'app.cp.state.paid_up' end,
             'certainty', 'derived')) order by coalesce(dluh, 0) desc, firma) as nodes
      from firmy
  ),
  -- ── smlouvy: podle IČO (derived) + návrhy identifikace k twinům (proposed/confirmed) ──
  -- jedna odpověď s hlavičkou karty (counterparty_contracts), jedna smlouva jednou
  smlouvy1 as (
    select c.doc_slug, c.filename, c.fields as f, c.certainty
      from id, public.counterparty_contracts(id.icos, id.names, id.twins) c
  ),
  g_smlouvy as (
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', doc_slug, 'kind', 'document',
             'label', coalesce(f->'contract_number'->>'value', filename, doc_slug),
             'sub', f->'valid_to'->>'value',
             'value', case when f->'amount'->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$' then round((f->'amount'->>'value')::numeric) end,
             'unit_key', case when f->'amount'->>'value' ~ '^-?[0-9]+(\.[0-9]+)?$' then 'app.units.czk' end,
             'state', case when f->'valid_to'->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
                           then case when (f->'valid_to'->>'value')::date < current_date then 'wait' else 'ok' end end,
             'state_key', case when f->'valid_to'->>'value' ~ '^\d{4}-\d{2}-\d{2}$'
                           then case when (f->'valid_to'->>'value')::date < current_date then 'app.cp.state.expired' else 'app.cp.state.valid' end end,
             'certainty', certainty)) order by f->'valid_to'->>'value' desc nulls last) as nodes
      from (select doc_slug, filename, f, certainty from smlouvy1
             order by f->'valid_to'->>'value' desc nulls last limit 12) s
  ),
  -- ── jednotky: nájemce (label jednotky) = jméno protistrany; odvozeno ──
  jednotky as (
    select u.id, u.label, u.metadata
      from id, public.twin_entities u
     where u.entity_type = 'unit' and u.status = 'active' and u.label = any(id.names)
  ),
  g_jednotky as (
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', id::text, 'kind', 'twin',
             'label', coalesce(metadata->>'adresa', label), 'sub', metadata->>'lokalita',
             'certainty', 'derived')) order by metadata->>'lokalita', label) as nodes
      from jednotky
  ),
  -- ── areály: lokalita jednotek → twin objektu; odvozeno ──
  g_arealy as (
    select jsonb_agg(jsonb_build_object(
             'id', o.id::text, 'kind', 'twin', 'label', o.label, 'certainty', 'derived') order by o.label) as nodes
      from public.twin_entities o
     where o.entity_type = 'object' and o.status = 'active'
       and o.label in (select metadata->>'lokalita' from jednotky)
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      -- `label` je v masce povinný: bez rozřešené protistrany (volání bez
      -- parametrů — brána surface-block-contract.runtime) prázdný řetězec, ne
      -- null, který by strip_nulls vypustil a blok by shell zahodil.
      'center', jsonb_strip_nulls(jsonb_build_object(
        'label', coalesce((select label from id), ''),
        'sub', nullif(array_to_string((select icos from id), ', '), ''))),
      -- prázdná skupina se nevydá (JAZYK-03)
      'groups', coalesce((select jsonb_agg(g order by o) from (values
          (1, jsonb_build_object('key','identity','label_key','app.cp.group.identity','nodes',(select nodes from g_identity))),
          (2, jsonb_build_object('key','companies','label_key','app.cp.group.companies','nodes',(select nodes from g_firmy))),
          (3, jsonb_build_object('key','contracts','label_key','app.cp.group.contracts','nodes',(select nodes from g_smlouvy))),
          (4, jsonb_build_object('key','units','label_key','app.cp.group.units','nodes',(select nodes from g_jednotky))),
          (5, jsonb_build_object('key','sites','label_key','app.cp.group.sites','nodes',(select nodes from g_arealy)))
        -- `case`, ne `and`: SQL nezaručuje zkrácené vyhodnocení a jsonb_array_length
        -- na skaláru (skupina bez uzlů = null) spadne
        ) v(o, g) where case when jsonb_typeof(g->'nodes') = 'array' then jsonb_array_length(g->'nodes') else 0 end > 0), '[]'::jsonb)),
    'provenance', jsonb_build_object(
      'source_slug', 'twin+doc-evidence',
      'trace_id', 'counterparty-web' || case when (select max(vznik) from fa) is null then ':no_data' else '' end,
      'freshness_at', to_char(coalesce((select max(vznik) from fa), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
$$;

REVOKE ALL ON FUNCTION public.get_counterparty_web(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_counterparty_web(jsonb) TO authenticated, service_role;
