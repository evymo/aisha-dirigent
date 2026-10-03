-- Policy: Admin can manage block types

DROP POLICY IF EXISTS "Admin can manage block types" ON public.question_block_types;
CREATE POLICY "Admin can manage block types" ON public.question_block_types
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
