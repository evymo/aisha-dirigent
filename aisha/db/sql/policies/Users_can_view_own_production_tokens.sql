-- Policy: Users can view own production tokens

CREATE POLICY "Users can view own production tokens" ON public.production_tokens
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
