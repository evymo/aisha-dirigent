-- Policy: design_profiles_partner_update
-- Partners can update their own design profile

CREATE POLICY design_profiles_partner_update ON public.design_profiles
  FOR UPDATE USING (
    partner_id IN (SELECT id FROM public.partner_profiles WHERE user_id = auth.uid())
  );
