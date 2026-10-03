-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS acs_pending_effects_admin_select ON public.acs_pending_effects;
CREATE POLICY acs_pending_effects_admin_select ON public.acs_pending_effects
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
