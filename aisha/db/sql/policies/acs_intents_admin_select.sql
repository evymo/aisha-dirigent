-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS acs_intents_admin_select ON public.acs_intents;
CREATE POLICY acs_intents_admin_select ON public.acs_intents
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
