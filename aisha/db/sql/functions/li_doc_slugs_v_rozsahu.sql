-- ============================================================================
-- Source of Truth: li_doc_slugs_v_rozsahu
-- Popis: Doklady, na které má volající nárok Z VAZEB — „jsem spojen s identitou,
--        které ten doklad patří" — nebo ze ZDROJE DAT, ke kterému mu správa udělila
--        přístup (data_source_grants: instance zdroje od konektoru / podstrom vstupu
--        ingestu). Sourozenec li_doc_slugs_claimed_by (nárok
--        z kroků procesu); oba jsou množinové členy politiky li_source_registry_read.
--
-- Řetěz (vše musí platit TEĎ):
--   účet ──(twin_external_refs ref_kind='account', confirmed)──▶ osoba
--   osoba ──(twin_relations, druh z twin_scope_doc_rules)──▶ identita
--   identita ──(twin_external_refs confirmed, druh z pravidla)──▶ hodnota
--   doklad (doc_type pravidla) · fields.<field_key> == hodnota  ──▶ doc_slug
--
-- ⭐ PROČ (rozhodnutí majitele 2026-09-28): běžný uživatel má vidět smlouvy,
--   faktury a dlužníky jen z přiřazených identit. Bloky dlužníků, nájmů a smluv
--   jsou SECURITY INVOKER, takže nárok zdědí z politiky bez jediné změny čtečky.
--
-- ⛔ Porovnání hodnoty: lower(btrim(...)) na obou stranách. Hodnoty polí dokladů
--   jsou předpočítané v li_doc_scope_keys (li_doc_scope_keys_z_dokladu).
-- ⛔ Jen PLATNÉ verze dokladů mají klíče — nárok míří na platnou verzi.
-- ⛔ Správa vidí vše prvním členem politiky — tady se pro ni vrací prázdno, aby
--   se řetěz nepočítal zbytečně.
--
-- Bezpečnost: SECURITY DEFINER + oracle guard (volající smí vyhodnocovat JEN
--   SVŮJ nárok; service_role / správa za kohokoliv).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_doc_slugs_v_rozsahu(p_uid uuid)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_uid IS NULL
     OR NOT (p_uid = auth.uid() OR public.is_service_role() OR public.is_admin_or_staff()) THEN
    RETURN;
  END IF;
  IF public.is_admin_or_staff(p_uid) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH osoba AS (
    SELECT a.twin_id
      FROM public.twin_external_refs a
     WHERE a.ref_kind = 'account' AND a.state = 'confirmed'
       AND a.source_key = p_uid::text
       AND a.valid_from <= now() AND (a.valid_to IS NULL OR a.valid_to > now())
  ),
  identita AS (
    SELECT DISTINCT v.target_twin_id AS twin_id, v.relation_kind
      FROM osoba o
      JOIN public.twin_relations v ON v.source_twin_id = o.twin_id
     WHERE v.valid_from <= now() AND (v.valid_to IS NULL OR v.valid_to > now())
  ),
  klic AS (
    SELECT DISTINCT p.doc_type, p.field_key, lower(btrim(r.source_key)) AS hodnota
      FROM identita i
      JOIN public.twin_scope_doc_rules p ON p.is_active AND p.relation_kind = i.relation_kind
      JOIN public.twin_external_refs r
        ON r.twin_id = i.twin_id AND r.state = 'confirmed' AND r.ref_kind = ANY (p.ref_kinds)
       AND r.valid_from <= now() AND (r.valid_to IS NULL OR r.valid_to > now())
  )
  -- Předpočítané klíče (li_doc_scope_keys), ne rozbalování fields: nad fields
  -- stálo párování nemovitostní agendy 201–1 353 ms (produkce 2026-09-28).
  SELECT DISTINCT s.doc_slug
    FROM klic k
    JOIN public.li_doc_scope_keys s
      ON s.field_key = k.field_key AND s.hodnota = k.hodnota AND s.doc_type = k.doc_type
  UNION
  -- ⭐ UDĚLENÝ ZDROJ DAT (2026-09-28): „MODĚVA, Avant… to jsou zdroje dat z Money, které
  -- chceme zpřístupnit" — přístup uděluje správa, ingest o něm nerozhoduje. Klíč původu
  -- `@instance` / `@cesta` (cesta obsahuje každý nadřazený adresář — udělený podstrom
  -- pustí i podsložky).
  SELECT s.doc_slug
    FROM public.data_source_grants g
    JOIN public.li_doc_scope_keys s
      ON s.field_key = '@' || split_part(g.zdroj, ':', 1)
     AND s.hodnota = lower(btrim(substr(g.zdroj, strpos(g.zdroj, ':') + 1)))
   WHERE g.user_id = p_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.li_doc_slugs_v_rozsahu(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_doc_slugs_v_rozsahu(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_doc_slugs_v_rozsahu(uuid) TO service_role;

COMMENT ON FUNCTION public.li_doc_slugs_v_rozsahu(uuid) IS
  'Doklady s nárokem z vazeb (účet → osoba → platná vazba druhu z twin_scope_doc_rules → identita → potvrzený identifikátor == pole dokladu) nebo z udělených zdrojů dat (data_source_grants → klíče původu). Množinový člen li_source_registry_read.';
