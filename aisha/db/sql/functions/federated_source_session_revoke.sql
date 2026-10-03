-- ============================================================================
-- Source of truth: federated_source_session_revoke
-- Odvolá aktivní relaci uživatele u zdroje (ADR-004, bod 6).
-- Smí: servisní role (broker: odpojení, 401 bez refresh), SÁM uživatel pro SVOU
-- relaci (kontrola subjektu, revize S5) a admin/staff výslovně. Cizí relaci běžný
-- uživatel neodvolá. `revoked_at` se nastaví vždy; token jde do fronty odhlášení
-- u zdroje (bez expirace by jinak platil navždy — revize B3).
-- Vrací počet odvolaných relací (0 nebo 1).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.federated_source_session_revoke(p_user_id uuid, p_provider text, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR coalesce(btrim(p_provider), '') = '' THEN
    RAISE EXCEPTION 'FEDERATED_SESSION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT (public.is_service_role()
          OR p_user_id IS NOT DISTINCT FROM auth.uid()
          OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;
  UPDATE public.federated_source_sessions s
     SET revoked_at = now(),
         revoke_reason = coalesce(nullif(btrim(p_reason), ''), 'odvolana'),
         logout_next_at = now()
   WHERE s.user_id = p_user_id AND s.provider = p_provider AND s.revoked_at IS NULL
  RETURNING s.id INTO v_id;
  IF v_id IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, entity_type, entity_id, metadata)
  VALUES ((SELECT u.id FROM aisha_auth.users u WHERE u.id = coalesce(auth.uid(), p_user_id)), 'federace.relace_odvolana', 'federace.relace_odvolana', 'security', 'info',
          'federated_source_session', v_id::text,
          jsonb_build_object('provider', p_provider, 'duvod', coalesce(nullif(btrim(p_reason), ''), 'odvolana'),
                             'pro_uzivatele', p_user_id));
  RETURN 1;
END;
$$;
REVOKE ALL ON FUNCTION public.federated_source_session_revoke(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.federated_source_session_revoke(uuid, text, text) TO authenticated, service_role;
