-- Policy: Anyone can view hero slides

CREATE POLICY "Anyone can view hero slides" ON public.hero_slides
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
