-- Policy: Anyone can read question blocks

CREATE POLICY "Anyone can read question blocks" ON public.question_blocks
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
