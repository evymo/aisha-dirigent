-- ============================================================================
-- Source of Truth: get_document_lines
-- Popis: Řádkové POLOŽKY jednoho dokladu jako tabulka — odpověď na „ZA CO".
--
-- ⭐ PROČ (majitel 2026-09-29, náčrtek „Smlouvy a nájmy"): u faktury chce po
-- prokliku vidět „detail POLOŽEK, ne co je ke schválení". Detail dokladu
-- (get_document_detail) je revizní — pole se stavy a jistotou nahoře, položky
-- surově pod nimi, čísla jako text, bez třídy. Tahle čtečka vydá TYTÉŽ položky
-- (li_source_registry.line_items, žádná kopie) jako tabulku: text, množství,
-- jednotka, jednotková cena, celkem a TŘÍDA (nájem / energie / služby …).
--
-- Třídy se NEKOPÍRUJÍ: `tridy_z_bloku` jmenuje blok, jehož `source_params.classes`
-- je katalog (kniha faktur `sm_breakdown`) — jeden katalog pro knihu i detail,
-- aby položka nebyla v knize „energie" a v detailu „nájem". Lze poslat i přímo
-- `classes` (přednost). Bez katalogu se třída neukáže vůbec (ne „neurčeno").
--
-- Pravdivost: položky dodává zdroj; starší exporty Money je nemají (naměřeno
-- riq 2026-09-29: 6 538 z 25 317 faktur). Prázdná tabulka proto nese v provenienci
-- DŮVOD (coverage label), ne ticho. U faktury s položkami provenience porovná
-- součet položek se základem bez DPH z hlavičky: přesně / do 1 Kč (zaokrouhlení) /
-- = celkem s DPH (položky jsou hrubé) / nesedí. DPH po položkách zdroj nedodává.
--
-- SECURITY INVOKER: viditelnost dokladu rozhoduje RLS li_source_registry (jako
-- get_document_detail). Scope: p_params->>'doc_slug' (alias 'document_id').
-- Contract: (jsonb) -> jsonb {data:{columns,rows}, provenance}.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_document_lines(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  with doc as (
    select r.doc_slug, r.doc_type, r.line_items, r.fields, r.created_at, r.ingest_source_slug
      from public.li_source_registry r
     where r.doc_slug = coalesce(p_params->>'doc_slug', p_params->>'document_id')
     limit 1
  ),
  katalog as (
    select coalesce(
             case when jsonb_typeof(p_params->'classes') = 'array' then p_params->'classes' end,
             (select b.source_params->'classes'
                from public.surface_blocks b
               where b.block_slug = p_params->>'tridy_z_bloku' and b.is_active
                 and jsonb_typeof(b.source_params->'classes') = 'array'
               limit 1)) as classes
  ),
  num as (
    -- pole položky je objekt s provenancí ({value, raw, …}); číslo jen když je číslo
    select li.ord,
           li.item->'fields'->'item_name'->>'value' as nazev,
           case when (li.item->'fields'->'quantity'->>'value')   ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (li.item->'fields'->'quantity'->>'value')::numeric end   as mnozstvi,
           nullif(li.item->'fields'->'unit'->>'value', '')                     as jednotka,
           case when (li.item->'fields'->'unit_price'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (li.item->'fields'->'unit_price'->>'value')::numeric end as cena,
           case when (li.item->'fields'->'line_total'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (li.item->'fields'->'line_total'->>'value')::numeric end as celkem
      from doc
      cross join lateral jsonb_array_elements(coalesce(doc.line_items, '[]'::jsonb))
           with ordinality as li(item, ord)
  ),
  zatridene as (
    select n.*,
           case when (select classes from katalog) is null then null
                else coalesce((
                  select c->>'key'
                    from katalog, jsonb_array_elements(katalog.classes) with ordinality t(c, o)
                   where n.nazev ~* (c->>'pattern')
                   order by t.o
                   limit 1), '?') end as trida
      from num n
  ),
  hlava as (
    select case when (doc.fields->'amount_without_vat'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (doc.fields->'amount_without_vat'->>'value')::numeric end as zaklad,
           case when (doc.fields->'total_amount'->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (doc.fields->'total_amount'->>'value')::numeric end as celkem
      from doc
  ),
  soucet as (
    select sum(celkem) as s from num
  )
  select coalesce(
    (select jsonb_build_object(
      'data', jsonb_build_object(
        'columns', (
          select jsonb_agg(c order by o)
            from (values
              (1, jsonb_build_object('key','poradi',   'label_key','app.cols.line_no',    'align','right')),
              (2, jsonb_build_object('key','polozka',  'label_key','app.cols.item_name')),
              (3, jsonb_build_object('key','mnozstvi', 'label_key','app.cols.quantity',   'align','right')),
              (4, jsonb_build_object('key','jednotka', 'label_key','app.cols.unit')),
              (5, jsonb_build_object('key','cena',     'label_key','app.cols.unit_price', 'align','right')),
              (6, jsonb_build_object('key','celkem',   'label_key','app.cols.line_total', 'align','right')),
              -- třída jako ŠTÍTEK (i18n klíč) — jen když je katalog
              (7, case when (select classes from katalog) is not null
                       then jsonb_build_object('key','trida','label_key','app.cols.class','value_keys',true) end)
            ) v(o, c)
           where c is not null),
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'poradi',   z.ord::text,
                   'polozka',  coalesce(z.nazev, '—'),
                   'mnozstvi', case when z.mnozstvi is null then '—'
                                    when z.mnozstvi = round(z.mnozstvi) then public.fmt_num_cs(z.mnozstvi, 0)
                                    -- desetinné množství bez koncových nul (2,5 ne 2,500)
                                    else regexp_replace(public.fmt_num_cs(z.mnozstvi, 3), ',?0+$', '') end,
                   'jednotka', coalesce(z.jednotka, ''),
                   'cena',     public.fmt_num_cs(z.cena, 2),
                   'celkem',   public.fmt_num_cs(z.celkem, 2),
                   'trida',    case when z.trida is null then null
                                    when z.trida = '?' then 'app.cols.class.none'
                                    else 'app.cols.class.' || z.trida end)
                 order by z.ord)
            from zatridene z), '[]'::jsonb)
      ),
      'provenance', jsonb_build_object(
        'source_slug',  coalesce(doc.ingest_source_slug, 'li-source-registry'),
        'freshness_at', to_char(doc.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'trace_id',     'doc-lines:' || doc.doc_slug,
        -- Pokrytí: n = položek, m = položek s částkou; label říká, co to znamená.
        'coverage', jsonb_build_object(
          'n', (select count(*) from num),
          'm', (select count(*) from num where celkem is not null),
          -- ⛔ Naměřeno na riq 2026-09-29 (6 538 faktur s položkami): 3 063 přesně,
          -- 2 375 do 1 Kč (haléřové zaokrouhlení, průměr 0,44 Kč), 190 položky VČETNĚ
          -- DPH (součet = celkem), 862 skutečně jinak. „Nesedí" jen pro ten poslední
          -- případ — zaokrouhlení ani hrubé položky nejsou chyba dokladu.
          'label_key', case
            when (select count(*) from num) = 0 then 'app.prov.coverage.lines_missing'
            when (select zaklad from hlava) is null
              or (select count(*) from num where celkem is null) > 0 then 'app.prov.coverage.lines_unchecked'
            when abs((select s from soucet) - (select zaklad from hlava)) <= 0.01 then 'app.prov.coverage.lines_sum_ok'
            when abs((select s from soucet) - (select zaklad from hlava)) <= 1.00 then 'app.prov.coverage.lines_sum_rounding'
            when (select celkem from hlava) is not null
             and abs((select s from soucet) - (select celkem from hlava)) <= 1.00 then 'app.prov.coverage.lines_sum_gross'
            else 'app.prov.coverage.lines_sum_mismatch' end)
      )
    )
    from doc),
    jsonb_build_object(
      'data', jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb),
      'provenance', jsonb_build_object(
        'source_slug',  'li-source-registry',
        'trace_id',     'doc-lines:not_found',
        'freshness_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
$$;

REVOKE ALL ON FUNCTION public.get_document_lines(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_document_lines(jsonb) TO authenticated, service_role;
