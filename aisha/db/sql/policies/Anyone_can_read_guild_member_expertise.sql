-- Policy: Anyone can read guild member expertise

CREATE POLICY "Anyone can read guild member expertise" ON public.guild_member_expertise
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
