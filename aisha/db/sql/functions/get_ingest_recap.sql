-- Recap zpracování ingestu: JEDNO RPC, TŘI POHLEDY (p_params->>'view').
--
-- ⛔ PROČ VZNIKLO. Doklady, zjištění i běhy zdrojů v databázi UŽ JSOU — naměřeno
-- 2026-09-05 na produkci: 68 511 dokladů (67 616 AUTO_PASS / 895 REVIEW),
-- 350 zjištění (35 high), 348 závazků, `local-ingest` 2 227 synců. Chybělo jim
-- jediné: okno. Bez něj se člověk o stavu zpracování dozví až tím, že něco
-- nesedí — a `money` má NULA synců od registrace, což tenhle blok ukáže
-- první den.
--
-- Pohledy (source_params.view v bloku):
--   'stav'    — kpi_tile: jedna hlavička podle `metric`
--   'sync'    — table:    per zdroj běží / chybuje / nikdy, poslední úspěch, selhání
--   'by_type' — chart(bar): doklady podle typu; `note` nese počet k revizi
-- Zjištění tu ZÁMĚRNĚ nejsou: mají vlastní masku (`findings`) a RPC
-- `get_evidence_findings` — druhý zdroj téže pravdy by se dřív nebo později
-- rozešel s prvním. Blok `wb_findings` se do sekcí jen UMÍSTÍ.
-- Neznámý pohled → 'stav' (nejméně překvapivý, nic nezamlčí).
--
-- SECURITY INVOKER: o tom, co operátor uvidí, rozhoduje RLS nad li_* a
-- audience_broker_sync_state. Fail-closed na identitu tím platí bez extra kódu.
--
-- ⭐ OSA `owner_company` SE DEKLARUJE, ne mlčky ignoruje: doklady ji nesou
-- v hlavičce (`fields->>'owner_company'`), takže filtr TU dává smysl. Osa
-- areálu se sem VĚDOMĚ nedostala — ingest o areálech nic neví a nabízet
-- filtr, který nic nedělá, je horší než ho nenabídnout.
create or replace function public.get_ingest_recap(p_params jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cfg as (
    select
      coalesce(nullif(p_params->>'view', ''), 'stav')       as v,
      coalesce(nullif(p_params->>'metric', ''), 'doklady')  as metric,
      nullif(p_params->>'owner_company', '')                as firma
  ),
  -- Jeden filtrovaný pohled na registr, ať se podmínka firmy nepíše třikrát.
  reg as (
    select r.*
    from public.li_source_registry r, cfg
    where r.superseded_by is null
      -- ⛔ `fields->>'owner_company'` NENÍ skalár. Doklad nese u každého pole i to,
      -- JAK k hodnotě došel: {raw, value, status, confidence, source_span}. Bez
      -- `->'owner_company'->>'value'` se porovnává celý ten objekt s názvem firmy
      -- a filtr tiše vrací NULU — tedy přesně ta osa bez konzumenta, kvůli které
      -- tenhle blok vzniká. Naměřeno 2026-09-05 při ověřování proti produkci.
      and (cfg.firma is null or r.fields->'owner_company'->>'value' = cfg.firma)
  ),
  stav as (
    select case (select metric from cfg)
      when 'k_revizi'      then (select count(*) from reg where status = 'REVIEW')
      when 'chybi_povinne' then (select count(*) from reg where cardinality(missing_required) > 0)
      -- Zjištění patří firmě přes své doklady (`documents[].source_sha256`); bez
      -- toho by jediné číslo v řadě mluvilo o celém podniku pod zvolenou firmou.
      when 'zjisteni_high' then (select count(*) from public.li_findings f
                                  where f.severity = 'high'
                                    and ((select firma from cfg) is null
                                         or exists (select 1 from jsonb_array_elements(f.documents) d
                                                     join reg on reg.source_sha256 = d->>'source_sha256')))
      else                      (select count(*) from reg)
    end as value
  ),
  typy as (
    select coalesce(doc_type, '—')                    as doc_type,
           count(*)                                   as celkem,
           count(*) filter (where status = 'REVIEW')  as k_revizi
    from reg
    group by coalesce(doc_type, '—')
  )
  select case (select v from cfg)

    when 'sync' then jsonb_build_object(
      'data', jsonb_build_object(
        'columns', jsonb_build_array(
          jsonb_build_object('key','zdroj',   'label_key','app.ingest.col.zdroj',   'align','left'),
          jsonb_build_object('key','stav',    'label_key','app.ingest.col.stav',    'align','left'),
          jsonb_build_object('key','uspech',  'label_key','app.ingest.col.uspech',  'align','left'),
          jsonb_build_object('key','selhani', 'label_key','app.ingest.col.selhani', 'align','right'),
          jsonb_build_object('key','syncu',   'label_key','app.ingest.col.syncu',   'align','right'),
          jsonb_build_object('key','chyba',   'label_key','app.ingest.col.chyba',   'align','left')
        ),
        'row_kind', 'source',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id',      s.source_slug,
                   'label',   s.source_slug,
                   'zdroj',   s.source_slug,
                   -- ⛔ „Nikdy neběžel" NENÍ totéž co „běží a je v pořádku". Zdroj
                   -- s nulou synců je registrovaný a mrtvý; bez tohohle rozlišení
                   -- by splynul se zdravým.
                   'stav',    case
                                when coalesce(s.total_syncs, 0) = 0 then 'nikdy'
                                when coalesce(s.consecutive_failures, 0) > 0 then 'chybuje'
                                else 'běží'
                              end,
                   'uspech',  coalesce(to_char(s.last_success_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), '—'),
                   'selhani', coalesce(s.consecutive_failures, 0),
                   'syncu',   coalesce(s.total_syncs, 0),
                   'chyba',   left(coalesce(s.last_error_message, ''), 80)
                 ) order by coalesce(s.total_syncs, 0), s.source_slug)
          from public.audience_broker_sync_state s
        ), '[]'::jsonb)
      ),
      'provenance', jsonb_build_object(
        'source_slug',  'audience-broker',
        'freshness_at', to_char(coalesce((select max(updated_at) from public.audience_broker_sync_state), now())
                                at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'trace_id',     'ingest-recap:sync'
      )
    )

    when 'by_type' then jsonb_build_object(
      'data', jsonb_build_object(
        'kind', 'bar',
        -- Kontrakt `chart`: uniformní `points` (label, value, pct 0–100, note, state).
        -- `pct` je podíl na celku, aby šířka pruhu odpovídala datům, ne renderu.
        'points', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'label', t.doc_type,
                   'value', t.celkem,
                   -- Podíl 91 smluv na 68 511 dokladech je 0,13 % → `round` dá 0 a pruh
                   -- zmizí, ač řádek existuje. Nenulová hodnota má vždy aspoň 1 %:
                   -- šířka pruhu nesmí tvrdit „nic", když číslo vedle říká 91.
                   'pct',   greatest(1, round(100.0 * t.celkem / nullif((select sum(celkem) from typy), 0))),
                   'note',  case when t.k_revizi > 0 then t.k_revizi || ' k revizi' else null end,
                   'state', case when t.k_revizi > 0 then 'warning' else 'ok' end
                 ) order by t.celkem desc)
          from typy t
        ), '[]'::jsonb)
      ),
      'provenance', jsonb_build_object(
        'source_slug',  'li-evidence-registry',
        'freshness_at', to_char(coalesce((select max(ingested_at) from reg), now())
                                at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'trace_id',     'ingest-recap:by_type'
      ) || public.scope_applied(p_params, 'owner_company')
    )

    else jsonb_build_object(
      'data', jsonb_build_object(
        'value', (select value from stav),
        -- Tint jen tam, kde má člověk co dělat; počet dokladů sám o sobě není poplach.
        'state', case
                   when (select metric from cfg) in ('k_revizi','chybi_povinne','zjisteni_high')
                        and (select value from stav) > 0 then 'warning'
                   else 'ok'
                 end
      ),
      'provenance', jsonb_build_object(
        'source_slug',  'li-evidence-registry',
        'freshness_at', to_char(coalesce((select max(ingested_at) from reg), now())
                                at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'trace_id',     'ingest-recap:' || (select metric from cfg)
      ) || public.scope_applied(p_params, 'owner_company')
    )
  end;
$$;

revoke all on function public.get_ingest_recap(jsonb) from public, anon;
grant execute on function public.get_ingest_recap(jsonb) to authenticated, service_role;
