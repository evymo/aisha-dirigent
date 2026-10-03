DROP POLICY IF EXISTS aitg_waivers_read_admin ON public.aitg_waivers;
CREATE POLICY aitg_waivers_read_admin ON public.aitg_waivers
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
