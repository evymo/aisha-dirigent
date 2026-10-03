-- Grants: audience_broker_sync_state

-- SEC-F4b (20260610180000): anon gets NO grant on this audience broker relation
-- (it had no SELECT; the DELETE/INSERT/UPDATE over-grant is removed). Combined with
-- the audience%/cohort exclusion in fix_missing_table_grants.sql, anon ends with
-- zero privileges here — satisfying invariant I3 in audience_audit_grants().
-- authenticated retains DML (RLS-scoped); the broker writes via its dedicated role.
GRANT DELETE, INSERT, SELECT, UPDATE ON public.audience_broker_sync_state TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.audience_broker_sync_state TO service_role;
