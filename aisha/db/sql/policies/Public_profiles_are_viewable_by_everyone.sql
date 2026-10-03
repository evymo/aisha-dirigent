-- Policy: Public profiles are viewable by everyone

CREATE POLICY "Public profiles are viewable by everyone" ON public.partner_profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_visible = true));
