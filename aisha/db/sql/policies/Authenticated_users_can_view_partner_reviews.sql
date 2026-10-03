-- Policy: Authenticated users can view partner reviews

CREATE POLICY "Authenticated users can view partner reviews" ON public.partner_reviews
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() IS NOT NULL));
