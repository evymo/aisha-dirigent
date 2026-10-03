-- ============================================================================
-- answer_verified_facts — deterministický odpovídač nad OVĚŘENÝMI fakty.
--
-- SoT ZACHRÁNĚN 2026-07-29: funkce žila jen v generované baseline a v živé DB
-- (nikdy neměla zdrojový soubor), takže ji nešlo opravit pipeline cestou a
-- žádný test na ni nemířil. Odteď je zdrojem TENHLE soubor; baseline ji dostává
-- výhradně regenem, běžící instance přes heals.
--
-- Tři osy kognitivního testu (VĚDĚT, ne odhadnout): věcnost · doložený zdroj ·
-- ZDRŽENLIVOST. Mezera je správná odpověď; sebevědomé číslo na nesouvisející
-- otázku je propadák. Naměřeno 2026-07-29 na produkci:
--   „kolik je hodin?"      → přehled nájemců, coverage FULL   (catch-all ‚kolik')
--   „kdo platí nejmíň?"    → vrátil NEJVYŠŠÍ nájem            (šablona ignoruje otázku)
--   „jakou má BRIMS plochu?"→ unknown                          (regex ‚plocha' nechytí ‚plochu')
-- Proto: žádný holý catch-all, superlativ se čte z otázky, kmeny místo tvarů.
--
-- Jazyková vrstva je záměrně primitivní (regex) — je to deterministický
-- FALLBACK. Plnohodnotný intent+formulace patří lokálnímu modelu přes answer
-- chain (fakta VŽDY jen z RPC pod scopem, model jazyk — nikdy čísla z vah).
-- ============================================================================

-- ── 2026-07-30: SCOPE JE AUTORITATIVNÍ VSTUP, text otázky už jen doplňuje ────
-- Do 07-30 si tahle funkce scope HÁDALA z textu otázky (token labelu proti 1 194
-- firemním twinům) a jiný zdroj pravdy neměla. Když nad tím vznikl přepínač
-- pohledu, byly zdroje dva — a ten nezamýšlený (slova v otázce) přebíjel ten
-- zamýšlený (volba uživatele). To je šum z definice, ne vada formulace.
-- Odteď: `p_scope` (vektor souřadnic, ověřený jediným vlastníkem pravidla
-- `scope_effective`) rozhoduje. Dohad z textu smí VYPLNIT chybějící dimenzi, a to
-- výhradně označený jako `guessed_from_text` s jistotou < 1 — nikdy volbu přebít.
-- Vrácená obálka nese `scope`: vektor, pod kterým odpověď VZNIKLA, aby se dala
-- po měsíci přečíst a přiřadit odpovědnost (zapisuje ho get_answer_block do ai_runs).
-- ── 2026-08-04: NÁJEM SE DERIVUJE Z DOKLADŮ, NEČTE SE ZE SEEDU ──────────────
-- Do 08-04 četly obě nájemní větve 33 `lease` událostí nasypaných seedem
-- z jednorázového exportu. Naměřeno proti fakturám v korpusu: pole se jmenovalo
-- `annual_rent_czk`, ale hodnota byla MĚSÍČNÍ (25/33 sedělo 1:1 na jednu měsíční
-- fakturu), 21 z nich už neplatilo po valorizaci, a faktury znaly 101 plátců
-- místo 33. Odpovídač tedy hlásil „roční nájem 851 408 Kč" tam, kde je pravda
-- ~40,5 M ročně — a k tomu `coverage: full`, tedy plnou jistotu nad snímkem.
--
-- Nově obě větve čtou `get_rent_current` (derivace z fakturovaných položek).
-- Vzory nájmu jsou DATA a přicházejí v `p_config` z instančního bloku — platforma
-- české texty faktur znát nesmí. Bez konfigurace se NIC nederivuje a odpověď to
-- PŘIZNÁ (coverage none), místo aby mlčela nebo si domyslela.
-- ⛔ STARÉ PŘETÍŽENÍ SE MUSÍ ZAHODIT VÝSLOVNĚ.
-- `create or replace` mění funkci TÉŽE signatury; přidáním čtvrtého parametru
-- vznikla NOVÁ funkce a tříparametrová verze zůstala žít vedle ní. Naměřeno na
-- produkci 2026-08-04: `pg_proc` vracel answer_verified_facts dvakrát (3 a 4
-- argumenty). Volající s třemi argumenty by tiše dostal STAROU logiku, tedy
-- nájem ze seedu — přesně tu vadu, kterou tahle změna odstraňuje. Dvě pravdy
-- pod jedním jménem jsou horší než jedna špatná: nepozná se, která odpověděla.
drop function if exists public.answer_verified_facts(text, text, jsonb);

