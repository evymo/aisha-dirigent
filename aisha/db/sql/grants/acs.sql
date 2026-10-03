-- Grants: ACS core tables — SELECT je service_role + admin/staff přes RLS (is_admin_or_staff),
-- NE PUBLIC. Původní migrace (20260708131000_acs_grants_seed.sql) dělala
-- GRANT SELECT ... TO PUBLIC, což otevíralo cross-tenant čtení inter-agent provozu
-- (acs_message_log payloady, kanonické intents, ACL matice). RLS policies
-- (rls/ + policies/acs_*_service_all + acs_*_admin_select) omezují čtení na
-- service_role a admin/staff. Anon floor dle #566 — anon nemá nic.
REVOKE ALL ON public.acs_intents, public.acs_message_schemas, public.acs_message_log,
              public.acs_dead_letters, public.acs_pending_effects, public.acs_agent_acl FROM PUBLIC;
REVOKE ALL ON public.acs_intents, public.acs_message_schemas, public.acs_message_log,
              public.acs_dead_letters, public.acs_pending_effects, public.acs_agent_acl FROM anon;

GRANT SELECT ON public.acs_intents, public.acs_message_schemas, public.acs_message_log,
                public.acs_dead_letters, public.acs_pending_effects, public.acs_agent_acl TO authenticated;

GRANT ALL ON public.acs_intents, public.acs_message_schemas, public.acs_message_log,
             public.acs_dead_letters, public.acs_pending_effects, public.acs_agent_acl TO service_role;

-- Definer functions: EXECUTE only for service_role (belt) + in-body
-- is_service_role() guard (braces) — per check-definer-rpc-security gate.
REVOKE ALL ON FUNCTION acs_create_intent(text, jsonb, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION acs_ingest_message(jsonb, text)                        FROM PUBLIC;
REVOKE ALL ON FUNCTION acs_effect_propose(jsonb)                              FROM PUBLIC;
REVOKE ALL ON FUNCTION acs_effect_decide(text, jsonb)                         FROM PUBLIC;
REVOKE ALL ON FUNCTION acs_effect_mark_executed(text)                         FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acs_create_intent(text, jsonb, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION acs_ingest_message(jsonb, text)                        TO service_role;
GRANT EXECUTE ON FUNCTION acs_effect_propose(jsonb)                              TO service_role;
GRANT EXECUTE ON FUNCTION acs_effect_decide(text, jsonb)                         TO service_role;
GRANT EXECUTE ON FUNCTION acs_effect_mark_executed(text)                         TO service_role;
-- acs_check_acl grant (REVOKE PUBLIC + GRANT authenticated,service_role) lives
-- in its own function file (aisha/db/sql/functions/acs_check_acl.sql) — least
-- privilege, not PUBLIC.
