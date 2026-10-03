-- ============================================================================
-- Source of Truth: twin_ensure_for_account
-- Popis: Zajistí, že účet (aisha_auth.users.id) má DVOJČE — entitu jádra — a
--        POTVRZENOU referenci ref_kind='account'. ADR-003, program K1.
--        Idempotentní mint-or-match: existující aktivní potvrzená reference
--        účtu vyhrává; jinak se dvojče založí (nebo se použije p_twin_id) a
--        reference účtu se potvrdí SYSTÉMEM (confirmed_by NULL — táž konvence
--        jako primary_id vlastního zdroje v twin_upsert_entity_audited).
--
-- PROČ: audience modul byl klíčovaný na účet (profiles.user_id). Kolega bez
-- účtu, firma ani kontaktní osoba klienta se tak nedaly vyjádřit — dva světy
-- vedle sebe. Od teď je identita dvojče a účet je jedna z jeho referencí.
--
-- PROČ potvrzeno systémem a ne review: reference účtu je dokázaná přihlášením.
-- Cross-source reference (CRM export, pošta) tudy NEJDOU — ty navrhuje
-- twin_identity_propose_binding a potvrzuje člověk (Z2: fakt jen potvrzením).
--
-- KONFLIKT: má-li účet už potvrzené dvojče a volající nabídne jiné p_twin_id,
-- nic se nepřepisuje — na p_twin_id vznikne NÁVRH vazby k review a vrací se
-- dosavadní dvojče. Import nikdy nepřepisuje potvrzené (kontrakt tabulky).
--
-- AUTORIZACE váže SUBJEKT (Z6): služba a operátoři kterýkoli účet, člověk jen
-- svůj. Cizí účet = 42501, ne tiché NULL (existence účtu se neprozrazuje
-- jinak než odmítnutím, které je stejné pro neexistující i cizí).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_ensure_for_account(
  p_user_id     uuid,
  p_label       text DEFAULT NULL,
  p_entity_type text DEFAULT 'person',
  p_twin_id     uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_is_service boolean := public.is_service_role();
  v_caller     uuid    := auth.uid();
  v_twin       uuid;
  v_label      text;
  v_type       text    := COALESCE(nullif(btrim(p_entity_type), ''), 'person');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_is_service OR public.is_admin_or_staff() OR p_user_id = v_caller) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  -- 1. existující potvrzená aktivní reference účtu vyhrává (mint-or-match)
  SELECT r.twin_id INTO v_twin
  FROM public.twin_external_refs r
  WHERE r.ref_kind = 'account'
    AND r.source_key = p_user_id::text
    AND r.state = 'confirmed'
    AND r.valid_to IS NULL
  ORDER BY r.confirmed_at DESC NULLS LAST
  LIMIT 1;

  IF v_twin IS NOT NULL THEN
    IF p_twin_id IS NOT NULL AND p_twin_id <> v_twin THEN
      -- Jiné dvojče chce tentýž účet: návrh k review, nikdy přepis. Vedlejší
      -- účinek nesmí zničit akt (Z7) — selhání návrhu se jen zaznamená.
      BEGIN
        PERFORM public.twin_identity_propose_binding(
          p_twin_id, 'aisha_auth', p_user_id::text, 'account',
          'twin_ensure_for_account', 0.5, 'account already bound to another twin');
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'twin_ensure_for_account: conflicting binding not proposed (%)', SQLERRM;
      END;
    END IF;
    RETURN v_twin;
  END IF;

  -- 2. štítek: z volání, jinak z profilu (jméno, nakonec e-mail)
  SELECT COALESCE(p_label, nullif(btrim(p.display_name), ''), p.email)
    INTO v_label
  FROM public.profiles p
  WHERE p.user_id = p_user_id;
  v_label := COALESCE(v_label, p_label);

  -- 3. dvojče: dané volajícím, nebo nově ražené s primární identitou účtu
  IF p_twin_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.twin_entities t WHERE t.id = p_twin_id) THEN
      RAISE EXCEPTION 'twin % not found', p_twin_id USING ERRCODE = '22023';
    END IF;
    v_twin := p_twin_id;
  ELSE
    INSERT INTO public.twin_entities (entity_type, label, status, metadata)
    VALUES (v_type, v_label, 'active', '{}'::jsonb)
    RETURNING id INTO v_twin;

    INSERT INTO public.twin_external_refs
      (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_by, confirmed_at)
    VALUES
      (v_twin, 'aisha_auth', p_user_id::text, 'primary_id', 'confirmed', 'account', NULL, now());
  END IF;

  -- 4. reference účtu — potvrzená systémem (dokázaná přihlášením)
  INSERT INTO public.twin_external_refs
    (twin_id, source, source_key, ref_kind, state, proposed_by, confirmed_by, confirmed_at)
  VALUES
    (v_twin, 'aisha_auth', p_user_id::text, 'account', 'confirmed', 'account', NULL, now());

  -- Audit bez PII: jen id a druh.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_caller, 'twin_entities.ensure_for_account',
          jsonb_build_object('twin_id', v_twin, 'entity_type', v_type,
                             'minted', p_twin_id IS NULL));
  RETURN v_twin;
END;
$$;

REVOKE ALL ON FUNCTION public.twin_ensure_for_account(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_ensure_for_account(uuid, text, text, uuid) TO authenticated, service_role;
