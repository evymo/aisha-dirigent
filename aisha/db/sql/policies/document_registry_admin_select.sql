-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS document_registry_admin_select ON public.document_registry;
CREATE POLICY document_registry_admin_select ON public.document_registry
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
