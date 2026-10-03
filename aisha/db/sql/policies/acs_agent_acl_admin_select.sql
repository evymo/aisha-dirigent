-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS acs_agent_acl_admin_select ON public.acs_agent_acl;
CREATE POLICY acs_agent_acl_admin_select ON public.acs_agent_acl
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
