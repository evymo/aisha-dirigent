-- ============================================================================
-- Source of Truth: ma_zdroj_dat
-- Popis: Má uživatel od správy udělený ASPOŇ JEDEN zdroj dat (data_source_grants)?
--        Člen čtecí politiky katalogu parametrů dvojčat: popisky sloupců registru
--        (jednotky, nájemci) potřebuje každý, komu správa nějaký zdroj dat udělila —
--        jinak by registr z uděleného zdroje ukázal řádky bez sloupců.
-- Bezpečnost: SECURITY DEFINER (data_source_grants nemá granty pro authenticated) +
--        oracle guard: přihlášený se ptá jen na SEBE; služba a správa za kohokoli.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ma_zdroj_dat(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_uid IS NOT NULL
     AND (p_uid = auth.uid() OR public.is_service_role() OR public.is_admin_or_staff())
     AND EXISTS (SELECT 1 FROM public.data_source_grants g WHERE g.user_id = p_uid);
$$;

REVOKE ALL ON FUNCTION public.ma_zdroj_dat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ma_zdroj_dat(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.ma_zdroj_dat(uuid) IS
  'Má uživatel udělený aspoň jeden zdroj dat (data_source_grants)? Člen čtecí politiky katalogu parametrů dvojčat. Oracle guard: jen vlastní účet.';
