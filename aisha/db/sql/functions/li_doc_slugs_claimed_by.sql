-- ============================================================================
-- Source of Truth: li_doc_slugs_claimed_by
-- Popis: Doklady, na které má volající STRUKTURÁLNÍ nárok — „tenhle doklad
--        vezu já". Vrací `doc_slug` kroků procesu, které jsou volajícího
--        (přiřazení, nebo potvrzená vazba účtu na `authorized_twin_id`).
--        Rozhodovač je JEDEN: `workflow_step_visible_to`. Tahle funkce nic
--        nerozhoduje, jen mu dává kroky a sbírá `doc_slug`.
--
-- PROČ FUNKCE, A NE PODDOTAZ V POLITICE (naměřeno 2026-09-10):
--   Politika `li_source_registry_read` (6c65216f4, 2026-09-01) nesla týž
--   poddotaz inline. Jenže výraz politiky se vyhodnocuje pod rolí VOLAJÍCÍHO,
--   a `production_workflow_steps` má jedinou politiku — `is_admin_or_staff`.
--   Pro řidiče (role `authenticated`) proto poddotaz vracel 0 řádků a člen
--   nikdy nic nepustil: řidič svůj doklad neviděl ani po „opravě". Test, který
--   to měl hlídat (`doklad-narok-strukturalni-runtime`), nikdo nespouštěl.
--   Změřeno pod `SET ROLE authenticated` s jwt.claims řidiče:
--     kroky přímo 0 · poddotaz členu 0 · registr 0 · vazba potvrzená 1
--   SECURITY DEFINER čte kroky vlastníkem — a rozsah drží guard níž, ne RLS.
--
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT pattern; volající smí
--   vyhodnocovat JEN SVŮJ nárok (service_role / admin za kohokoliv).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.li_doc_slugs_claimed_by(p_uid uuid)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_twins text[] := '{}';
  v_roles text[] := '{}';
BEGIN
  -- Oracle guard: přihlášený volající smí vyhodnocovat JEN SVŮJ nárok.
  IF p_uid IS NULL
     OR NOT (p_uid = auth.uid() OR public.is_service_role() OR public.is_admin_or_staff()) THEN
    RETURN;
  END IF;

  -- ⛔ VAZBY JEDNOU, NE PER KROK (naměřeno 2026-09-10). Predikát je plpgsql
  -- s dynamickým SQL a stojí ~0,34 ms na volání. Předfiltr `input_data ?
  -- 'authorized_twin_id'` pouštěl ke drahému predikátu KAŽDÝ krok, který ten
  -- klíč má — tedy i cizí. Řidič s JEDINÝM vlastním krokem platil za všechny:
  --     cizích kroků    0 → 10 ms · 1 000 → 309 ms · 5 000 → 1 716 ms
  -- Při stotisících krocích je to desítky sekund na výpis dokladů, a spustí to
  -- kterýkoli přihlášený. Přesně ta DoS páka, před kterou varuje hlavička
  -- `li_source_registry_read`. Vazba je přitom vlastnost VOLAJÍCÍHO, ne kroku,
  -- takže se čte jednou dopředu.
  --
  -- ⚠️ Volitelný subsystém: `twin_external_refs` nemusí být nainstalovaný
  -- (týž důvod pro dynamic SQL jako ve `workflow_step_visible_to`).
  IF to_regclass('public.twin_external_refs') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(array_agg(r.twin_id::text), '{}')
        FROM public.twin_external_refs r
       WHERE r.ref_kind = 'account' AND r.state = 'confirmed'
         AND r.source_key = $1::text
         AND r.valid_from <= now()
         AND (r.valid_to IS NULL OR r.valid_to > now())
    $q$ INTO v_twins USING p_uid;
  END IF;

  -- ⛔ ROLE JEDNOU, NE PER KROK (naměřeno 2026-09-29 na produkci, člen bez role,
  -- 123 237 kroků, 9 495 s `doc_slug`). Tatáž lekce jako u vazeb výš, jen
  -- nedotažená: `has_role(p_uid, s.assigned_role)` se volal pro 6 330 kroků
  -- s rolí — 4 908 ms samotného předfiltru. Role jsou vlastnost VOLAJÍCÍHO;
  -- pole jednou dopředu → 80 ms, výsledek shodný. Guard výš už vynucuje totéž,
  -- co `has_role` (odpovídá jen o volajícím, službě a správě o komkoli), takže
  -- přímé čtení `user_roles` pro `p_uid` nic neprozradí navíc.
  SELECT coalesce(array_agg(ur.role::text), '{}')
    INTO v_roles
    FROM public.user_roles ur
   WHERE ur.user_id = p_uid;

  -- ⛔ PŘEDFILTR MUSÍ BĚŽET PŘED PREDIKÁTEM — a Postgres to nezaručí
  -- (naměřeno 2026-09-29). Podmínky v jednom WHERE řadí planner podle
  -- deklarované COST, ne podle pořadí v textu; predikát má COST 100 a OR
  -- předfiltru vyšel o chlup dráž, takže plán zněl
  --   Filter: (input_data ? 'doc_slug') AND workflow_step_visible_to(…) AND (předfiltr)
  -- a drahý predikát (~0,56 ms) běžel na VŠECH 9 495 krocích s dokladem:
  -- 5,4 s na každé čtení registru běžným uživatelem (politika
  -- `li_source_registry_read` volá tuhle funkci), pro 0 vrácených řádků.
  -- MATERIALIZED CTE je optimalizační plot: predikát dostane JEN kandidáty.
  RETURN QUERY
    WITH kandidati AS MATERIALIZED (
      SELECT s.assigned_user_id, s.assigned_role, s.input_data
        FROM public.production_workflow_steps s
       WHERE s.input_data ? 'doc_slug'
         -- Brána, ne pravidlo: předfiltr je přesně SJEDNOCENÍ větví, na kterých
         -- predikát vrací pravdu (přiřazení · role · potvrzená vazba). Nesmí být
         -- užší, jinak zmizí viditelnost, kterou predikát dává; širší být může,
         -- ale platí se to jeho voláním. Rozhodnutí zůstává na predikátu níž.
         AND (s.assigned_user_id = p_uid
              OR s.input_data->>'authorized_twin_id' = ANY (v_twins)
              OR s.assigned_role = ANY (v_roles))
    )
    SELECT DISTINCT k.input_data->>'doc_slug'
      FROM kandidati k
     WHERE public.workflow_step_visible_to(p_uid, k.assigned_user_id, k.assigned_role, k.input_data);
END;
$$;

REVOKE ALL ON FUNCTION public.li_doc_slugs_claimed_by(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.li_doc_slugs_claimed_by(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.li_doc_slugs_claimed_by(uuid) TO service_role;

COMMENT ON FUNCTION public.li_doc_slugs_claimed_by(uuid) IS
  'Doklady se strukturálním nárokem volajícího (doc_slug kroků, které jsou jeho). Definer: poddotaz pod rolí volajícího narážel na admin-only RLS kroků.';
