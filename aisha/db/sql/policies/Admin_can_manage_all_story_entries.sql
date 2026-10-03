-- Policy: Admin can manage all story entries

DROP POLICY IF EXISTS "Admin can manage all story entries" ON public.story_entries;
CREATE POLICY "Admin can manage all story entries" ON public.story_entries
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
