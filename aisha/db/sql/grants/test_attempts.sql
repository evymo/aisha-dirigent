-- Grants: test_attempts
--
-- Attempt rows are evidence: created/graded ONLY by start_test_attempt /
-- submit_test_attempt (SECURITY DEFINER, run as owner). Clients get SELECT-own only —
-- no INSERT/UPDATE/DELETE — so a passing attempt can never be self-asserted directly.
GRANT SELECT ON public.test_attempts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.test_attempts TO service_role;
