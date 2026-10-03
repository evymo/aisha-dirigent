-- ============================================================================
-- Index: idx_li_source_registry_filename — identita dokladu je JMÉNO
-- ============================================================================
-- Index na jméno souboru — identita dokladu je JMÉNO (doc_identity=@filename),
-- takže se podle něj v každém upsertu hledá: `li_upsert_source_registry` jím
-- páruje příchozí dávku na existující doklady a rozhoduje, jestli je refresh
-- jednoznačný (právě jeden řádek toho jména).
--
-- PROČ VZNIKL: bez něj tohle párování udělalo z každé dávky sekvenční průchod
-- registrem NA ŘÁDEK. Naměřeno na produkci 2026-07-31: dávka 4 050 faktur proti
-- 63 830 řádkům skončila `Query read timeout`, li-driver bundle fail-closed
-- odmítl a držel kurzor. Nebyla to vada dat ani doktríny, ale chybějící index
-- pod dotazem, který se nově ptá každý běh.
--
-- ZÁMĚRNĚ NE UNIQUE: registr dnes žádné duplicitní jméno nemá (0 z 63 830), ale
-- unikátní index by z historického duplikátu udělal tvrdou chybu importu místo
-- fail-safe větve, kterou upsert vědomě má (dvojznačné jméno = nechat být, ne
-- hádat, který řádek je ten pravý).
CREATE INDEX IF NOT EXISTS idx_li_source_registry_filename
  ON public.li_source_registry (filename);
