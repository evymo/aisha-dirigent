-- ROZPOR JE OTÁZKA — starší tvrzení × derivace z dokladů.
--
-- ⭐ PROČ TAHLE FUNKCE EXISTUJE
-- Když se nájem přestal číst ze seedu a začal se derivovat z fakturovaných
-- položek, nabízelo se starý snímek smazat. Majitel rozhodl jinak a je to
-- lepší: starší tvrzení má cenu právě jako KONTROLA. Naměřeno 2026-08-04
-- (33 seedových nájmů × derivace ze 116 plátců):
--   ·  3 SEDÍ         → kotva: měřidlo měří správně
--   · 26 se LIŠÍ      → hodnota zestárla (valorizace) — tvrzení platilo, dnes ne
--   ·  4 BEZ PROTĚJŠKU→ jiná otázka: konec nájmu? nefakturuje se? jiné jméno?
-- Ta TROJICE je to podstatné: bez shodujících se případů by „26 se liší" byl
-- podezřelý na vadu derivace, ne na stárnutí dat. Rozpor sám neříká, kdo se
-- mýlí — teprve kotva z něj dělá nález.
--
-- ⛔ NIC SE NEPŘEPISUJE. Výstupem je NÁVRH v advisory kanálu
-- (`li_entity_suggestions`, `advisory = true`, doktrína „nikdy automatická
-- vazba"). Člověk rozhoduje; funkce jen ukazuje obě strany a DŮVOD.
--
-- ⭐ KAŽDÝ ZÁZNAM VYSVĚTLUJE CO, JAK A PROČ
-- Vzorek bez důvodu nikoho nic nenaučí a nedá se podle něj rozhodnout
-- (zákon „ukázat vstup měřidla před nálezem" platí i pro návrhy). Proto
-- `raw_data` nese: obě hodnoty, období derivace, zdroj tvrzení, druh rozporu
-- a větu, která ho vysvětluje česky.
--
-- Konfigurace (p_params):
--   rent  : jsonb pro get_rent_current (rent_patterns, exclude_owner, …)
--   claim_source : text — zdroj tvrzení v twin_events; POVINNÝ, bez defaultu
--                  (jméno zdroje je instanční údaj — viz deklarace v_src níže)
--   claim_attr   : text — atribut s částkou; POVINNÝ, bez defaultu (jméno
--                  atributu nese měnu instance, platforma žádnou nepředjímá)
--
-- SECURITY INVOKER: kdo nemá nárok na doklady, nevyrobí ani návrhy.
-- Kontrakt: (jsonb) -> jsonb {emitted, anchors, stale, orphans, period}.

create or replace function public.emit_rent_claim_contradictions(
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_rent    jsonb := public.get_rent_current(coalesce(p_params->'rent','{}'::jsonb));
  v_period  text  := v_rent->'data'->'summary'->>'period';
  -- ⛔ ŽÁDNÁ VÝCHOZÍ HODNOTA ZDROJE. Jméno zdroje tvrzení je instanční údaj
  -- (každá instance vlastní, platforma žádný nepředjímá) a v generickém kanálu nemá co dělat —
  -- brána `instance-nazvy-nepatri-do-stack-kodu` to chytla správně. Bez
  -- `claim_source` se tedy neporovnává nic a řekne se to: mlčení by vypadalo
  -- jako „žádné rozpory", což je jiné tvrzení než „nebylo co porovnat".
  v_src     text  := nullif(p_params->>'claim_source','');
  -- ⛔ ŽÁDNÁ VÝCHOZÍ HODNOTA ATRIBUTU. Jméno atributu s částkou nese měnu
  -- instance (`…_czk`, `…_eur`, …) a platforma žádnou měnu nepředjímá —
  -- stejné pravidlo jako u claim_source o pár řádků výš.
  v_attr    text  := nullif(p_params->>'claim_attr','');
  v_rows    jsonb := '[]'::jsonb;
  v_anchor  int := 0; v_stale int := 0; v_orphan int := 0;
begin
  -- Bez vzorů se nederivuje nic a rozpor by byl domyšlený, ne naměřený.
  if not coalesce((v_rent->'data'->'summary'->>'configured')::boolean,false) then
    return jsonb_build_object('emitted',0,'reason','bez vzorů nájmu se nederivuje — rozpor nelze měřit');
  end if;
  -- Bez zdroje tvrzení není co porovnávat. Vrací se DŮVOD, ne nula: „0 rozporů"
  -- a „nebylo co porovnat" jsou různá tvrzení a spletly by se.
  if v_src is null then
    return jsonb_build_object('emitted',0,'reason',
      'claim_source neuveden — instance musí říct, který zdroj tvrzení porovnávat');
  end if;
  -- Stejná logika pro atribut částky: bez něj se neporovnává a řekne se to.
  if v_attr is null then
    return jsonb_build_object('emitted',0,'reason',
      'claim_attr neuveden — instance musí říct, který atribut nese částku (jméno nese i měnu)');
  end if;

  with derivace as (
    select t->>'tenant' as najemce, (t->>'monthly_amount')::numeric as ded, t->>'period' as obd
    from jsonb_array_elements(v_rent->'data'->'tenants') t
  ),
  tvrzeni as (
    select e.label as najemce, (ev.attrs->>v_attr)::numeric as castka,
           to_char(ev.occurred_at,'YYYY-MM-DD') as kdy
    from twin_events ev join twin_entities e on e.id = ev.twin_id
    where ev.event_type='lease' and ev.source = v_src
      and (ev.attrs->>v_attr) ~ '^-?[0-9]+(\.[0-9]+)?$'
  ),
  -- Spárování jménem: přesná shoda neexistuje (seed nese zkomoleniny), takže
  -- se páruje normalizovaným obsažením — a to, že je to SLABÉ spárování, je
  -- součástí nálezu: „bez protějšku" může znamenat i „jiné jméno téže osoby".
  parovani as (
    select t.najemce as tvrdi_kdo, t.castka, t.kdy,
           d.najemce as derivace_kdo, d.ded, d.obd
    from tvrzeni t
    left join lateral (
      select * from derivace d
       where public.norm_text(d.najemce) like '%'||public.norm_text(t.najemce)||'%'
       order by abs(d.ded - t.castka) limit 1) d on true
  )
  select jsonb_agg(jsonb_build_object(
           'tvrdi_kdo', tvrdi_kdo, 'castka', castka, 'kdy', kdy,
           'derivace_kdo', derivace_kdo, 'ded', ded, 'obd', obd,
           'druh', case
             when derivace_kdo is null then 'bez_protejsku'
             when ded = castka        then 'kotva'
             else 'zestarlo' end))
    into v_rows from parovani;

  -- Zápis návrhů. `same_*` druhy tenhle kanál už zná; tenhle je nový a projde,
  -- protože kontrakt druhu je od 2026-08-04 TVAR (slug), ne uzavřený výčet —
  -- přesně proto, aby slovník nálezů směl růst bez migrace.
  insert into public.li_entity_suggestions
    (suggestion_key, suggestion, name_field, name_normalized, names, advisory,
     ingest_source_slug, raw_data)
  select
    md5('rent_claim_vs_derivation|'||(r->>'tvrdi_kdo')||'|'||coalesce(v_period,'')),
    'rent_claim_contradicts_derivation',
    'counterparty',
    public.norm_text(r->>'tvrdi_kdo'),
    array_remove(array[r->>'tvrdi_kdo', r->>'derivace_kdo'], null),
    true,
    'derived:rent-current',
    jsonb_build_object(
      'druh',            r->>'druh',
      'tvrzeni_kdo',     r->>'tvrdi_kdo',
      'tvrzeni_castka',  (r->>'castka')::numeric,
      'tvrzeni_zdroj',   v_src,
      'tvrzeni_kdy',     r->>'kdy',
      'derivace_kdo',    r->>'derivace_kdo',
      'derivace_castka', (r->>'ded')::numeric,
      'derivace_obdobi', r->>'obd',
      'rozdil',          case when r->>'ded' is null then null
                              else round((r->>'ded')::numeric - (r->>'castka')::numeric, 2) end,
      -- CO, JAK a PROČ jednou větou — bez důvodu se nedá rozhodnout.
      'vysvetleni', case r->>'druh'
        when 'kotva' then
          'CO: starší tvrzení ('||(r->>'castka')||') SEDÍ na derivaci z faktur. '
          ||'JAK: spárováno jménem, částka shodná. '
          ||'PROČ ukazujeme: shodující se případy jsou kotva měřidla — dokládají, '
          ||'že rozdíly u ostatních jsou stárnutí dat, ne vada derivace.'
        when 'zestarlo' then
          'CO: tvrzení '||(r->>'castka')||' z '||coalesce(r->>'kdy','?')
          ||', ale faktury za '||coalesce(r->>'obd','?')||' říkají '||(r->>'ded')||'. '
          ||'JAK: součet fakturovaných položek nájmu v posledním období nájemce. '
          ||'PROČ: hodnota nemá interval platnosti, takže zestárla TIŠE — '
          ||'nejspíš valorizace. Rozhodnutí: přijmout derivaci jako aktuální, '
          ||'nebo doložit, proč platí starší číslo.'
        else
          'CO: tvrzení '||(r->>'castka')||', ale v derivaci nemá protějšek. '
          ||'JAK: hledáno normalizovaným jménem v plátcích nájmu za poslední období. '
          ||'PROČ: tři možnosti a NELZE je rozlišit bez člověka — nájem skončil, '
          ||'nefakturuje se, nebo je táž osoba vedená pod jiným jménem '
          ||'(u seedu doloženo: zkomolená jména jako Clevištan × Chlevišťan).'
        end)
  from jsonb_array_elements(coalesce(v_rows,'[]'::jsonb)) r
  on conflict (suggestion_key) do update
     set raw_data = excluded.raw_data, ingested_at = now();

  select count(*) filter (where r->>'druh'='kotva'),
         count(*) filter (where r->>'druh'='zestarlo'),
         count(*) filter (where r->>'druh'='bez_protejsku')
    into v_anchor, v_stale, v_orphan
  from jsonb_array_elements(coalesce(v_rows,'[]'::jsonb)) r;

  return jsonb_build_object(
    'emitted', jsonb_array_length(coalesce(v_rows,'[]'::jsonb)),
    'anchors', v_anchor, 'stale', v_stale, 'orphans', v_orphan,
    'period', v_period,
    -- Kotva je podmínka důvěryhodnosti celku, ne detail: bez ní se nedá říct,
    -- jestli rozdíly ukazují stárnutí dat, nebo vadu měřidla.
    'trustworthy', v_anchor > 0);
end
$fn$;

comment on function public.emit_rent_claim_contradictions(jsonb) is
  'Porovná starší tvrzení o nájmu (twin_events lease) s derivací z faktur a vydá ROZPORY jako advisory otázky do li_entity_suggestions — každou s oběma stranami a vysvětlením co/jak/proč. Nic nepřepisuje; kotva (shodující se případy) je podmínka důvěryhodnosti nálezu.';

revoke all on function public.emit_rent_claim_contradictions(jsonb) from public, anon;
grant execute on function public.emit_rent_claim_contradictions(jsonb) to authenticated, service_role;
