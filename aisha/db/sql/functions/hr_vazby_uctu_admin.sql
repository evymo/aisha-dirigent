-- ============================================================================
-- Source of Truth: hr_vazby_uctu_admin
-- Popis: Pro správu v Lidé a účty: vazby osoby účtu na identity (nárok z vazeb)
--        a druhy vazeb, které pravidla instance znají (twin_scope_doc_rules).
--        Rozhodnutí majitele 2026-09-28: k čemu se uživatel dostane, nastavuje
--        správa u uživatele — sekce (udělení) i vazby na data (tady).
--        U identity se vrací i počet POTVRZENÝCH identifikátorů druhů, podle
--        kterých pravidla doklady párují — bez nich vazba data nepřinese.
-- Bezpečnost: SECURITY DEFINER; jen správa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hr_vazby_uctu_admin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_osoba uuid;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: jen správa' USING ERRCODE = '42501';
  END IF;
  SELECT r.twin_id INTO v_osoba
    FROM public.twin_external_refs r
   WHERE r.ref_kind = 'account' AND r.state = 'confirmed' AND r.source_key = p_user_id::text
     AND r.valid_from <= now() AND (r.valid_to IS NULL OR r.valid_to > now())
   ORDER BY r.confirmed_at DESC NULLS LAST LIMIT 1;

  RETURN jsonb_build_object(
    'osoba', (SELECT jsonb_build_object('twin_id', t.id, 'label', t.label) FROM public.twin_entities t WHERE t.id = v_osoba),
    'druhy', coalesce((SELECT jsonb_agg(DISTINCT p.relation_kind) FROM public.twin_scope_doc_rules p WHERE p.is_active), '[]'::jsonb),
    'vazby', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'relation_id',   v.id,
               'twin_id',       t.id,
               'label',         t.label,
               'entity_type',   t.entity_type,
               'relation_kind', v.relation_kind,
               'od',            v.valid_from,
               'identifikatoru', (SELECT count(*) FROM public.twin_external_refs r
                                   WHERE r.twin_id = t.id AND r.state = 'confirmed'
                                     AND r.valid_from <= now() AND (r.valid_to IS NULL OR r.valid_to > now())
                                     AND r.ref_kind IN (SELECT unnest(p.ref_kinds) FROM public.twin_scope_doc_rules p
                                                         WHERE p.is_active AND p.relation_kind = v.relation_kind)))
             ORDER BY t.label)
        FROM public.twin_relations v
        JOIN public.twin_entities t ON t.id = v.target_twin_id
       WHERE v.source_twin_id = v_osoba
         AND v.valid_from <= now() AND (v.valid_to IS NULL OR v.valid_to > now())
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_vazby_uctu_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_vazby_uctu_admin(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.hr_vazby_uctu_admin(uuid) IS
  'Správa: vazby osoby účtu na identity (nárok z vazeb), druhy vazeb z pravidel a počet potvrzených identifikátorů u identity.';
