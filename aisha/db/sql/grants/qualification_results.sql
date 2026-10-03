-- Grants: qualification_results
--
-- Evidence table: written ONLY by assign_member_role_after_qualification
-- (SECURITY DEFINER, runs as owner). Clients get SELECT-own only — no INSERT/UPDATE/
-- DELETE — so a passing result can never be self-asserted (is_qualified trusts this).
GRANT SELECT ON public.qualification_results TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.qualification_results TO service_role;
