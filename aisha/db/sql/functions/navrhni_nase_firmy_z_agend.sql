-- ============================================================================
-- Source of Truth: navrhni_nase_firmy_z_agend
-- Popis: NÁVRH „naše firma" pro každou instanci zdroje, která se objevila v datech
--        (klíč původu `@instance`, např. agenda Money „money/Areál Drutěva, družstvo")
--        a o které ještě nikdo nerozhodl. Návrh = twin_external_refs ref_kind
--        'nase_firma' ve stavu proposed (source = druh zdroje, source_key = jméno
--        instance) na firmě téhož jména; když firma není, založí se. Schvaluje člověk
--        ve frontě identifikátorů (review_queue twin_identity) — jedním potvrzením;
--        potvrzený název je zároveň SCHVÁLENÝ název firmy (counterparty_resolve).
--        ⭐ Majitel 2026-09-28: „až příště přidáme novou agendu z Money… aby nám to
--        odhalil a doporučil ve správě ingestu a stačilo to jen potvrdit".
--        Zamítnutý návrh se znovu nenavrhne (rozhodnutí člověka platí).
--        Jméno instance přichází ze ZÁZNAMU KONEKTORU, ne z pole vytaženého ingestem.
-- Volá: trigger li_doc_scope_keys_nase_firmy (nové instance) a heals (jednorázově).
-- Bezpečnost: SECURITY DEFINER bez grantů — volá jen vlastník (trigger, migrace).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.navrhni_nase_firmy_z_agend(p_zobrazeni text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r      record;
  v_twin uuid;
  v_n    integer := 0;
BEGIN
  FOR r IN
    SELECT split_part(k.zobrazeni, '/', 1)                             AS druh,
           btrim(substr(k.zobrazeni, strpos(k.zobrazeni, '/') + 1))    AS jmeno,
           count(DISTINCT k.source_sha256)                             AS dokladu
      FROM public.li_doc_scope_keys k
     WHERE k.field_key = '@instance'
       AND k.zobrazeni IS NOT NULL
       AND strpos(k.zobrazeni, '/') > 1
       AND (p_zobrazeni IS NULL OR k.zobrazeni = ANY (p_zobrazeni))
     GROUP BY 1, 2
  LOOP
    CONTINUE WHEN r.jmeno = '';
    -- O instanci už někdo rozhodl (navrženo, schváleno i zamítnuto) → nic.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.twin_external_refs x
                           WHERE x.ref_kind = 'nase_firma' AND x.source = r.druh
                             AND lower(x.source_key) = lower(r.jmeno));
    v_twin := NULL;
    SELECT t.id INTO v_twin
      FROM public.twin_entities t
     WHERE t.entity_type = 'company' AND t.status = 'active'
       AND lower(btrim(t.label)) = lower(r.jmeno)
     ORDER BY t.created_at
     LIMIT 1;
    IF v_twin IS NULL THEN
      INSERT INTO public.twin_entities (entity_type, label)
      VALUES ('company', r.jmeno)
      RETURNING id INTO v_twin;
    END IF;
    INSERT INTO public.twin_external_refs (twin_id, source, source_key, ref_kind, state, proposed_by, confidence, note)
    VALUES (v_twin, r.druh, r.jmeno, 'nase_firma', 'proposed', 'ingest:' || r.druh, 1.0,
            format('nová agenda v datech zdroje %s (%s dokladů)', r.druh, r.dokladu));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.navrhni_nase_firmy_z_agend(text[]) FROM PUBLIC;
COMMENT ON FUNCTION public.navrhni_nase_firmy_z_agend(text[]) IS
  'Návrh „naše firma" (twin_external_refs nase_firma, proposed) pro instance zdroje z dat, o kterých ještě nikdo nerozhodl; firmu téhož jména najde, jinak založí. Schvaluje člověk ve frontě identifikátorů.';
