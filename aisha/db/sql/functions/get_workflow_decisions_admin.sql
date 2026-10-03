-- ============================================================================
-- Source of Truth: get_workflow_decisions_admin
-- Popis: Přehled rozhodnutí NAD PROCESEM (hromadná uzavření, …) — kdo, kdy, proč,
--        kolik, a jestli už bylo vráceno. Podklad pro správce: dohledat → vrátit.
-- Bezpečnost: bez zvýšených práv (INVOKER) + REVOKE/GRANT; autorizuje volaná
--             get_decisions_admin sama za sebe (admin/staff nebo service_role)
--
-- ⭐ ZADÁNÍ MAJITELE 2026-09-15: autonomní i hromadné kroky musí jít dohledat
--    a z UI vrátit. Rozhodnutí žije v audit_journal (neměnný deník).
--
-- ⛔ OD 2026-09-16 JE TO OBÁLKA, NE DRUHÁ ČTEČKA. Rozhodnutí přibyla i mimo proces
--    (zahození karantény brokeru), a dvě čtečky téhož deníku by se rozešly —
--    jedna by uměla nový druh, druhá ne, a správce by podle toho, kterou obrazovku
--    otevře, viděl jinou pravdu. Implementace je `get_decisions_admin`; tahle
--    funkce jen drží svůj kontrakt a filtruje druh `workflow_decision`.
--
-- Kontrakt (nezměněn): (integer) -> jsonb {items:[{decision_id, akce, kdy, kdo,
--   souhrn, duvod, kriterium, pocty, vraceno:{kdy, kdo, obnoveno}|null, vratne}]}
--   — položka navíc nese `druh` a `oblast` z obecné čtečky.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_workflow_decisions_admin(
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
-- ⛔ ZÁMĚRNĚ BEZ SECURITY DEFINER. Obálka žádná zvýšená práva nepotřebuje: autorizaci
-- dělá `get_decisions_admin` sama za sebe (brána `definer musí autorizovat sám sebe`).
-- Definer, který se spoléhá na volaného, je otevřené dveře ve chvíli, kdy se volaný změní.
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.get_decisions_admin(p_limit, 'workflow_decision');
$function$;

REVOKE ALL ON FUNCTION public.get_workflow_decisions_admin(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workflow_decisions_admin(integer) TO authenticated, service_role;
