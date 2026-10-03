-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS acs_dead_letters_admin_select ON public.acs_dead_letters;
CREATE POLICY acs_dead_letters_admin_select ON public.acs_dead_letters
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
