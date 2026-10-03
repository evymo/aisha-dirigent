-- Policy: Reviewers can manage own reviews

CREATE POLICY "Reviewers can manage own reviews" ON public.partner_appointment_reviews
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = reviewer_id));
