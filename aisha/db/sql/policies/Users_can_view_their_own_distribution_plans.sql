-- Policy: Users can view their own distribution plans

CREATE POLICY "Users can view their own distribution plans" ON public.member_distribution_plans
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
