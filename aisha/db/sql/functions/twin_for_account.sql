-- ============================================================================
-- Source of Truth: twin_for_account
-- Popis: Dvojče (entita jádra), na které ukazuje POTVRZENÁ a platná reference
--        účtu (`twin_external_refs.ref_kind='account'`). ADR-003 (K1): identita
--        je dvojče, účet je jedna potvrzená reference. Vrací NULL, dokud účet
--        dvojče nemá (před backfillem) — volající s tím musí počítat, nikdy
--        nehádat.
--
-- SECURITY INVOKER záměrně: čte se pod právy volajícího, RLS nad
-- twin_external_refs rozhoduje, co je vidět. Pohledy audience modulu ji volají
-- z DEFINER blokových RPC (vlastník → vidí vše), člen z vlastní session vidí
-- jen svou referenci. Konvence klíče je táž, kterou používá
-- workflow_step_visible_to: source_key = účet jako text.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_for_account(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT r.twin_id
  FROM public.twin_external_refs r
  WHERE r.ref_kind = 'account'
    AND r.source_key = p_user_id::text
    AND r.state = 'confirmed'
    AND r.valid_to IS NULL
  ORDER BY r.confirmed_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.twin_for_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_for_account(uuid) TO authenticated, service_role;
