-- ============================================================================
-- Source of truth: federated_source_session_logout_due
-- Fronta odhlášení u zdroje (ADR-004, bod 6; revize B3). Nová fronta NEVZNIKÁ:
-- frontou jsou řádky trezoru s `revoked_at` a bez `logout_done_at`. Zpracovává ji
-- plánovač brokeru (scheduler.ts) pod advisory lockem; `FOR UPDATE SKIP LOCKED` je
-- druhá pojistka proti zdvojení mezi replikami.
-- Nejdřív odvolá relace, které odvolat MÁ: prošlé (`expires_at`) a relace
-- uživatelů, kteří v aishe už nejsou (bez cizího klíče — viz tabulka).
-- Vrací šifrový text, protože odhlášení u zdroje potřebuje ten token → audit.
-- `p_providers` = zdroje, které volající broker umí odhlásit (má jejich plugin);
-- relace ostatních zdrojů zůstávají ve frontě a nečtou se (žádný audit naprázdno).
-- JEN servisní role.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.federated_source_session_logout_due(p_providers text[], p_limit integer DEFAULT 20)
RETURNS TABLE (source_session_id uuid, user_id uuid, provider text, token_ct bytea, key_id text, logout_attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  r record;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'AISHA_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  UPDATE public.federated_source_sessions s
     SET revoked_at = now(), revoke_reason = 'vyprsela', logout_next_at = now()
   WHERE s.revoked_at IS NULL AND s.expires_at <= now();

  UPDATE public.federated_source_sessions s
     SET revoked_at = now(), revoke_reason = 'uzivatel_neexistuje', logout_next_at = now()
   WHERE s.revoked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = s.user_id);

  FOR r IN
    SELECT s.id, s.user_id, s.provider, s.token_ct, s.key_id, s.logout_attempts
      FROM public.federated_source_sessions s
     WHERE s.revoked_at IS NOT NULL AND s.logout_done_at IS NULL
       AND s.logout_next_at IS NOT NULL AND s.logout_next_at <= now()
       AND length(s.token_ct) > 0
       AND s.provider = ANY (coalesce(p_providers, ARRAY[]::text[]))
     ORDER BY s.logout_next_at
     LIMIT greatest(coalesce(p_limit, 20), 1)
     FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, entity_type, entity_id, metadata)
    VALUES ((SELECT u.id FROM aisha_auth.users u WHERE u.id = r.user_id), 'federace.odhlaseni_cteno', 'federace.odhlaseni_cteno', 'security', 'info',
            'federated_source_session', r.id::text, jsonb_build_object('provider', r.provider, 'pokus', r.logout_attempts + 1, 'uzivatel', r.user_id));
    source_session_id := r.id; user_id := r.user_id; provider := r.provider;
    token_ct := r.token_ct; key_id := r.key_id; logout_attempts := r.logout_attempts;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.federated_source_session_logout_due(text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.federated_source_session_logout_due(text[], integer) TO service_role;
