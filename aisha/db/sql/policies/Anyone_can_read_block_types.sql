-- Policy: Anyone can read block types

CREATE POLICY "Anyone can read block types" ON public.question_block_types
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
