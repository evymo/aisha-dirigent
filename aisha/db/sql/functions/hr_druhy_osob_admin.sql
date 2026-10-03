-- ============================================================================
-- Source of Truth: hr_druhy_osob_admin
-- Popis: Druhy twinů a kolik z nich nemá účet — nabídka filtru HR obrazovky.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; jen admin/staff nebo service_role
--
-- ⛔ NAMĚŘENO 2026-09-23 po nasazení „Lidí a účtů" na produkci: seznam osob bez
--    účtu bez filtru obsahuje i 2 286 firem a nabídka druhů se skládala z prvních
--    200 načtených položek — když byly abecedně napřed firmy, „driver" v nabídce
--    NEBYL a HR by řidiče nenašlo jinak než hledáním jména.
--
-- ⛔ DRUHY SE NEDOSAZUJÍ: kód nezná slovo „driver" ani „company" (parametry
--    rozhodují, čím entita je). Nabídka je ODVOZENÁ z dat — každý druh s aktivními
--    twiny, s počtem těch bez účtu, aby HR vidělo, kde je práce.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.hr_druhy_osob_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_items jsonb;
BEGIN
  IF NOT ((SELECT public.is_service_role()) OR (SELECT public.is_admin_or_staff())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('entity_type', d.entity_type, 'celkem', d.celkem, 'bez_uctu', d.bez_uctu)
                            ORDER BY d.bez_uctu DESC, d.entity_type), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT t.entity_type,
           count(*) AS celkem,
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM public.twin_external_refs r
              WHERE r.twin_id = t.id AND r.ref_kind = 'account' AND r.state = 'confirmed'
                AND r.valid_from <= now() AND (r.valid_to IS NULL OR r.valid_to > now()))) AS bez_uctu
      FROM public.twin_entities t
     WHERE t.status = 'active'
     GROUP BY t.entity_type
  ) d;

  RETURN jsonb_build_object('items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_druhy_osob_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_druhy_osob_admin() TO authenticated, service_role;
