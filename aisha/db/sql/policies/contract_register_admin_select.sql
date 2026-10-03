-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS contract_register_admin_select ON public.contract_register;
CREATE POLICY contract_register_admin_select ON public.contract_register
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
