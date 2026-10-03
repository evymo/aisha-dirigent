-- Policy: Authenticated users can view slides

CREATE POLICY "Authenticated users can view slides" ON public.course_slides
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
