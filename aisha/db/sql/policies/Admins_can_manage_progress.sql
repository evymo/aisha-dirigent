-- Policy: Admins can manage progress

DROP POLICY IF EXISTS "Admins can manage progress" ON public.user_course_progress;
CREATE POLICY "Admins can manage progress" ON public.user_course_progress
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
