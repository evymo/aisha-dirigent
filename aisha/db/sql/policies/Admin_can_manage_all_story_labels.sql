-- Policy: Admin can manage all story labels

DROP POLICY IF EXISTS "Admin can manage all story labels" ON public.story_labels;
CREATE POLICY "Admin can manage all story labels" ON public.story_labels
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
