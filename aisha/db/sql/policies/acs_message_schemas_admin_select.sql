-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS acs_message_schemas_admin_select ON public.acs_message_schemas;
CREATE POLICY acs_message_schemas_admin_select ON public.acs_message_schemas
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
