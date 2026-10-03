-- Policy: Members can view own stories

CREATE POLICY "Members can view own stories" ON public.partner_stories
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
