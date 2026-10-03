-- Policy: admin_read_all_budget

CREATE POLICY "admin_read_all_budget" ON public.ai_budget
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((get_jwt_role() = ANY (ARRAY['admin'::text, 'staff'::text, 'service_role'::text])));
