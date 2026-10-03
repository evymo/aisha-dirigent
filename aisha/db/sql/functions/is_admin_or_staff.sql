-- Function: public.is_admin_or_staff
-- Arguments: p_user_id uuid DEFAULT NULL
-- Description: Helper to check if a user is admin or staff.
-- Notes:
-- - Supports calls with 0 args via DEFAULT.
-- - Safe for use in RLS policies and SECURITY DEFINER RPCs.
-- Extracted: 2026-01-08T18:27:53+01:00

-- Historický overload bez argumentu (dnešní 1-arg varianta ho pokrývá DEFAULTem).
-- Bezpečný: na dnešní DB neexistuje, a kdyby existoval, nic na něm nevisí.
DROP FUNCTION IF EXISTS public.is_admin_or_staff();

-- ⛔ ZDE NESMÍ BÝT `DROP FUNCTION IF EXISTS public.is_admin_or_staff(uuid)`.
-- Na prázdné DB (baseline, cold start) je to neškodný no-op — ale tenhle soubor
-- je od 2026-07-30 zapojený i v heals.sql, který se přehrává na BĚŽÍCÍ databázi,
-- kde na funkci závisí 253 policies. Cold-start brána to chytila okamžitě:
--   ERROR: cannot drop function is_admin_or_staff(uuid) because other objects
--   depend on it — policy Admins and staff can view audit journal on table
--   audit_journal … and 231 other objects
-- `CREATE OR REPLACE` níž zvládne změnu těla i volatility bez zahození závislostí;
-- DROP by byl potřeba jen při změně návratového typu nebo jmen parametrů — a to
-- je změna kontraktu, která si žádá vlastní rozvahu, ne tichý DROP v heals.

CREATE OR REPLACE FUNCTION public.is_admin_or_staff(p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
-- STABLE: čte user_roles, nic nemění, a v rámci jednoho dotazu je výsledek
-- konstantní. Do 2026-07-30 byla funkce (defaultně) VOLATILE — jediná ze své
-- třídy (document_visible_to i is_service_role STABLE už byly). VOLATILE zakazuje
-- plánovači jakoukoli úsporu, takže se v RLS predikátu volala per řádek.
-- POZOR — samotné STABLE latenci NEŘEŠÍ: změřeno na 43 157 řádcích 10 405 ms
-- (volatile) vs 10 509 ms (stable). Postgres STABLE funkci z RLS `qual` sám
-- nevytáhne; vytáhne ji jen jako poddotaz `(select f())` → InitPlan (27 ms).
-- Volající policy tedy MUSÍ funkci obalit; tady se jen srovnává deklarace
-- s realitou (a otevírá se úspora tam, kde ji plánovač využít umí).
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_user_id
      AND role IN ('admin', 'staff')
  );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.is_admin_or_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_staff(uuid) TO authenticated;
-- service_role: SECURITY INVOKER seed-chain RPCs (ensure_stack_default_story,
-- start_web_artifact_ingest) evaluate this read-only authz helper as the real
-- service_role role at boot (Postgres does not guarantee AND/OR short-circuit,
-- so it runs even when the service_role branch already passed). Returns the same
-- result (false, auth.uid() NULL) — the grant only avoids a permission error.
GRANT EXECUTE ON FUNCTION public.is_admin_or_staff(uuid) TO service_role;
