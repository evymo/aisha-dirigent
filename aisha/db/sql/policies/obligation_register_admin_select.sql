-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS obligation_register_admin_select ON public.obligation_register;
CREATE POLICY obligation_register_admin_select ON public.obligation_register
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
