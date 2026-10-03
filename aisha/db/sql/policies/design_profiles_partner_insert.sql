-- Policy: design_profiles_partner_insert
-- Partners can insert their own design profile

CREATE POLICY design_profiles_partner_insert ON public.design_profiles
  FOR INSERT WITH CHECK (
    partner_id IN (SELECT id FROM public.partner_profiles WHERE user_id = auth.uid())
  );
