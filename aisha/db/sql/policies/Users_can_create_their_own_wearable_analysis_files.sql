-- Policy: Users can create their own wearable analysis files

CREATE POLICY "Users can create their own wearable analysis files" ON public.wearable_analysis_files
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
