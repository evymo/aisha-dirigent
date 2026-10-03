-- ============================================================================
-- Source of Truth: fn_li_doc_scope_keys_nase_firmy (trigger, po příkazu)
-- Popis: Když do klíčů původu přibude instance zdroje, o které ještě nikdo nerozhodl
--        (nová agenda Money…), vznikne návrh „naše firma" (navrhni_nase_firmy_z_agend).
--        Po příkazu s tabulkou přechodu: přestavba klíčů (stovky tisíc řádků) = jedno
--        volání; běžný zápis dokladu známé agendy skončí na NOT EXISTS bez práce.
-- Pár: triggers/li_doc_scope_keys_nase_firmy.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_li_doc_scope_keys_nase_firmy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_nove text[];
BEGIN
  -- Nejdřív ODLIŠNÉ instance (přestavba = desítky tisíc řádků `@instance`, instancí
  -- jednotky), teprve na nich dotaz do twin_external_refs — ne jednou za řádek.
  SELECT array_agg(d.z) INTO v_nove
    FROM (SELECT DISTINCT n.zobrazeni AS z
            FROM nove n
           WHERE n.field_key = '@instance'
             AND n.zobrazeni IS NOT NULL
             AND strpos(n.zobrazeni, '/') > 1) d
   WHERE NOT EXISTS (SELECT 1 FROM public.twin_external_refs x
                      WHERE x.ref_kind = 'nase_firma'
                        AND x.source = split_part(d.z, '/', 1)
                        AND lower(x.source_key) = lower(btrim(substr(d.z, strpos(d.z, '/') + 1))));
  IF v_nove IS NOT NULL THEN
    PERFORM public.navrhni_nase_firmy_z_agend(v_nove);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_li_doc_scope_keys_nase_firmy() FROM PUBLIC;
