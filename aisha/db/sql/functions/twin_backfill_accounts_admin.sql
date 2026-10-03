-- ============================================================================
-- Source of Truth: twin_backfill_accounts_admin
-- Popis: Dorodí dvojčata účtům, které ještě žádné nemají (profily založené
--        před ADR-003 / K1). Jednorázově po nasazení, opakovatelně bez
--        vedlejšího účinku (idempotentní přes twin_ensure_for_account).
--        Vrací počet dorozených účtů. p_limit chrání dlouhou transakci na
--        velké instanci — volá se opakovaně, dokud nevrátí 0.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_backfill_accounts_admin(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r     record;
  v_n   integer := 0;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT p.user_id, COALESCE(nullif(btrim(p.display_name), ''), p.email) AS label
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.twin_external_refs x
      WHERE x.ref_kind = 'account' AND x.source_key = p.user_id::text
        AND x.state = 'confirmed' AND x.valid_to IS NULL)
    ORDER BY p.created_at
    LIMIT greatest(coalesce(p_limit, 5000), 1)
  LOOP
    PERFORM public.twin_ensure_for_account(r.user_id, r.label, 'person', NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.twin_backfill_accounts_admin(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_backfill_accounts_admin(integer) TO authenticated, service_role;
