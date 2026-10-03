-- ============================================================================
-- Source of Truth: get_decisions_admin
-- Popis: Přehled ROZHODNUTÍ napříč oblastmi (proces, doprava balíčků, …) — kdo,
--        kdy, proč, kolik, a jestli už bylo vráceno. Podklad obrazovky správce
--        „Rozhodnutí a automatika": dohledat → vrátit.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff nebo service_role)
--
-- ⭐ ZADÁNÍ MAJITELE 2026-09-15: autonomní i hromadné kroky musí jít dohledat
--    a z UI vrátit. Rozhodnutí žije v audit_journal (neměnný deník).
--
-- ⛔ JEDEN ČTENÁŘ PRO VŠECHNY DRUHY. Do 2026-09-16 uměl přehled jen rozhodnutí
--    nad procesem, takže zahození karantény brokeru by v UI nebylo vidět a vzniklo
--    by druhé okno do téhož deníku. Druh se FILTRUJE parametrem; sourozenec
--    `get_workflow_decisions_admin` je tenká obálka nad tímhle (jedna implementace,
--    žádný rozchod dvou čteček).
--
-- ⭐ VRÁCENÍ SE POZNÁ KONVENCÍ JMÉNA AKCE (obsahuje `revert`), ne výčtem typů:
--    výčet by byl druhý domov pravdy a při třetím druhu rozhodnutí by se rozešel.
--
-- ⛔ SEZNAM ZÁZNAMŮ SE NEVRACÍ (stovky UUID / id balíčků) — ten patří vrácení,
--    které ho čte z rozhodnutí. Přehled nese jen počty.
--
-- Kontrakt: (integer, text) -> jsonb {items:[{decision_id, druh, oblast, akce, kdy,
--   kdo, souhrn, duvod, kriterium, pocty, vratne, vraceno:{kdy,kdo,obnoveno,duvod}|null}]}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_decisions_admin(
  p_limit integer DEFAULT 50,
  p_druh  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_items jsonb;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff(auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff or service_role required';
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'kdy' DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT jsonb_build_object(
             'decision_id', d.id,
             'druh', d.entity_type,
             'oblast', d.area,
             'akce', d.action,
             'kdy', d.created_at,
             'kdo', d.user_id,
             'souhrn', d.summary,
             'duvod', d.details->>'duvod',
             'kriterium', d.details->'kriterium',
             -- Starší rozhodnutí nesou počty jako samostatné klíče; novější mají
             -- `pocty`. Čtenář obojí sjednotí, aby se historie nemusela přepisovat.
             'pocty', coalesce(d.details->'pocty',
                               jsonb_strip_nulls(jsonb_build_object(
                                 'behu', d.details->'behu', 'uzlu', d.details->'uzlu',
                                 'taktu', d.details->'taktu'))),
             'vratne', coalesce((d.details->>'vratne')::boolean, false) AND r.id IS NULL,
             'vraceno', CASE WHEN r.id IS NULL THEN NULL
                        ELSE jsonb_build_object('kdy', r.created_at, 'kdo', r.user_id,
                                                'obnoveno', r.details->'obnoveno',
                                                'duvod', r.details->>'duvod') END
           ) AS x
      FROM public.audit_journal d
      LEFT JOIN public.audit_journal r
             ON r.entity_id = d.id::text AND r.action LIKE '%revert%'
     WHERE d.entity_type LIKE '%_decision'
       AND (p_druh IS NULL OR d.entity_type = p_druh)
       -- Vrácení je také řádek deníku, ale není to rozhodnutí k vrácení.
       AND d.action NOT LIKE '%revert%'
     ORDER BY d.created_at DESC
     LIMIT GREATEST(1, LEAST(coalesce(p_limit, 50), 500))
  ) s;

  RETURN jsonb_build_object('items', v_items);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_decisions_admin(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_decisions_admin(integer, text) TO authenticated, service_role;
