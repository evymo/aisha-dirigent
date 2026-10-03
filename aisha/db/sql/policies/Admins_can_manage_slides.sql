-- Policy: Admins can manage slides

DROP POLICY IF EXISTS "Admins can manage slides" ON public.course_slides;
CREATE POLICY "Admins can manage slides" ON public.course_slides
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
