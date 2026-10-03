-- Policy: Users can view their own wearable analysis files

CREATE POLICY "Users can view their own wearable analysis files" ON public.wearable_analysis_files
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
