-- ============================================================================
-- Source of Truth: ma_plny_pristup_k_datum
-- Popis: Má uživatel od správy udělený PLNÝ přístup k datům (zdroj `vse:*`)?
--        ⭐ Majitel 2026-09-28: „pokud mám přístup do dané sekce, měl bych vidět veškerý
--        obsah, ke kterému mám právo… rád bych dal možnost bez omezení, ne s výběrem toho,
--        kdo se o daného nájemce stará; možnost omezit chceme zachovat". Plný přístup =
--        všechny doklady a dvojčata (smlouvy, agendy, jednotky, nájemci) — ale ne správa:
--        sekce se dál udělují zvlášť, administrace zůstává rolím.
--        Množinový/InitPlan člen čtecích politik registru a dvojčat (jedno vyhodnocení
--        za dotaz, ne per řádek).
-- Bezpečnost: SECURITY DEFINER (data_source_grants nemá granty pro authenticated) +
--        oracle guard: přihlášený se ptá jen na SEBE; služba a správa za kohokoli.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ma_plny_pristup_k_datum(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_uid IS NOT NULL
     AND (p_uid = auth.uid() OR public.is_service_role() OR public.is_admin_or_staff())
     AND EXISTS (SELECT 1 FROM public.data_source_grants g
                  WHERE g.user_id = p_uid AND g.zdroj = 'vse:*');
$$;

REVOKE ALL ON FUNCTION public.ma_plny_pristup_k_datum(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ma_plny_pristup_k_datum(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.ma_plny_pristup_k_datum(uuid) IS
  'Plný přístup k datům udělený správou (data_source_grants vse:*) — člen čtecích politik registru a dvojčat; ne správa. Oracle guard: jen vlastní účet.';
