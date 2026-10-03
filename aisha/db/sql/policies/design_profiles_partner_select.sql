-- Policy: design_profiles_partner_select
-- Partners can read their own design profile

CREATE POLICY design_profiles_partner_select ON public.design_profiles
  FOR SELECT USING (
    partner_id IN (SELECT id FROM public.partner_profiles WHERE user_id = auth.uid())
  );
