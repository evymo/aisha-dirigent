-- Policy: coolify_app_slots_service
-- Full access pro service_role (n8n workflows volající RPCs).

CREATE POLICY coolify_app_slots_service ON public.coolify_app_slots
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
