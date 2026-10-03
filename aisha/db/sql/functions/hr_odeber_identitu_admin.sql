-- ============================================================================
-- Source of Truth: hr_odeber_identitu_admin
-- Popis: Ukončí vazbu osoby na identitu (nárok z vazeb) — historie zůstává,
--        audit přes twin_relation_close_admin. Jen vazby, které pravidla nároku
--        znají (jiné hrany tudy nejdou).
-- Bezpečnost: SECURITY DEFINER; jen správa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hr_odeber_identitu_admin(p_relation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: jen správa' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.twin_relations v
                  WHERE v.id = p_relation_id AND (v.valid_to IS NULL OR v.valid_to > now())
                    AND v.relation_kind IN (SELECT p.relation_kind FROM public.twin_scope_doc_rules p)) THEN
    RAISE EXCEPTION 'relation_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.twin_relation_close_admin(p_relation_id, now(), 'HR Lidé a účty: odebrání vazby na data');
END;
$$;

REVOKE ALL ON FUNCTION public.hr_odeber_identitu_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_odeber_identitu_admin(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.hr_odeber_identitu_admin(uuid) IS
  'Správa: ukončí vazbu osoby na identitu (jen druhy z pravidel nároku); historie zůstává, audit.';
