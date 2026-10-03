-- ============================================================================
-- Source of truth: federated_source_session_logout_result
-- Výsledek odhlášení u zdroje (ADR-004, bod 6).
--   'hotovo'        — zdroj token zneplatnil → logout_done_at, šifrový text se MAŽE;
--   'nepodporovano' — zdroj odhlášení neumí (povoleno jen zdrojům s expirací tokenů,
--                     hlídá registrace pluginu) → totéž + audit;
--   'selhalo'       — síť / 5xx: pokus +1, další za 2^pokus minut (strop 6 h);
--                     od 10. pokusu audit „ruční zásah" (warning) a fronta pokračuje.
-- JEN servisní role.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.federated_source_session_logout_result(p_session_id uuid, p_vysledek text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_user uuid;
  v_provider text;
  v_pokus integer;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  IF p_vysledek NOT IN ('hotovo', 'nepodporovano', 'selhalo') THEN
    RAISE EXCEPTION 'FEDERATED_LOGOUT_RESULT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_vysledek IN ('hotovo', 'nepodporovano') THEN
    UPDATE public.federated_source_sessions s
       SET logout_done_at = now(), logout_next_at = NULL, token_ct = '\x'::bytea, refresh_ct = NULL
     WHERE s.id = p_session_id AND s.revoked_at IS NOT NULL AND s.logout_done_at IS NULL
    RETURNING s.user_id, s.provider INTO v_user, v_provider;
    IF v_user IS NOT NULL THEN
      INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, entity_type, entity_id, metadata)
      VALUES ((SELECT u.id FROM aisha_auth.users u WHERE u.id = v_user), 'federace.odhlaseno_u_zdroje', 'federace.odhlaseno_u_zdroje', 'security',
              CASE WHEN p_vysledek = 'hotovo' THEN 'info' ELSE 'warning' END,
              'federated_source_session', p_session_id::text,
              jsonb_build_object('provider', v_provider, 'vysledek', p_vysledek, 'uzivatel', v_user));
    END IF;
    RETURN;
  END IF;
  UPDATE public.federated_source_sessions s
     SET logout_attempts = s.logout_attempts + 1,
         logout_next_at = now() + least(power(2, s.logout_attempts + 1) * interval '1 minute', interval '6 hours')
   WHERE s.id = p_session_id AND s.revoked_at IS NOT NULL AND s.logout_done_at IS NULL
  RETURNING s.user_id, s.provider, s.logout_attempts INTO v_user, v_provider, v_pokus;
  IF v_user IS NOT NULL THEN
    INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, entity_type, entity_id, metadata)
    VALUES ((SELECT u.id FROM aisha_auth.users u WHERE u.id = v_user),
            CASE WHEN v_pokus >= 10 THEN 'federace.odhlaseni_rucni_zasah' ELSE 'federace.odhlaseni_neprobehlo' END,
            'federace.odhlaseni_neprobehlo', 'security', CASE WHEN v_pokus >= 10 THEN 'warning' ELSE 'info' END,
            'federated_source_session', p_session_id::text,
            jsonb_build_object('provider', v_provider, 'pokus', v_pokus, 'uzivatel', v_user));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.federated_source_session_logout_result(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.federated_source_session_logout_result(uuid, text) TO service_role;
