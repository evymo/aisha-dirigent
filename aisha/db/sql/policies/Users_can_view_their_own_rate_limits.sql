-- Policy: Users can view their own rate limits

CREATE POLICY "Users can view their own rate limits" ON public.api_rate_limits
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
