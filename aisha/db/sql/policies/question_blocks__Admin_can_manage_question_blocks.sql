-- Policy: Admin can manage question blocks

DROP POLICY IF EXISTS "Admin can manage question blocks" ON public.question_blocks;
CREATE POLICY "Admin can manage question blocks" ON public.question_blocks
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
