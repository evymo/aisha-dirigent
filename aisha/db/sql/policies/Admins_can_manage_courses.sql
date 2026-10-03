-- Policy: Admins can manage courses

DROP POLICY IF EXISTS "Admins can manage courses" ON public.certification_courses;
CREATE POLICY "Admins can manage courses" ON public.certification_courses
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
