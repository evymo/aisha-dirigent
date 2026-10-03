-- ============================================================================
-- Source of Truth: twin_param_values
-- Popis: Hodnoty JEDNOHO parametru dvojčat v čase — a jediné místo v jádře,
--        které ví, KDE ta hodnota leží. Kde přesně, říká katalog
--        (`twin_parameter_definitions.metadata`), tedy DATA instance:
--          {"event_type":"trip","attr":"distance_km"}  → veličina v atributu události
--          {"shape":"code_value"}                      → dvojice {code,value}
--                                                        (vzor seedů a get_twin_register)
--        a volitelně PŘEVOD do jednotky parametru:
--          {"scale":0.001}      hodnota × 0,001   (kg → t)
--          {"scale_div":3600}   hodnota ÷ 3600    (s → h; dělení je přesné
--                                                  a čitelnější než 0,000277…)
--        Převod patří sem, protože `unit` je vlastnost PARAMETRU: tachograf
--        posílá sekundy, ale parametr „doba řízení" je v hodinách pro každý
--        blok stejně. Kdyby si násobil každý blok, dvě dlaždice nad týmž
--        parametrem by se mohly lišit — a porovnání se zákonným limitem
--        (561/2006) by záviselo na tom, kdo blok deklaroval.
--        U ADITIVNÍ veličiny (aggregation 'sum' / historization 'event_log')
--        katalog navíc určuje AUTORITU: počítají se jen události zdroje
--        z `source` (nebo jeho dráhy '<source>:…'). Jinak by jízda, kterou
--        hlásí dva dodavatelé, přičetla kilometry dvakrát. Hodnoty se stavem
--        zůstávají vícezdrojové. Nálezy katalogu: twin_catalog_source_findings.
--        Čtečky ploch pak neznají ani typ události, ani jméno atributu: doména
--        je řádek v katalogu, ne řádek v kódu (ADR-003 §3, zákon jmen).
--
-- ⛔ PROČ VZNIKL: do 2026-09 se každá otázka nad flotilou psala jako vlastní
--        funkce (šest `get_fleet_*` se jmény událostí, atributů a limitů uvnitř
--        jádra). Další doména by znamenala další šestici. Tenhle pomocník je
--        šev, za kterým se domény střídají beze změny kódu.
--
-- Nečíselná hodnota se vrací jako NULL, ne jako nula: „nepřečetl jsem to"
--        není „naměřil jsem nulu" (týž zákon jako `value: null` u kpi_tile).
--
-- Bezpečnost: SECURITY INVOKER — o tom, kdo co uvidí, rozhoduje RLS na
--        `twin_events`/`twin_entities`, ne tahle funkce. Fail-closed: bez
--        práva prostě nepřijdou žádné řádky.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_param_values(
  p_code        text,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL,
  p_entity_type text        DEFAULT NULL
)
RETURNS TABLE (twin_id uuid, twin_label text, occurred_at timestamptz, value numeric, source text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH def AS (
    SELECT
      d.code,
      COALESCE(d.metadata->>'shape', 'attr')                         AS shape,
      -- Tvar {code,value} má dohodnutý typ události; atributový tvar ho MUSÍ
      -- deklarovat — bez něj by čtečka sáhla přes všechny typy najednou.
      COALESCE(d.metadata->>'event_type',
               CASE WHEN d.metadata->>'shape' = 'code_value'
                    THEN 'twin_parameter' END)                       AS event_type,
      d.metadata->>'attr'                                            AS attr,
      -- Druh entity z katalogu je výchozí; volající ho smí zúžit, ne rozšířit.
      NULLIF(COALESCE(d.metadata->>'entity_type', d.entity_type), '') AS entity_type,
      -- Nečíselný (nebo nulový) převod se IGNORUJE, ne aby dělil nulou:
      -- překlep v katalogu nesmí shodit plochu, jen zůstane původní jednotka.
      CASE WHEN d.metadata->>'scale' ~ '^-?[0-9]+(\.[0-9]+)?$'
                AND (d.metadata->>'scale')::numeric <> 0
           THEN (d.metadata->>'scale')::numeric ELSE 1 END                AS scale_mul,
      CASE WHEN d.metadata->>'scale_div' ~ '^-?[0-9]+(\.[0-9]+)?$'
                AND (d.metadata->>'scale_div')::numeric <> 0
           THEN (d.metadata->>'scale_div')::numeric ELSE 1 END            AS scale_div,
      -- AUTORITA ZDROJE jen pro ADITIVNÍ veličinu (součet, záznam událostí):
      -- tam by dva zdroje TÉŽE jízdy/tankování sečetly kilometry či litry
      -- dvakrát. Hodnota se stavem (`last`) smí mít zdrojů víc — vyhraje
      -- poslední a původ je vidět (IČO z rejstříku i z dokladů je legitimní).
      CASE WHEN lower(COALESCE(d.aggregation, '')) = 'sum'
             OR lower(COALESCE(d.historization, '')) = 'event_log'
           THEN NULLIF(btrim(d.source), '') END                           AS autorita
    FROM public.twin_parameter_definitions d
    WHERE d.code = p_code
  )
  SELECT
    e.twin_id,
    t.label,
    e.occurred_at,
    -- Bez zaokrouhlení: zaokrouhluje se až AGREGÁT. Kdyby se ořezávala každá
    -- hodnota, týdenní součet 7 dní by se od pravdy lišil o minuty — a proti
    -- limitu 56 h se minuty počítají.
    CASE WHEN r.raw ~ '^-?[0-9]+(\.[0-9]+)?$'
         THEN r.raw::numeric * d.scale_mul / d.scale_div END,
    e.source
  FROM def d
  JOIN public.twin_events e
    ON e.event_type = d.event_type
   AND (d.shape <> 'code_value' OR e.attrs->>'code' = d.code)
  JOIN public.twin_entities t
    ON t.id = e.twin_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN d.shape = 'code_value' THEN e.attrs->>'value'
                ELSE e.attrs->>d.attr END AS raw
  ) r
  WHERE (p_from IS NULL OR e.occurred_at >= p_from)
    AND (p_to   IS NULL OR e.occurred_at <  p_to)
    -- ZÚŽENÍ, ne přebití: platí OBĚ podmínky, takže volající smí množinu jen
    -- zmenšit. Do 2026-09-20 tu stálo `COALESCE(p_entity_type, d.entity_type)`,
    -- což katalogovou deklaraci PŘEBÍJELO — blok si mohl říct o jiný druh
    -- entity, než parametr popisuje, a dostal data z cizí domény. Komentář
    -- sliboval zúžení, kód dělal záměnu; teď to vynucuje kód.
    -- Nesouhlasná dvojice nevrátí nic: konfigurační chyba se přizná jako
    -- NEMĚŘENO, což je pravdivější než čísla, o která nikdo nežádal.
    AND (d.entity_type IS NULL OR t.entity_type = d.entity_type)
    AND (p_entity_type IS NULL OR t.entity_type = p_entity_type)
    -- Autorita: událost od zdroje, kterého katalog jmenuje, nebo z jeho dráhy
    -- ('eurowag-telematics:trip' pro 'eurowag-telematics'). `starts_with`,
    -- ne LIKE — podtržítko ve slugu by bylo zástupný znak. Volba zdroje je
    -- DATA katalogu (administrace), ne kód; radši veličinu neukázat než
    -- ukázat sečtenou ze dvou zdrojů. Katalog jmenující zdroj, který nic
    -- nezapsal nebo neexistuje, hlásí twin_catalog_source_findings — nahlas.
    AND (d.autorita IS NULL
         OR e.source = d.autorita
         OR starts_with(e.source, d.autorita || ':'));
$$;

COMMENT ON FUNCTION public.twin_param_values(text, timestamptz, timestamptz, text) IS
  'Hodnoty parametru dvojčat v okně; kde hodnota leží a v jaké jednotce, říká katalog (metadata.event_type/attr nebo shape=code_value, volitelně scale/scale_div). SECURITY INVOKER — vidí jen to, co pustí RLS.';

REVOKE ALL ON FUNCTION public.twin_param_values(text, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.twin_param_values(text, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_param_values(text, timestamptz, timestamptz, text) TO service_role;
