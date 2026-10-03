-- Policy: Authenticated users can view active courses

CREATE POLICY "Authenticated users can view active courses" ON public.certification_courses
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((auth.role() = 'authenticated'::text) AND (is_active = true)));