create or replace function public.answer_verified_facts(
  p_question text,
  p_style    text default 'strucny',
  p_scope    jsonb default '[]'::jsonb,
  p_config   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $fn$
declare
  q text := norm_text(p_question);
  v_intent text; v_coverage text; v_source text;
  v_firm record; v_target_firm uuid; v_firm_label text;
  v_obj record; v_target_object uuid; v_obj_label text;
  v_data jsonb := '{}'::jsonb; v_rows jsonb := '[]'::jsonb; v_answer text;
  v_rent jsonb;
  -- záměr `debt`: parametry čteček karty protistrany (twin + receivable_from z instance)
  v_cp jsonb;
  v_style text := coalesce(p_style,'strucny');
  -- Ověřený vektor (jen souřadnice, za které se substrát zaručil) + vektor,
  -- pod kterým odpověď skutečně vznikla (ověřené + doplněné dohady).
  v_scope      jsonb := public.scope_effective(p_scope);
  v_scope_used jsonb := coalesce(v_scope->'effective', '[]'::jsonb);
  -- Superlativ Z OTÁZKY: „nejmíň" musí dostat nejnižší konec řady, ne šablonu
  -- s natvrdo nejvyšším. NULL = bez superlativu (souhrn).
  v_super text := case
    when q ~ '(nejmen|nejmin|nejniz)' then 'min'
    when q ~ '(nejvic|nejvys|nejvet)' then 'max'
    else null end;
begin
  -- ── FIRMA: nejdřív VOLBA (ověřená souřadnice), teprve pak dohad z textu ────
  select (c->>'value')::uuid into v_target_firm
  from jsonb_array_elements(v_scope_used) c
  where c->>'dim' = 'company' and c->>'resolver' = 'twin'
  limit 1;
  if v_target_firm is not null then
    -- Label bere z twinu, ne z otázky: jméno v odpovědi musí patřit uzlu, na
    -- kterém čtenář stojí, i když v otázce padlo jméno jiné firmy.
    select e.label into v_firm_label from twin_entities e where e.id = v_target_firm;
  else
    -- Dohad: firma, jejíž CELÝ název otázka nese (po slovech), jinak ta, které
    -- v otázce chybí nejméně význačných slov názvu; teprve potom nejdelší shodné
    -- slovo a delší název.
    --
    -- ⛔ NAMĚŘENO 2026-09-28: „Co víme o firmě SFR Motor s.r.o.?" vybralo „SFR Motor
    -- SERVIS s.r.o." (jiná firma, IČO 08263370, jen přijaté faktury) místo „SFR Motor
    -- s.r.o." (IČO 08263523, 60 vydaných faktur). Obě sdílí nejdelší shodné slovo
    -- „motor" a při shodě vyhrával DELŠÍ název — i když jeho slovo „servis" v otázce
    -- vůbec není. Odpověď pak tvrdila „vydané faktury nemáme".
    select e.id, e.label into v_firm
    from twin_entities e
    cross join lateral (
      select count(*) filter (where q like '%'||t.tok||'%')      as shodnych,
             count(*) filter (where q not like '%'||t.tok||'%')  as chybejicich,
             max(length(t.tok)) filter (where q like '%'||t.tok||'%') as nejdelsi
        from (select regexp_replace(norm_text(w),'[^a-z0-9]','','g') tok
                from regexp_split_to_table(e.label,'\s+') w) t
       where length(t.tok)>=4
         and t.tok not in ('spol','group')
    ) s
    where e.entity_type='company'
      and s.shodnych > 0
    order by (' '||regexp_replace(q,'[^a-z0-9]+',' ','g')||' ')
               like ('% '||btrim(regexp_replace(norm_text(e.label),'[^a-z0-9]+',' ','g'))||' %') desc,
             s.chybejicich asc,
             s.nejdelsi desc,
             char_length(e.label) desc
    limit 1;
    v_target_firm := v_firm.id; v_firm_label := v_firm.label;
    if v_target_firm is not null then
      -- Doplněná dimenze se do vektoru zapisuje PŘIZNANĚ: origin guessed_from_text
      -- a jistota < 1. Bez toho by se za měsíc nedalo poznat, že souřadnici
      -- nevybral člověk, ale regex nad formulací dotazu.
      v_scope_used := v_scope_used || jsonb_build_array(jsonb_build_object(
        'dim','company','value',v_target_firm::text,'origin','guessed_from_text',
        'confidence',0.5,'detail','label token found in question text','resolver','twin'));
    end if;
  end if;

  -- Jméno firmy v odpovědi = AKTUÁLNÍ jméno z dokladů (counterparty_resolve, táž
  -- pravda jako karta protistrany), ne název dvojčete: ten bývá adresa nebo IČO
  -- (naměřeno 2026-09-28: 53 firem s IČO pojmenovaných adresou, 28 samotným IČO).
  -- Uzel se nemění — jméno patří téže firmě (tomuž IČO), jen jeho aktuální podobě.
  if v_target_firm is not null then
    select coalesce(nullif(id.label, ''), v_firm_label) into v_firm_label
      from public.counterparty_resolve(jsonb_build_object('twin_id', v_target_firm::text)) id;
  end if;

  -- ── OBJEKT/areál: týž řád — volba, pak dohad ───────────────────────────────
  select (c->>'value')::uuid into v_target_object
  from jsonb_array_elements(v_scope_used) c
  where c->>'dim' = 'object' and c->>'resolver' = 'twin'
  limit 1;
  if v_target_object is not null then
    select o.label into v_obj_label from twin_entities o where o.id = v_target_object;
  else
    select o.id, o.label into v_obj
    from twin_entities o
    cross join lateral (select regexp_replace(norm_text(w),'[^a-z0-9]','','g') tok
                        from regexp_split_to_table(o.label,'\s+') w) t
    where o.entity_type='object' and length(t.tok)>=4 and q like '%'||t.tok||'%'
    order by length(t.tok) desc limit 1;
    v_target_object := v_obj.id; v_obj_label := v_obj.label;
    if v_target_object is not null then
      v_scope_used := v_scope_used || jsonb_build_array(jsonb_build_object(
        'dim','object','value',v_target_object::text,'origin','guessed_from_text',
        'confidence',0.5,'detail','label token found in question text','resolver','twin'));
    end if;
  end if;

  -- Klasifikace záměru. KMENY, ne tvary (ploch- chytí plochu/ploše/plochy).
  -- ŽÁDNÝ holý catch-all: otázka bez nájemního kontextu spadne do 'unknown'
  -- a dostane poctivé „nezařadil jsem" s coverage none — ne vymyšlený přehled.
  v_intent := case
    -- DLUH první: „Kolik dluží…" předvyplňuje sama karta protistrany
    -- (app.cp.ask.prefill) a do 2026-09-26 padala na `kolik` → tenant_rent, tedy
    -- na nájem bez DPH za nejnovější (i budoucí) období. Kmeny, ne tvary.
    when q ~ '(dluz|dluh|pohledav|splatnost|nedoplat|neuhraz|nezaplac)' then 'debt'
    -- VZTAH V ČASE (2026-09-28): „je náš zákazník?", „kdy naposledy?", „jaké
    -- faktury má?" — dřív padalo na `contract_terms` (kmen faktur) nebo na
    -- „nezařadil". Jen s firmou: bez ní by „dodavatel elektřiny" ukradl energii.
    when v_target_firm is not null
     and q ~ '(zakaznik|odberatel|klient|nas dodavatel|spoluprac|obchodujeme|obchodovali|naposledy|posledni (faktur|obchod|doklad)|(jake|ktere|kolik) faktur|obchodni vztah)'
      then 'relationship'
    when q ~ '(vypovedn|lhut|prava|povinnost|dodatek|dodatk|faktur|predavac|protokol)' then 'contract_terms'
    when q ~ '(sidlo|adresa|ico)' then 'tenant_seat'
    when q ~ '(ploch|vymer|metr|m2|rozloh)' then 'tenant_area'
    -- kniha jízd / telematika — KONTROLNÍ SKUPINA kognitivního testu (A blok)
    when q ~ '(najezdil|najezd|kilometr|kniha jizd|jizd|motohodin|odvezl|prevezl|tonaz|tun[ay ]|vytizen)' then 'machine_ops'
    when q ~ '(spotreb|energi|kwh|elektr|plyn|voda|mericu?|merak)' then
         case when q ~ '(3 mesic|mesicn|obdobi|kvartal|ctvrtlet)' then 'energy_timeseries'
              else 'energy_consumption' end
    when q ~ '(zaloh|zalohy|predpis)' then 'tenant_deposits'
    when v_target_object is not null and v_target_firm is null and q ~ '(prehled|areal|objekt|budov|najem|najemn|plati|najemc)' then 'object_summary'
    when q ~ '(prehled|seznam|kdo (vsechno )?plati|najemnic|najemc[iu]|kolik najemc)' and v_target_firm is null then 'tenant_overview'
    when v_target_firm is not null and q ~ '(najem|najemn|plati|kolik)' then 'tenant_rent'
    when q ~ '(najem|najemn)' then 'tenant_overview'
    when v_super is not null and q ~ 'plati' then 'tenant_overview'
    else 'unknown'
  end;

  if v_intent='tenant_overview' then
    v_rent   := public.get_rent_current(coalesce(p_config->'rent','{}'::jsonb));
    v_source := 'fakturované položky nájmu (odvozeno k období '
              || coalesce(v_rent->'data'->'summary'->>'period','?') || ')';
    if not coalesce((v_rent->'data'->'summary'->>'configured')::boolean, false) then
      -- Prázdno z prázdné konfigurace je nerozeznatelné od „podnik nemá nájemce".
      v_coverage := 'none';
      v_data := jsonb_build_object('poznamka',
        'instance nemá nastavené vzory nájemních položek — nájem se nederivuje');
    else
      v_data := v_rent->'data'->'summary';
      select jsonb_agg(t order by (t->>'monthly_amount')::numeric desc) into v_rows
      from jsonb_array_elements(v_rent->'data'->'tenants') t
      where (t->>'active')::boolean;
      -- `partial`, ne `full`: derivace vidí jen nájemce, kterým se FAKTURUJE.
      -- Kdo má smlouvu a nedostal fakturu, tu není — a tvrdit nad tím plné
      -- pokrytí je přesně ta lež, kvůli které tahle větev vznikla.
      v_coverage := case when (v_data->>'active_tenants')::int > 0 then 'partial' else 'none' end;
    end if;

  elsif v_intent='debt' then
    -- ⭐ TYTÉŽ RPC JAKO KARTA PROTISTRANY (jedna pravda): dluh, k úhradě,
    -- nejstarší dluh a předepsáno z get_counterparty_metric (stav dokladu
    -- z invoice_state), smlouvy z counterparty_contracts. Odpovídač nic
    -- nepočítá sám — kdyby počítal, karta a odpověď by se rozešly.
    -- ⭐ DLUH = FAKTURA PO SPLATNOSTI (majitel 2026-09-26). Vystavená faktura
    -- ve splatnosti je „k úhradě", ne dluh; vystavená dopředu „předepsáno".
    -- Údaje ze zdroje (Money) se nemění — změní-li je účetní ve zdroji, projeví
    -- se tu samy (storno, úhrada).
    -- `receivable_from` přichází v p_config->'receivables' z instančního bloku.
    v_source := 'vydané faktury a smlouvy protistrany (tytéž čtečky jako karta protistrany)';
    if v_target_firm is null then
      v_coverage := 'none';
      v_data := jsonb_build_object('poznamka','není zřejmé, o které firmě je řeč — vyberte ji v pohledu nebo ji jmenujte');
    else
      v_cp := coalesce(p_config->'receivables','{}'::jsonb) || jsonb_build_object('twin_id', v_target_firm::text);
      v_data := jsonb_build_object(
        'firma',         v_firm_label,
        'dluh',          public.get_counterparty_metric(v_cp || '{"metric":"receivable_overdue"}'::jsonb)->'data'->'value',
        'k_uhrade',      public.get_counterparty_metric(v_cp || '{"metric":"receivable_open"}'::jsonb)->'data'->'value',
        'nejstarsi_dni', public.get_counterparty_metric(v_cp || '{"metric":"oldest_overdue_days"}'::jsonb)->'data'->'value',
        'predepsano',    public.get_counterparty_metric(v_cp || '{"metric":"scheduled"}'::jsonb)->'data'->'value');
      select v_data || jsonb_build_object('smluv', count(*), 'smluv_navrzeno', count(*) filter (where c.certainty = 'proposed'),
                                          -- „na jakých smlouvách": prvních pár názvů dokumentů, ne jen počet
                                          'smlouvy', coalesce((array_agg(c.filename order by c.filename)
                                                               filter (where coalesce(c.filename, '') <> ''))[1:3], '{}'::text[]))
        into v_data
        from public.counterparty_resolve(v_cp) id, public.counterparty_contracts(id.icos, id.names, id.twins) c;
      -- ⭐ SOUČASNOST A NEZNÁMÉ (2026-09-28): z téže pravdy jako hlavička karty
      -- (counterparty_periods) — poslední vydaná faktura, kolik vydaných faktur
      -- stav úhrady ve zdroji NENESE a z kdy; vyfakturováno za 12 m z dlaždice.
      -- NEMĚŘENO (null) u dluhu teď znamená dvojí: žádná vydaná faktura, nebo
      -- faktury bez stavu úhrady — odpověď je musí rozlišit.
      select v_data || jsonb_build_object(
               'vydanych',           coalesce(p.dokladu, 0) + coalesce(p.predepsano, 0),
               'posledni_vydana',    to_char(p.posledni, 'YYYY-MM-DD'),
               'bez_stavu',          coalesce(p.bez_stavu, 0),
               'bez_stavu_prvni',    to_char(p.bez_stavu_prvni, 'YYYY-MM-DD'),
               'bez_stavu_posledni', to_char(p.bez_stavu_posledni, 'YYYY-MM-DD'),
               'vydano_12m',         public.get_counterparty_metric(v_cp || '{"metric":"invoiced_12m"}'::jsonb)->'data'->'value')
        into v_data
        from public.counterparty_resolve(v_cp) id
        left join lateral public.counterparty_periods(id.icos, id.names, public.storno_values_param(v_cp)) p
          on p.vztah = 'customer';
      -- „od kdy": den splatnosti nejstaršího dluhu (dnes − dní po splatnosti)
      if coalesce((v_data->>'nejstarsi_dni')::numeric, 0) > 0 then
        v_data := v_data || jsonb_build_object('dluh_od',
          to_char(current_date - (v_data->>'nejstarsi_dni')::int, 'FMDD. FMMM. YYYY'));
      end if;
      -- `partial`: evidence vidí jen doklady ze zdrojů, které do ní tečou (Money),
      -- a strany smluv jsou zatím jen navržené. NEMĚŘENO (null) = dluh neumím
      -- doložit (žádná vydaná faktura, nebo žádná se stavem úhrady).
      v_coverage := case when jsonb_typeof(v_data->'k_uhrade') = 'number' then 'partial' else 'none' end;
    end if;

  elsif v_intent='relationship' then
    -- ⭐ VZTAH V ČASE (majitel 2026-09-28): uživatel se ptá na AKTUÁLNÍ stav,
    -- historie doplňuje a nesmí převážit. Odpověď proto začíná SOUČASNOSTÍ
    -- (poslední doklad, vyfakturováno za 12 m) a teprve pak období rolí.
    -- Data z téže čtečky jako hlavička karty (counterparty_periods); práh
    -- „aktivní / spící" platforma nezná a nehádá — říká data, ne nálepku.
    -- Dodáky ani smlouvy role neurčují: dodáky ze živého zdroje zatím nenesou
    -- IČO (naměřeno 2026-09-28) a přiřadit je jménem by bylo hádání.
    v_source := 'vydané a přijaté faktury protistrany (tytéž čtečky jako karta protistrany)';
    v_cp := coalesce(p_config->'receivables','{}'::jsonb) || jsonb_build_object('twin_id', v_target_firm::text);
    select jsonb_build_object(
             'firma',        v_firm_label,
             'odberatel_od', to_char(max(p.prvni)    filter (where p.vztah = 'customer'), 'YYYY-MM-DD'),
             'odberatel_do', to_char(max(p.posledni) filter (where p.vztah = 'customer'), 'YYYY-MM-DD'),
             'vydanych',     coalesce(max(p.dokladu) filter (where p.vztah = 'customer'), 0),
             'predepsanych', coalesce(max(p.predepsano) filter (where p.vztah = 'customer'), 0),
             'dodavatel_od', to_char(max(p.prvni)    filter (where p.vztah = 'supplier'), 'YYYY-MM-DD'),
             'dodavatel_do', to_char(max(p.posledni) filter (where p.vztah = 'supplier'), 'YYYY-MM-DD'),
             'prijatych',    coalesce(max(p.dokladu) filter (where p.vztah = 'supplier'), 0),
             'posledni',     to_char(max(p.posledni), 'YYYY-MM-DD'))
      into v_data
      from public.counterparty_resolve(v_cp) id
      left join lateral public.counterparty_periods(id.icos, id.names, public.storno_values_param(v_cp)) p on true;
    select v_data || jsonb_build_object('smluv', count(*),
             'vydano_12m', public.get_counterparty_metric(v_cp || '{"metric":"invoiced_12m"}'::jsonb)->'data'->'value')
      into v_data
      from public.counterparty_resolve(v_cp) id, public.counterparty_contracts(id.icos, id.names, id.twins) c;
    v_coverage := case when (v_data->>'vydanych')::int + (v_data->>'prijatych')::int > 0 then 'partial' else 'none' end;

  elsif v_intent='tenant_rent' then
    v_rent   := public.get_rent_current(coalesce(p_config->'rent','{}'::jsonb));
    v_source := 'fakturované položky nájmu (odvozeno k období '
              || coalesce(v_rent->'data'->'summary'->>'period','?') || ')';
    if not coalesce((v_rent->'data'->'summary'->>'configured')::boolean, false) then
      -- Bez vzorů nájmu se nederivuje nic — „nenašel jsem" by bylo tvrzení o datech,
      -- která se vůbec nečetla. Stejně jako tenant_overview to odpověď PŘIZNÁ.
      v_coverage := 'none';
      v_data := jsonb_build_object('firma', v_firm_label, 'poznamka',
        'instance nemá nastavené vzory nájemních položek — nájem se nederivuje');
    else
      -- ⭐ Plátce nájmu se páruje JMÉNY FIRMY Z DOKLADŮ (jména v čase pro její IČO,
      -- counterparty_resolve — táž pravda jako karta a dluh), ne názvem dvojčete:
      -- ten bývá adresa nebo IČO, a pak se nájemce „nenašel" (naměřeno 2026-09-28).
      select t into v_data
        from jsonb_array_elements(v_rent->'data'->'tenants') t
       where public.norm_text(btrim(t->>'tenant')) in (
               select public.norm_text(btrim(n))
                 from public.counterparty_resolve(coalesce(p_config->'receivables','{}'::jsonb)
                                                  || jsonb_build_object('twin_id', v_target_firm::text)) id,
                      unnest(id.names || coalesce(v_firm_label, '')) n
                where btrim(n) <> '')
       order by (t->>'active')::boolean desc, t->>'period' desc
       limit 1;
      v_coverage := case when v_data is null then 'none' else 'partial' end;
      if v_data is null then
        v_data := jsonb_build_object('firma', v_firm_label,
                                     'obdobi', v_rent->'data'->'summary'->>'period');
      end if;
    end if;

  elsif v_intent='energy_consumption' then
    v_source := 'twin energy (sez-fakturace, elektřina)';
    if v_target_firm is not null then
      select jsonb_build_object('firma',v_firm_label,
        'spotreba_kwh', sum((ev.attrs->>'consumption_kwh')::numeric),
        'naklad_czk', sum((ev.attrs->>'cost_czk')::numeric),
        'udalosti', count(*))
      into v_data from twin_events ev where ev.event_type='energy' and ev.twin_id=v_target_firm;
      v_coverage := case when (v_data->>'udalosti')::int>0 then 'partial' else 'none' end;
    elsif v_target_object is not null then
      select jsonb_build_object('objekt',v_obj_label,
        'spotreba_kwh', coalesce(sum((ev.attrs->>'consumption_kwh')::numeric),0),
        'naklad_czk', coalesce(sum((ev.attrs->>'cost_czk')::numeric),0),
        'firem_s_energii', count(distinct ev.twin_id))
      into v_data from twin_events ev
      where ev.event_type='energy' and ev.twin_id in (
        select twin_id from twin_events where event_type='lease' and place_twin_id=v_target_object);
      v_data := jsonb_set(v_data,'{firma}', to_jsonb(v_obj_label));
      v_coverage := case when (v_data->>'firem_s_energii')::int>0 then 'partial' else 'none' end;
    else
      select jsonb_build_object('firem_s_energii', count(*),
        'spotreba_kwh_celkem', sum(s.kwh), 'naklad_czk_celkem', sum(s.czk)),
        jsonb_agg(jsonb_build_object('firma',s.firma,'kwh',s.kwh,'czk',s.czk) order by s.czk desc)
      into v_data, v_rows from (
          select e.label firma, sum((ev.attrs->>'consumption_kwh')::numeric) kwh,
                 sum((ev.attrs->>'cost_czk')::numeric) czk
          from twin_events ev join twin_entities e on e.id=ev.twin_id
          where ev.event_type='energy' group by e.label) s;
      v_coverage := 'partial';  -- jen elektřina; plyn/voda zatím ne
    end if;

  elsif v_intent='object_summary' then
    -- ⚠️ NÁJEM ZA OBJEKT SE DNES ODVODIT NEDÁ — a je poctivější to říct.
    -- Derivace z faktur zná NÁJEMCE a ČÁSTKU, ale ne OBJEKT: doklad nenese,
    -- které budovy se nájem týká. Ta vazba žila jen v seedu, který byl chybný
    -- (měsíční pod jménem `annual`, snímek 33 z 101). Dopočítat ji z místa
    -- doručení by bylo hádání vydávané za měření, takže se nájem za objekt
    -- NEUVÁDÍ; energie ano, ta k místu vázaná je.
    v_source := 'twin energy (elektřina); nájem per objekt zatím neodvoditelný';
    v_data := jsonb_build_object('objekt', v_obj_label);
    v_data := v_data || (
      select jsonb_build_object('energie_kwh',coalesce(sum((e.attrs->>'consumption_kwh')::numeric),0),
             'energie_czk',coalesce(sum((e.attrs->>'cost_czk')::numeric),0))
      from twin_events e where e.event_type='energy' and e.twin_id in (
        select twin_id from twin_events where event_type='lease' and place_twin_id=v_target_object));
    v_coverage := 'full';

  elsif v_intent='machine_ops' then
    -- Kniha jízd: lane EXISTUJE (telematika), ale živě zatím neteče — sekce
    -- Provozy je deklarovaná jako čekající. Poctivost > dojem: přiznat mezeru.
    -- A2 test na konfabulaci: goods_value je v Kč, TONÁŽ SE NEMĚŘÍ — kdo
    -- vyrobí tuny dopočtem, propadl. Odmítnutí je tu správná odpověď.
    v_source := 'kniha jízd (telematika — lane zatím nenapojena)';
    v_coverage := 'none';
    v_data := jsonb_build_object('poznamka', case
      when q ~ '(tonaz|tun[ay ])' then 'hodnota nákladu je v Kč; tonáž se neměří — dopočet odmítám'
      else 'kniha jízd zatím do stacku neteče; sekce Provozy čeká na napojení telematiky' end);

  elsif v_intent='contract_terms' then
    v_source := 'obsah smlouvy (zatím strojově nevytěžený)';
    v_coverage := 'none';
    v_data := jsonb_build_object('firma',v_firm_label,
      'poznamka','údaj je v OBSAHU smlouvy; dnes není tvrdě ověřený (chybí NLP extrakce). Dokument je dostupný k nahlédnutí oprávněnému.');

  elsif v_intent='tenant_seat' then
    -- IČO a adresa z HLAVIČKY KARTY protistrany (jedna pravda): IČO z vazeb
    -- twinu, adresa z POSLEDNÍHO dokladu — současnost, ne nejčastější hodnota.
    -- Dřív tu stálo „IČO zatím není v twinu" i u firmy, jejíž twin IČO nese.
    v_source := 'hlavička karty protistrany (IČO z vazeb twinu, adresa z posledního dokladu)';
    v_data := jsonb_build_object('firma', v_firm_label);
    if v_target_firm is not null then
      select v_data || coalesce(jsonb_object_agg(f->>'key', f->>'value'), '{}'::jsonb)
        into v_data
        from jsonb_array_elements(public.get_counterparty_card(
               jsonb_build_object('twin_id', v_target_firm::text))->'data'->'fields') f
       where f->>'key' in ('ico', 'dic', 'adresa');
    end if;
    v_coverage := case when v_data ? 'ico' or v_data ? 'adresa' then 'partial' else 'none' end;
    if v_coverage = 'none' then
      v_data := v_data || jsonb_build_object('poznamka','sídlo/IČO nenese twin ani doklad; navázat z ARES nebo obsahu smlouvy.');
    end if;

  elsif v_intent='tenant_area' then
    v_source := 'plocha z OCR smlouvy (nespolehlivá)';
    v_coverage := 'none';
    v_data := jsonb_build_object('firma',v_firm_label,'poznamka','OCR uvádí plochu celé budovy (5704 m² pro více firem) — netvrdím jako pravdu; potřebuje ověřenou extrakci.');

  elsif v_intent='energy_timeseries' then
    v_source := 'twin energy (jen souhrnné období)';
    v_coverage := 'none';
    v_data := jsonb_build_object('firma',v_firm_label,'poznamka','měsíční řada zatím není; máme souhrnnou fakturační periodu, ne 3měsíční rozpad.');

  elsif v_intent='tenant_deposits' then
    v_source := 'zálohy (zatím nevytěženo z faktur/předpisů)';
    v_coverage := 'none';
    v_data := jsonb_build_object('firma',v_firm_label,'poznamka','zálohy nejsou vytěžené z faktur/předpisů; potřebuje ingest.');

  else
    v_source := 'žádný'; v_coverage := 'none';
    v_data := jsonb_build_object('poznamka','dotaz jsem nezařadil k žádné ověřené oblasti.');
  end if;

  v_answer := case v_intent
    -- ⚠️ MĚSÍČNÍ a K OBDOBÍ. Roční se uvádí jako DOPOČET (×12) a je označené —
    -- dřív tu stálo „roční" nad měsíční hodnotou a lhalo to o řád.
    when 'tenant_overview' then
      case when v_coverage='none' then
        coalesce(v_data->>'poznamka','Nájem se nepodařilo odvodit.')
      else
        (v_data->>'active_tenants')||' aktivních nájemců, měsíčně celkem '||
        fmt_num_cs((v_data->>'monthly_amount')::numeric)||' Kč (období '||
        coalesce(v_data->>'period','?')||'; ročním tempem '||
        fmt_num_cs((v_data->>'monthly_amount')::numeric * 12)||' Kč). '||
        case when v_super='min' then
          'Nejnižší: '||(v_rows->-1->>'tenant')||' ('||fmt_num_cs((v_rows->-1->>'monthly_amount')::numeric)||' Kč/měs).'
        else
          'Nejvyšší: '||(v_rows->0->>'tenant')||' ('||fmt_num_cs((v_rows->0->>'monthly_amount')::numeric)||' Kč/měs).'
        end ||
        -- Rozdíl mezi „známe" a „aktivní" je odpověď, ne šum: říká, kolik
        -- nájemců v datech je, ale zrovna se jim nefakturuje.
        ' Historicky známe '||(v_data->>'known_tenants')||' plátců nájmu.'
      end
    when 'debt' then
      -- Dluh = po splatnosti (majitel 2026-09-26); k úhradě a předepsáno jsou
      -- jiná čísla a odpověď je tak i pojmenuje.
      case when v_target_firm is null then 'Nevím, o které firmě je řeč — vyberte ji v pohledu nebo ji jmenujte.'
      when coalesce((v_data->>'vydanych')::int, 0) = 0 then coalesce(v_firm_label,'Tahle firma')||': vydané faktury v evidenci nemáme, dluh tedy neumím doložit.'
      -- faktury JSOU, ale žádná nenese stav úhrady → neznámo, ne „0 Kč"
      when v_coverage='none' then v_firm_label||': stav úhrady neznáme — '||
           (v_data->>'bez_stavu')||' vydaných faktur ('||coalesce(to_char((v_data->>'bez_stavu_prvni')::date, 'FMDD. FMMM. YYYY'), '?')||' → '||
           coalesce(to_char((v_data->>'bez_stavu_posledni')::date, 'FMDD. FMMM. YYYY'), '?')||') nenese ve zdroji zůstatek, dluh tedy neumím doložit. '||
           'Poslední vydaná faktura '||coalesce(to_char((v_data->>'posledni_vydana')::date, 'FMDD. FMMM. YYYY'), '—')||
           '; za posledních 12 měsíců vyfakturováno '||fmt_num_cs(coalesce((v_data->>'vydano_12m')::numeric, 0))||' Kč. '||
           'Smlouvy: '||(v_data->>'smluv')||'.'
      else v_firm_label||': dluh po splatnosti '||fmt_num_cs((v_data->>'dluh')::numeric)||' Kč'||
           case when (v_data->>'nejstarsi_dni')::numeric > 0
                then ' (nejstarší '||(v_data->>'nejstarsi_dni')||' dní po splatnosti, splatný od '||(v_data->>'dluh_od')||')' else '' end||
           '; k úhradě celkem '||fmt_num_cs((v_data->>'k_uhrade')::numeric)||' Kč včetně faktur ve splatnosti'||
           case when (v_data->>'predepsano')::numeric > 0
                then '; předepsáno dopředu (ještě nevystaveno) '||fmt_num_cs((v_data->>'predepsano')::numeric)||' Kč' else '' end||
           '. Smlouvy: '||(v_data->>'smluv')||
           case when (v_data->>'smluv_navrzeno')::int > 0
                then ' (z toho '||(v_data->>'smluv_navrzeno')||' jen navržené — strany nepotvrzené)' else '' end||
           case when jsonb_array_length(coalesce(v_data->'smlouvy','[]'::jsonb)) > 0
                then ' — '||(select string_agg(x, ', ') from jsonb_array_elements_text(v_data->'smlouvy') x)||
                     case when (v_data->>'smluv')::int > 3 then ' a další' else '' end
                else '' end||'.'||
           -- přiznat doklady bez stavu úhrady: v číslech výše NEJSOU
           case when coalesce((v_data->>'bez_stavu')::int, 0) > 0
                then ' U '||(v_data->>'bez_stavu')||' vydaných faktur ('||coalesce(to_char((v_data->>'bez_stavu_prvni')::date, 'FMDD. FMMM. YYYY'), '?')||' → '||
                     coalesce(to_char((v_data->>'bez_stavu_posledni')::date, 'FMDD. FMMM. YYYY'), '?')||') zdroj stav úhrady nedodal — v číslech nejsou.' else '' end||
           ' Poslední vydaná faktura '||coalesce(to_char((v_data->>'posledni_vydana')::date, 'FMDD. FMMM. YYYY'), '—')||'.'
      end
    when 'relationship' then
      -- SOUČASNOST PRVNÍ, historie za ní
      case when v_coverage='none' then coalesce(v_firm_label,'Tahle firma')||
           ': v evidenci nemáme žádnou fakturu — obchodní vztah z dokladů neumím doložit. Smlouvy: '||(v_data->>'smluv')||'.'
      else v_firm_label||': poslední doklad '||coalesce(to_char((v_data->>'posledni')::date, 'FMDD. FMMM. YYYY'), '?')||
           '; za posledních 12 měsíců vyfakturováno '||fmt_num_cs(coalesce((v_data->>'vydano_12m')::numeric, 0))||' Kč.'||
           case when (v_data->>'vydanych')::int > 0
                then ' Odběratel (naše vydané faktury): '||coalesce(to_char((v_data->>'odberatel_od')::date, 'FMDD. FMMM. YYYY'), '?')||' → '||
                     coalesce(to_char((v_data->>'odberatel_do')::date, 'FMDD. FMMM. YYYY'), '?')||', dokladů '||(v_data->>'vydanych')||'.' else '' end||
           case when (v_data->>'predepsanych')::int > 0
                then ' Předepsáno dopředu (ještě nevystaveno): '||(v_data->>'predepsanych')||'.' else '' end||
           case when (v_data->>'prijatych')::int > 0
                then ' Dodavatel (přijaté faktury): '||coalesce(to_char((v_data->>'dodavatel_od')::date, 'FMDD. FMMM. YYYY'), '?')||' → '||
                     coalesce(to_char((v_data->>'dodavatel_do')::date, 'FMDD. FMMM. YYYY'), '?')||', dokladů '||(v_data->>'prijatych')||'.' else '' end||
           ' Smlouvy: '||(v_data->>'smluv')||'.'
      end
    when 'tenant_rent' then
      -- „fakturuje se", ne „platí": částka je z VYSTAVENÝCH faktur (bez DPH),
      -- o úhradě nic neříká — to je záměr `debt`.
      -- Odpověď VŽDY jmenuje firmu, o které mluví: u volby v pohledu je jinak
      -- nerozeznatelné, jestli platila volba, nebo jméno z otázky.
      case when v_coverage='none' and v_data ? 'poznamka' then
             coalesce(v_firm_label, 'Tahle firma')||': nájem se nederivuje — instance nemá nastavené vzory nájemních položek.'
           when v_coverage='none' then
             coalesce(v_firm_label, 'Tuhle firmu')||': mezi plátci nájmu (fakturované nájemní položky, období '||
             coalesce(v_data->>'obdobi','?')||') jsem ji nenašel.'
      else (v_data->>'tenant')||': nájem se fakturuje '||fmt_num_cs((v_data->>'monthly_amount')::numeric)||
           ' Kč bez DPH měsíčně (naposledy fakturováno '||coalesce(v_data->>'period','?')||
           case when (v_data->>'active')::boolean then ')' else ', tedy NE v aktuálním období)' end||'.' end
    when 'energy_consumption' then
      case when v_target_firm is not null and v_coverage<>'none' then
        (v_data->>'firma')||': spotřeba '||fmt_num_cs((v_data->>'spotreba_kwh')::numeric,1)||' kWh, náklad '||
        fmt_num_cs((v_data->>'naklad_czk')::numeric)||' Kč (elektřina, zdroj sez-fakturace). Pozn.: plyn/voda zatím nevytěženo.'
      when v_target_firm is not null then 'Pro tuto firmu nemáme naměřenou spotřebu.'
      when v_target_object is not null then
        'Areál '||(v_data->>'objekt')||' (elektřina): '||fmt_num_cs((v_data->>'spotreba_kwh')::numeric,1)||' kWh, '||
        fmt_num_cs((v_data->>'naklad_czk')::numeric)||' Kč, '||(v_data->>'firem_s_energii')||' firem s měřením. Pozn.: jen elektřina.'
      when v_super is not null and jsonb_array_length(v_rows)>0 then
        -- superlativ i u energie: „kdo má největší spotřebu" → konkrétní firma
        case when v_super='min' then 'Nejnižší spotřebu (elektřina) má '||(v_rows->-1->>'firma')||': '||fmt_num_cs((v_rows->-1->>'kwh')::numeric,1)||' kWh ('||fmt_num_cs((v_rows->-1->>'czk')::numeric)||' Kč).'
             else 'Největší spotřebu (elektřina) má '||(v_rows->0->>'firma')||': '||fmt_num_cs((v_rows->0->>'kwh')::numeric,1)||' kWh ('||fmt_num_cs((v_rows->0->>'czk')::numeric)||' Kč).' end
        ||' Pozn.: jen elektřina; plyn/voda zatím ne.'
      else 'Elektřina areálu: '||(v_data->>'firem_s_energii')||' firem, '||
        fmt_num_cs((v_data->>'spotreba_kwh_celkem')::numeric,1)||' kWh, '||
        fmt_num_cs((v_data->>'naklad_czk_celkem')::numeric)||' Kč. Pozn.: jen elektřina; plyn/voda zatím ne.' end
    when 'object_summary' then
      'Objekt '||(v_data->>'objekt')||': elektřina '||
      fmt_num_cs((v_data->>'energie_kwh')::numeric,1)||' kWh ('||fmt_num_cs((v_data->>'energie_czk')::numeric)||' Kč). '||
      'Nájem za jednotlivý objekt zatím neumím doložit — doklad nenese, které budovy se týká.'
    when 'machine_ops' then
      case when q ~ '(tonaz|tun[ay ])' then
        'Tonáž neměříme — v datech je hodnota nákladu v Kč, ne hmotnost. Dopočet tun by byl odhad, a ten nedělám.'
      else
        'Kniha jízd zatím do stacku neteče (sekce Provozy čeká na napojení telematiky). Nemám co doložit — nehádám.' end
    when 'contract_terms' then
      'Toto ('||regexp_replace(p_question,'\s+',' ','g')||') je v OBSAHU smlouvy'||
      coalesce(' firmy '||v_firm_label,'')||', který zatím není strojově ověřený jako tvrdá pravda. '||
      'Nechci hádat — dokument je ale dostupný k nahlédnutí oprávněnému uživateli.'
    when 'tenant_seat' then
      case when v_coverage='none' then 'Sídlo/IČO'||coalesce(' firmy '||v_firm_label,'')||' zatím není v ověřených datech (navázat z ARES/smlouvy).'
      else v_firm_label||':'||coalesce(' IČO '||(v_data->>'ico'),'')||coalesce(', DIČ '||(v_data->>'dic'),'')||
           coalesce(case when v_data ? 'ico' then ';' else '' end||' adresa podle posledního dokladu: '||(v_data->>'adresa'),'')||'.' end
    when 'tenant_area' then 'Plochu'||coalesce(' firmy '||v_firm_label,'')||' dnes neumím tvrdě ověřit — OCR ze smlouvy uvádí plochu celé budovy, ne pronajaté jednotky. Potřebuje ověřenou extrakci.'
    when 'energy_timeseries' then '3měsíční rozpad spotřeby zatím nemáme — jen souhrnnou fakturační periodu.'
    when 'tenant_deposits' then 'Zálohy'||coalesce(' firmy '||v_firm_label,'')||' zatím nejsou vytěžené z faktur/předpisů.'
    else 'Dotaz jsem nezařadil k žádné ověřené oblasti dat.'
  end;

  if v_style='detailni' and jsonb_array_length(v_rows)>0 then
    v_answer := v_answer||' Detail: '||(select string_agg((r->>'firma')||' '||coalesce(r->>'rocni_najem_czk',r->>'czk')||'',', ') from jsonb_array_elements(v_rows) r limit 1);
  end if;
  if v_style='odborny' then v_answer := v_answer||' [zdroj: '||v_source||']'; end if;
  -- Kanonické pořadí i pro doplněné souřadnice: vektor, který se zapisuje do
  -- ai_runs a čte se po měsíci, musí být bajtově stejný pro stejné zadání.
  select coalesce(jsonb_agg(c order by c->>'dim'), '[]'::jsonb) into v_scope_used
  from jsonb_array_elements(v_scope_used) c;

  return jsonb_build_object('question',p_question,'intent',v_intent,'coverage',v_coverage,
    'answer',v_answer,'source',v_source,'data',v_data,'rows',v_rows,
    -- Pod jakým vektorem odpověď vznikla + co z požadovaného nepřežilo.
    -- Bez těchhle dvou polí je odpověď nepřiřaditelná: nešlo by poznat, jestli
    -- číslo platí pro firmu, kterou si čtenář vybral, nebo pro tu, kterou
    -- omylem zmínil v otázce.
    'scope',v_scope_used,'scope_dropped',coalesce(v_scope->'dropped','[]'::jsonb));
end
$fn$;

revoke all on function public.answer_verified_facts(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.answer_verified_facts(text, text, jsonb, jsonb) to authenticated, service_role;
