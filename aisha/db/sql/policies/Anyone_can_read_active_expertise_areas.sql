-- Policy: Anyone can read active expertise areas

CREATE POLICY "Anyone can read active expertise areas" ON public.guild_expertise_areas
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
