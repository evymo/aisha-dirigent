-- Policy: Users can manage their own credentials

CREATE POLICY "Users can manage their own credentials" ON public.production_credentials
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((user_id = auth.uid()));
