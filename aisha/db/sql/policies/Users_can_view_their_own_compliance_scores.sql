-- Policy: Users can view their own compliance scores

CREATE POLICY "Users can view their own compliance scores" ON public.member_compliance_scores
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((member_token = auth.uid()));
