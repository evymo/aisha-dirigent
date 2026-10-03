-- Policy: Anyone can view active studies

CREATE POLICY "Anyone can view active studies" ON public.studies
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
