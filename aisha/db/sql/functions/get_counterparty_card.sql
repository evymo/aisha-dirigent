-- ============================================================================
-- Source of Truth: get_counterparty_card
-- Popis: blok `record_detail` — hlavička karty protistrany: kdo to je, kolik
--        twinů ho v modelu nese, pod jakými jmény vystupoval v čase, s kým z nás
--        obchoduje. Vstup {debtor} nebo {twin_id} (counterparty_resolve).
--
-- Odznaky (i18n klíče) nesou NÁLEZ identity: víc twinů téhož IČO = roztříštěná
-- identita (k úklidu), žádný twin = protistrana v modelu neexistuje. Obojí je
-- stav dat, který má správce vidět u konkrétní firmy, ne v souhrnu.
-- Jména v čase se berou z DOKLADŮ (jméno · první–poslední doklad), protože firma
-- se přejmenovává a jméno není identita (jméno je parametr v čase). Období je
-- výskyt jména v NAŠICH dokladech, ne platnost jména v rejstříku — popisek to
-- říká slovy („v našich dokladech").
--
-- ⭐ SOUČASNOST PRVNÍ (majitel 2026-09-28): uživatel se ptá na aktuální stav,
--    historie doplňuje. Hned pod identitou proto stojí VZTAH V ČASE
--    (counterparty_periods — tatáž pravda jako Ask): odběratel / dodavatel
--    první → poslední vystavený doklad do dneška, a doklady, k nimž zdroj
--    NEDODAL stav úhrady (počet + období). Bez nich karta u firmy, s níž
--    naposledy obchodovala před lety, ukazovala „bez dluhu" a nic o čase.
-- ⭐ ČERSTVOST Z DAT (brána `cerstvost-z-dat`, dohoda 2026-09-24 „opraví se v PR karty"):
--    `freshness_at` = nejnovější příchod verze dokladu (`created_at`) ve STEJNÉM univerzu
--    dokladů protistrany, ze kterého je hodnota — ne čas zavolání. Karta tak neřekne
--    „dnes", když poslední doklad té firmy dorazil před týdny. Prázdné univerzum →
--    `trace_id` nese `:no_data` a `now()` je jen záloha coalesce.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_counterparty_card(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  with id as (select icos, names, twins, label from public.counterparty_resolve(p_params)),
  fa as (
    select d.fields f, d.created_at vznik from id, public.counterparty_docs(id.icos, id.names, 'invoice') d
  ),
  -- smlouvy podle IČO i navržené k twinu — týž výčet jako síť vazeb
  sm as (
    select count(*) n, count(*) filter (where c.certainty = 'proposed') navrzeno
      from id, public.counterparty_contracts(id.icos, id.names, id.twins) c
  ),
  -- vztah v čase: role × období (kódy storna z parametrů bloku, jsou-li)
  vz as (
    select p.* from id, public.counterparty_periods(id.icos, id.names, public.storno_values_param(p_params)) p
  ),
  jm as (
    select f->'counterparty'->>'value' as jmeno,
           min(f->'issue_date'->>'value') filter (where f->'issue_date'->>'value' ~ '^\d{4}-\d{2}-\d{2}$') as od,
           max(f->'issue_date'->>'value') filter (where f->'issue_date'->>'value' ~ '^\d{4}-\d{2}-\d{2}$') as do_
      from fa where f->'counterparty'->>'value' is not null group by 1
  ),
  -- ⭐ SCHVÁLENÉ JMÉNO (majitel 2026-09-28): název platí po schválení; změna jména na
  -- dokladu má přijít jako návrh ingestu a UPOZORNIT. Pole „Název" je proto ke kontrole,
  -- když firma schválený název nemá, nebo když se nejnovější jméno z dokladů od
  -- schváleného liší (firma se přejmenovala a návrh čeká na schválení).
  schv as (
    select r.source_key as jmeno
      from id
      cross join lateral jsonb_array_elements(id.twins) t
      join public.twin_external_refs r on r.twin_id = (t->>'id')::uuid
     where r.ref_kind in ('company_name', 'nase_firma') and r.state = 'confirmed'
       and (r.valid_to is null or r.valid_to > now())
     order by r.valid_from desc nulls last, r.confirmed_at desc nulls last
     limit 1
  ),
  posledni as (
    select btrim(f->'counterparty'->>'value') as jmeno from fa
     where length(btrim(coalesce(f->'counterparty'->>'value', ''))) between 2 and 80
     order by f->'issue_date'->>'value' desc nulls last limit 1
  ),
  pole as (
    select jsonb_build_array(
      jsonb_build_object('key','nazev', 'label_key','app.cp.field.name',  'value', (select label from id),
        'state', case when (select jmeno from schv) is null then 'needs_review'
                      when (select jmeno from posledni) is not null
                           and lower((select jmeno from posledni)) <> lower((select jmeno from schv)) then 'needs_review'
                      else 'auto_pass' end),
      jsonb_build_object('key','ico',   'label_key','app.cp.field.ico',   'value', nullif(array_to_string((select icos from id), ', '), '')),
      jsonb_build_object('key','dic',   'label_key','app.cp.field.vat_id','value',
        (select string_agg(distinct f->'counterparty_vat_id'->>'value', ', ') from fa)),
      jsonb_build_object('key','adresa','label_key','app.cp.field.address','value',
        (select f->'counterparty_address'->>'value' from fa
          where f->'counterparty_address'->>'value' is not null
          order by f->'issue_date'->>'value' desc nulls last limit 1)),
      -- období jako data (ISO, jazykově neutrální); slova nese label_key
      jsonb_build_object('key','odberatel','label_key','app.cp.field.as_customer','value',
        (select to_char(prvni, 'YYYY-MM-DD') || ' → ' || to_char(posledni, 'YYYY-MM-DD') from vz where vztah = 'customer')),
      jsonb_build_object('key','dodavatel','label_key','app.cp.field.as_supplier','value',
        (select to_char(prvni, 'YYYY-MM-DD') || ' → ' || to_char(posledni, 'YYYY-MM-DD') from vz where vztah = 'supplier')),
      -- stav úhrady je snímek zdroje; kde chybí, karta to PŘIZNÁ (dlaždice ukážou „—")
      jsonb_build_object('key','bez_stavu','label_key','app.cp.field.payment_unknown','value',
        (select bez_stavu || ' (' || to_char(bez_stavu_prvni, 'YYYY-MM-DD') || ' → ' || to_char(bez_stavu_posledni, 'YYYY-MM-DD') || ')'
           from vz where vztah = 'customer' and bez_stavu > 0)),
      jsonb_build_object('key','identita','label_key','app.cp.field.twins',
        'value', jsonb_array_length((select twins from id))::text,
        'state', case jsonb_array_length((select twins from id)) when 1 then 'auto_pass' else 'needs_review' end),
      jsonb_build_object('key','jmena','label_key','app.cp.field.names_in_time','value',
        (select string_agg(jmeno || ' (' || coalesce(left(od, 7), '?') || ' → ' || coalesce(left(do_, 7), '?') || ')', ' · ' order by od nulls last) from jm)),
      jsonb_build_object('key','firmy','label_key','app.cp.field.our_companies','value',
        (select string_agg(distinct f->'owner_company'->>'value', ' · ') from fa where f->'owner_company'->>'value' <> '')),
      jsonb_build_object('key','faktury','label_key','app.cp.field.invoices','value',
        (select count(*) filter (where f->'document_subtype'->>'value' = 'issued') || ' / ' ||
                count(*) filter (where f->'document_subtype'->>'value' = 'received') from fa)),
      -- smlouva jen NAVRŽENÁ k twinu = strana nepotvrzená → k potvrzení (sm_identifikace).
      -- Bez návrhu klíč `state` VYNECHAT, ne null: maska record_detail null nezná a zahodila
      -- by celou kartu („Zatím není co zobrazit") — chytil kontrakt bloků v CI kola 7.
      jsonb_build_object('key','smlouvy','label_key','app.cp.field.contracts','value', (select n::text from sm))
        || case when (select navrzeno from sm) > 0 then jsonb_build_object('state','needs_review') else '{}'::jsonb end
    ) as arr
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'record_id', coalesce((select icos[1] from id), (select label from id)),
      'badges', to_jsonb(array_remove(array[
         case when jsonb_array_length((select twins from id)) > 1 then 'app.cp.badge.identity_split' end,
         case when jsonb_array_length((select twins from id)) = 0 then 'app.cp.badge.no_twin' end], null)),
      -- JAZYK-03: prázdný údaj se nekreslí — pole bez hodnoty z pole vypadne
      'fields', coalesce((select jsonb_agg(x) from pole, jsonb_array_elements(pole.arr) x
                           where x->>'value' is not null and x->>'value' <> ''), '[]'::jsonb)),
    'provenance', jsonb_build_object(
      'source_slug', 'twin+doc-evidence',
      'trace_id', 'counterparty-card' || case when (select max(vznik) from fa) is null then ':no_data' else '' end,
      'freshness_at', to_char(coalesce((select max(vznik) from fa), now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
$$;

REVOKE ALL ON FUNCTION public.get_counterparty_card(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_counterparty_card(jsonb) TO authenticated, service_role;
