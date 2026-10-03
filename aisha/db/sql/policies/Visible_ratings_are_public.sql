-- Policy: Visible ratings are public

CREATE POLICY "Visible ratings are public" ON public.study_ratings
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_visible = true));
