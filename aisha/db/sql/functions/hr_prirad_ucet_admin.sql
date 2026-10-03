-- ============================================================================
-- Source of Truth: hr_prirad_ucet_admin
-- Popis: HR přiřadí ÚČET k OSOBĚ (twinu) — jedním krokem, atomicky.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; jen admin/staff S REÁLNOU
--             identitou (lidské rozhodnutí; service_role NE — import navrhuje,
--             člověk potvrzuje)
-- Audit: twin_external_refs.confirmed (píše twin_identity_confirm_binding)
--
-- ⭐ ZADÁNÍ MAJITELE (2026-09-23): obrazovka HR, „účty v KC propojujeme
-- s entitami z twinverse".
--
-- ⛔ ŽÁDNÁ NOVÁ CESTA K ZÁPISU VAZBY. Jen složí dvě existující:
--   twin_identity_propose_binding  → návrh (idempotentní, vrací ref_id)
--   twin_identity_confirm_binding  → lidská ratifikace (confirmed_by = HR)
-- Obě v JEDNÉ transakci: nikdy nezůstane „navrženo, ale nepotvrzeno" jen
-- proto, že druhé volání z prohlížeče nedoběhlo.
--
-- ⭐ ÚČET SMÍ PŘEJÍT K JINÉ OSOBĚ (p_supersede = true na straně ÚČTU): účet
-- navázaný třeba na automaticky založenou osobu (twin_ensure_for_account)
-- se přepojí na řidiče; staré vazbě skončí platnost (valid_to), historie
-- zůstane. Předchozí osoba se vrátí, aby ji UI ukázalo.
--
-- ⛔ OSOBU, KTERÁ UŽ MÁ JINÝ ÚČET, NEPŘEBÍRÁ. „Jeden twin = jeden účet" hlídá
-- uq_twin_external_refs_active_account_twin a důvod je bezpečnostní: přebývající
-- přístup nikdo nenahlásí. Tady se to řekne SROZUMITELNĚ dřív, než by index
-- odpověděl unique_violation — správce musí nejdřív vědomě odvázat ten druhý
-- účet (hr_odvaz_ucet_admin).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.hr_prirad_ucet_admin(
  p_user_id uuid,
  p_twin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hr uuid := auth.uid();
  v_jiny_ucet text;
  v_predchozi uuid;
  v_navrh jsonb;
  v_potvrzeni jsonb;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required';
  END IF;
  IF v_hr IS NULL THEN
    RAISE EXCEPTION 'Assignment requires an authenticated person (auth.uid() is null)';
  END IF;
  IF p_user_id IS NULL OR p_twin_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_twin_id are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id) THEN
    RAISE EXCEPTION 'account % not found (has it signed in at least once?)', p_user_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.twin_entities t WHERE t.id = p_twin_id AND t.status = 'active') THEN
    RAISE EXCEPTION 'person % not found or not active', p_twin_id;
  END IF;

  -- Osoba už má JINÝ účet → stop (viz hlavička).
  SELECT r.source_key INTO v_jiny_ucet
    FROM public.twin_external_refs r
   WHERE r.twin_id = p_twin_id
     AND r.ref_kind = 'account'
     AND r.state = 'confirmed'
     AND r.valid_to IS NULL
     AND r.source_key <> p_user_id::text
   LIMIT 1;
  IF v_jiny_ucet IS NOT NULL THEN
    RAISE EXCEPTION 'person_has_other_account'
      USING DETAIL = 'Person already bound to another account; unbind it first.',
            HINT = v_jiny_ucet;
  END IF;

  -- Kde je účet navázaný teď (UI ukáže „přesunuto z …").
  SELECT r.twin_id INTO v_predchozi
    FROM public.twin_external_refs r
   WHERE r.ref_kind = 'account'
     AND r.source_key = p_user_id::text
     AND r.state = 'confirmed'
     AND r.valid_to IS NULL
   LIMIT 1;

  v_navrh := public.twin_identity_propose_binding(
    p_twin_id, 'aisha_auth', p_user_id::text, 'account',
    'hr:' || v_hr::text, 1.0, 'HR: přiřazení účtu k osobě');

  IF v_navrh->>'state' = 'confirmed' THEN
    -- Účet už je na TÉTO osobě — nic se nemění.
    RETURN jsonb_build_object('ref_id', v_navrh->>'ref_id', 'already', true,
                              'predchozi_twin_id', NULL);
  END IF;

  v_potvrzeni := public.twin_identity_confirm_binding((v_navrh->>'ref_id')::uuid, true);

  RETURN jsonb_build_object(
    'ref_id', v_potvrzeni->>'ref_id',
    'already', false,
    'superseded_ref_id', v_potvrzeni->>'superseded_ref_id',
    'predchozi_twin_id', CASE WHEN v_predchozi = p_twin_id THEN NULL ELSE v_predchozi END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_prirad_ucet_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_prirad_ucet_admin(uuid, uuid) TO authenticated;
