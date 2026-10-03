-- Policy: ai_provider_registry_authenticated_read ON public.ai_provider_registry
-- §19.4 per-instance scoping: a base/global provider (scoped_to_instance_id IS NULL)
-- is visible to everyone; an instance-scoped provider is visible ONLY within its own
-- instance (current_setting('aisha.instance_id')). service_role sees all. This closes
-- the cross-instance model-enumeration gap (broad "any authenticated user" → scoped).

CREATE POLICY "ai_provider_registry_authenticated_read" ON public.ai_provider_registry AS PERMISSIVE FOR SELECT TO public USING (
  (auth.role() = 'service_role'::text)
  OR (
    (auth.uid() IS NOT NULL)
    AND (
      (scoped_to_instance_id IS NULL)
      OR (scoped_to_instance_id = NULLIF(current_setting('aisha.instance_id'::text, true), ''::text)::uuid)
    )
  )
);
