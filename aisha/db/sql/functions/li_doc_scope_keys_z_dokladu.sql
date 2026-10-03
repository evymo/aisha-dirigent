-- ============================================================================
-- Source of Truth: li_doc_scope_keys_z_dokladu
-- Popis: Klíče JEDNOHO dokladu pro nárok — JEDINÉ místo té logiky (volá ji trigger
--        na registru i přestavba, aby se klíče z jednotlivého zápisu a z přestavby
--        nemohly rozejít):
--          • pole, která zná aktivní pravidlo twin_scope_doc_rules pro typ dokladu
--            (nárok z vazeb), a protistrana (counterparty_id, counterparty) u každého
--            dokladu (dvojčata v rozsahu);
--          • PŮVOD (každý doklad, bez ohledu na pravidla) — zdroj dat pro udělení přístupu:
--              `@instance` = instance zdroje, ze které doklad přišel, jak ji zapsal KONEKTOR
--                            do zdrojového záznamu (`source_record._instance`, druh zdroje
--                            z `_marker` před tečkou): „money/Areál Avant Ďáblická";
--              `@cesta`    = každý nadřazený adresář relativní cesty ve vstupu ingestu
--                            (raw_data.source_path; „A/B/c.pdf" → „A", „A/B");
--              `@vstup`    = „dokumenty": doklad ze ZPRACOVANÉHO VSTUPU ingestu (soubor, ne záznam
--                            konektoru — `source_record` je JSON null, nebo nese source_path).
--                            ⭐ Majitel 2026-09-28: „všechna data, ale rozdělená po zdrojích —
--                            Money už máme, teď nám jde o dokumenty, smlouvy…". Naměřeno: 1 023
--                            dokladů (813 smluv, 114 dodatků, 94 faktur v PDF, 2 vyúčtování).
--              `@firma`    = IČO smluvní strany (supplier_id, counterparty_id) u SMLUVNÍCH
--                            dokumentů (třída `contractual`) — „vazba na firmy, které vidíme
--                            v přehledu". Doklady z konektoru (Money) se zpřístupňují instancí,
--                            ne firmou: jinak by udělení firmy otevřelo cizí faktury, kde je
--                            firma odběratelem, a blok dlužníků by z ní udělal dlužníka.
--            Předpona `@` se nesrazí se jménem pole dokladu v pravidlech.
--        ⭐ Majitel 2026-09-28: „ingest navrhuje vazby, protistrany… ale neměl by řešit, kdo
--        k čemu má přístup; MODĚVA, Avant… to jsou zdroje dat z Money, které chceme
--        zpřístupnit". Proto původ ze ZÁZNAMU KONEKTORU, ne z pole vytaženého ingestem
--        (owner_company) — přístup nezávisí na tom, co ingest z dokladu přečetl.
--
-- Hodnota: `{value, status, …}` → value; starší korpus má skalár. Bere se jen
--   řetězec nebo číslo. Normalizace lower(btrim(...)); `zobrazeni` = původní zápis
--   (jen u klíčů původu — pro výběr zdroje v administraci).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_doc_scope_keys_z_dokladu(p_doc_type text, p_doc_class text, p_fields jsonb, p_raw jsonb)
RETURNS TABLE (field_key text, hodnota text, zobrazeni text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH klice AS (
    SELECT p.field_key
      FROM public.twin_scope_doc_rules p
     WHERE p.is_active AND p.doc_type = p_doc_type
    UNION
    -- Protistrana u KAŽDÉHO dokladu: čtení dvojčat v rozsahu (karta dlužníka, síť
    -- vazeb) ji potřebuje i u dokladů z udělených zdrojů, ne jen z pravidel.
    SELECT k FROM unnest(ARRAY['counterparty_id', 'counterparty']) AS k
  ),
  hodnoty AS (
    SELECT k.field_key,
           coalesce(p_fields->k.field_key->'value', p_fields->k.field_key) AS v
      FROM klice k
  ),
  instance AS (
    SELECT nullif(btrim(p_raw->'source_record'->>'_instance'), '') AS jmeno,
           coalesce(nullif(split_part(p_raw->'source_record'->>'_marker', '.', 1), ''), 'zdroj') AS druh
     WHERE jsonb_typeof(p_raw->'source_record') = 'object'
  ),
  cesta AS (
    SELECT string_to_array(btrim(p_raw->>'source_path', '/'), '/') AS casti
     WHERE nullif(btrim(coalesce(p_raw->>'source_path', ''), '/'), '') IS NOT NULL
  ),
  strana AS (
    SELECT btrim(coalesce(p_fields->k->'value', p_fields->k) #>> '{}') AS ico
      FROM unnest(ARRAY['supplier_id', 'counterparty_id']) AS k
     WHERE p_doc_class = 'contractual'
       AND jsonb_typeof(coalesce(p_fields->k->'value', p_fields->k)) IN ('string', 'number')
  )
  SELECT DISTINCT h.field_key, lower(btrim(h.v #>> '{}')), NULL::text
    FROM hodnoty h
   WHERE jsonb_typeof(h.v) IN ('string', 'number')
     AND btrim(h.v #>> '{}') <> ''
  UNION
  SELECT '@instance', lower(i.druh || '/' || i.jmeno), i.druh || '/' || i.jmeno
    FROM instance i
   WHERE i.jmeno IS NOT NULL
  UNION
  SELECT '@cesta', lower(array_to_string(c.casti[1:n], '/')), array_to_string(c.casti[1:n], '/')
    FROM cesta c, generate_series(1, cardinality(c.casti) - 1) AS n
  UNION
  SELECT '@firma', s.ico, s.ico
    FROM strana s
   WHERE s.ico ~ '^[0-9]{8}$'
  UNION
  SELECT '@vstup', 'dokumenty', 'dokumenty'
   WHERE (p_raw ? 'source_record' AND jsonb_typeof(p_raw->'source_record') = 'null')
      OR nullif(btrim(coalesce(p_raw->>'source_path', '')), '') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.li_doc_scope_keys_z_dokladu(text, text, jsonb, jsonb) FROM PUBLIC;

COMMENT ON FUNCTION public.li_doc_scope_keys_z_dokladu(text, text, jsonb, jsonb) IS
  'Klíče jednoho dokladu: pole z aktivních twin_scope_doc_rules + protistrana, a PŮVOD pro udělení zdroje dat (@instance = instance zdroje ze záznamu konektoru, @cesta = nadřazené adresáře relativní cesty ve vstupu, @firma = IČO smluvní strany smluvního dokumentu, @vstup = dokumenty zpracovaného vstupu). Jediná logika pro trigger i přestavbu.';
