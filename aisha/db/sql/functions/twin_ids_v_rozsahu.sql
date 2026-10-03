-- ============================================================================
-- Source of Truth: twin_ids_v_rozsahu
-- Popis: Dvojčata, která smí volající ČÍST, protože je s nimi spojen vazbou:
--          • identity, na které má platnou vazbu druhu z twin_scope_doc_rules,
--          • jeho vlastní osoba (jen když nějakou takovou vazbu má),
--          • protistrany dokladů v jeho rozsahu (li_doc_slugs_v_rozsahu — z vazeb
--            i z udělených zdrojů dat) —
--            firmy podle IČO (company_ico, ne zamítnuté) nebo podle názvu,
--            stejně jako je dohledává counterparty_resolve.
--        Množinový člen politik twin_entities_read / twin_external_refs_read /
--        twin_relations_read.
--
-- ⭐ PROČ (2026-09-28): karta dlužníka, síť vazeb a registry čtou dvojčata
--   (SECURITY INVOKER). Dvojčata dosud četla jen správa, takže běžný uživatel
--   by viděl faktury dlužníka, ale kartu prázdnou.
--
-- ⛔ Bez vazby a bez uděleného zdroje dat (dokladů ani dvojčat) prázdno — ani vlastní osoba.
--   Řidič s potvrzeným účtem tak nezíská nic nového; tahle funkce mění jen třídy
--   „uživatel s vazbou na identitu" a „uživatel s uděleným zdrojem dat".
--
-- Bezpečnost: SECURITY DEFINER + oracle guard (jen SVŮJ rozsah; service_role /
--   správa za kohokoliv). Správa vidí vše prvním členem politik → prázdno.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.twin_ids_v_rozsahu(p_uid uuid)
RETURNS SETOF uuid
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
    SELECT DISTINCT v.source_twin_id AS osoba_id, v.target_twin_id AS twin_id
      FROM osoba o
      JOIN public.twin_relations v ON v.source_twin_id = o.twin_id
     WHERE v.valid_from <= now() AND (v.valid_to IS NULL OR v.valid_to > now())
       AND EXISTS (SELECT 1 FROM public.twin_scope_doc_rules p
                    WHERE p.is_active AND p.relation_kind = v.relation_kind)
  ),
  -- Protistrany dokladů v rozsahu z předpočítaných klíčů (bez rozbalování fields).
  protistrana AS (
    SELECT s.field_key, s.hodnota
      FROM public.li_doc_scope_keys s
     WHERE s.field_key IN ('counterparty_id', 'counterparty')
       AND s.doc_slug IN (SELECT public.li_doc_slugs_v_rozsahu(p_uid))
  )
  SELECT i.twin_id FROM identita i
  UNION
  SELECT i.osoba_id FROM identita i
  UNION
  SELECT r.twin_id
    FROM public.twin_external_refs r
   WHERE r.ref_kind = 'company_ico' AND r.state <> 'rejected'
     AND r.source_key IN (SELECT p.hodnota FROM protistrana p WHERE p.field_key = 'counterparty_id')
  UNION
  SELECT t.id
    FROM public.twin_entities t
   WHERE t.entity_type = 'company' AND t.status = 'active'
     AND lower(btrim(t.label)) IN (SELECT p.hodnota FROM protistrana p WHERE p.field_key = 'counterparty')
  UNION
  -- ⭐ UDĚLENÝ ZDROJ DVOJČAT (2026-09-28, majitel: „všechna data, ale rozdělená po zdrojích"):
  -- `udalosti:<zdroj>` pustí dvojčata, o kterých ten zdroj nese data (twin_events.source) —
  -- např. jednotky ze sez-vyuctovani s nájemcem a obsazeností.
  SELECT DISTINCT e.twin_id
    FROM public.data_source_grants g
    JOIN public.twin_events e ON lower(g.zdroj) = 'udalosti:' || lower(e.source)
   WHERE g.user_id = p_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.twin_ids_v_rozsahu(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_ids_v_rozsahu(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twin_ids_v_rozsahu(uuid) TO service_role;

COMMENT ON FUNCTION public.twin_ids_v_rozsahu(uuid) IS
  'Dvojčata čitelná z vazeb: identity s platnou vazbou (druh z twin_scope_doc_rules), vlastní osoba a protistrany dokladů v rozsahu (IČO / název). Bez vazby prázdno.';
