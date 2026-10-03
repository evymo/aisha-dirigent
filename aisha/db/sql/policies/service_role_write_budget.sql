-- Policy: service_role_write_budget

CREATE POLICY "service_role_write_budget" ON public.ai_budget
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((get_jwt_role() = 'service_role'::text))
  WITH CHECK ((get_jwt_role() = 'service_role'::text));
