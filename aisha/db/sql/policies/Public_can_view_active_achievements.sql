-- Policy: Public can view active achievements

CREATE POLICY "Public can view active achievements" ON public.achievements
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
