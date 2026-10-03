-- ============================================================================
-- Source of Truth: hr_ucty_admin
-- Popis: Účty platformy a OSOBA (twin), na kterou je každý navázaný — druhá
--        půlka HR obrazovky „Lidé a účty" (první je twin_accounts_missing:
--        osoby bez účtu).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; jen admin/staff nebo service_role (PII)
--
-- ⭐ ZADÁNÍ MAJITELE (2026-09-23): „obrazovka speciálně pro HR, kdy účty v KC
-- propojujeme s entitami z twinverse".
--
-- ⛔ ÚČET = ŘÁDEK V `profiles`, tedy účet, který se aspoň JEDNOU přihlásil.
-- Keycloak zná i účty, které se nikdy nepřihlásily — ty tu nejsou, protože
-- vazba se váže na `sub`, a ten platforma zná až od prvního přihlášení. Stejně
-- jako stránka Role. UI to řekne, místo aby účet tiše chyběl.
--
-- ⛔ ODVOZENÉ, NE ULOŽENÉ: „osoba účtu" je potvrzená a platná `account` vazba
-- (táž podmínka jako workflow_step_visible_to a twin_for_account). Žádný sloupec
-- navíc, který by se s vazbami rozešel.
--
-- Hledání ve jméně, e-mailu i jménu navázané osoby; `limitovano` jako
-- u twin_accounts_missing („našlo se 200" ≠ „našlo se všech 200").
-- ============================================================================
CREATE OR REPLACE FUNCTION public.hr_ucty_admin(
  p_hledat text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_items jsonb;
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
  v_limitovano boolean := false;
  v_vzor text := CASE WHEN p_hledat IS NULL OR btrim(p_hledat) = '' THEN NULL
                      ELSE '%' || replace(replace(replace(btrim(p_hledat), '\', '\\'), '%', '\%'), '_', '\_') || '%'
                 END;
BEGIN
  IF NOT ((SELECT public.is_service_role()) OR (SELECT public.is_admin_or_staff())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'jmeno_razeni'), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT jsonb_build_object(
             'user_id', p.user_id,
             'email', p.email,
             'jmeno', COALESCE(NULLIF(btrim(p.display_name), ''),
                               NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')),
             'jmeno_razeni', lower(COALESCE(NULLIF(btrim(p.display_name), ''), p.email, p.user_id::text)),
             'vytvoreno', p.created_at,
             'osoba', (SELECT jsonb_build_object(
                                'ref_id', r.id,
                                'twin_id', t.id,
                                'label', t.label,
                                'entity_type', t.entity_type,
                                'od', r.valid_from)
                         FROM public.twin_external_refs r
                         JOIN public.twin_entities t ON t.id = r.twin_id
                        WHERE r.ref_kind = 'account'
                          AND r.source_key = p.user_id::text
                          AND r.state = 'confirmed'
                          AND r.valid_from <= now()
                          AND (r.valid_to IS NULL OR r.valid_to > now())
                        LIMIT 1)
           ) AS x
      FROM public.profiles p
     WHERE p.user_id IS NOT NULL
       AND (v_vzor IS NULL
            OR p.email ILIKE v_vzor
            OR p.display_name ILIKE v_vzor
            OR concat_ws(' ', p.first_name, p.last_name) ILIKE v_vzor
            OR EXISTS (SELECT 1
                         FROM public.twin_external_refs r
                         JOIN public.twin_entities t ON t.id = r.twin_id
                        WHERE r.ref_kind = 'account'
                          AND r.source_key = p.user_id::text
                          AND r.state = 'confirmed'
                          AND (r.valid_to IS NULL OR r.valid_to > now())
                          AND t.label ILIKE v_vzor))
     ORDER BY lower(COALESCE(NULLIF(btrim(p.display_name), ''), p.email, p.user_id::text))
     LIMIT v_limit + 1
  ) s;

  IF jsonb_array_length(v_items) > v_limit THEN
    v_items := v_items - v_limit;
    v_limitovano := true;
  END IF;

  RETURN jsonb_build_object('items', v_items, 'count', jsonb_array_length(v_items),
                            'limitovano', v_limitovano);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_ucty_admin(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_ucty_admin(text, integer) TO authenticated, service_role;
