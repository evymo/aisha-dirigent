-- Policy: Anyone can view archive tags

CREATE POLICY "Anyone can view archive tags" ON public.archive_tags
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
