-- Policy: Users can update own progress

CREATE POLICY "Users can update own progress" ON public.user_course_progress
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = user_id));
