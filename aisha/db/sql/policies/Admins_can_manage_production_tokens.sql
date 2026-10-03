-- Policy: Admins can manage production tokens

DROP POLICY IF EXISTS "Admins can manage production tokens" ON public.production_tokens;
CREATE POLICY "Admins can manage production tokens" ON public.production_tokens
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
