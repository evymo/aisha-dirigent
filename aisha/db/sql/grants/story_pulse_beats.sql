-- Grants: story_pulse_beats
--
-- Explicit REVOKE first, on purpose. fix_missing_table_grants.sql carries both
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE,
-- DELETE ON TABLES TO authenticated` and a loop that re-grants every table in
-- public, so a new table silently inherits full DML for authenticated on the
-- cold-start path. "We simply never granted it" is not a control here — only a
-- REVOKE that runs after those statements is.
--
-- Writes go exclusively through the SECURITY DEFINER RPCs
-- (create_pulse_beat_audited / close_pulse_beat_audited), which is what keeps
-- the subject-side authorization and the audit trail unavoidable. authenticated
-- therefore gets SELECT only, RLS-scoped to "beats I owe or beats my own twin
-- carries".
REVOKE ALL ON public.story_pulse_beats FROM PUBLIC;
REVOKE ALL ON public.story_pulse_beats FROM anon;
REVOKE ALL ON public.story_pulse_beats FROM authenticated;

GRANT SELECT ON public.story_pulse_beats TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.story_pulse_beats TO service_role;
