-- Policy: Users can create rooms

CREATE POLICY "Users can create rooms" ON public.voice_rooms
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = created_by));
