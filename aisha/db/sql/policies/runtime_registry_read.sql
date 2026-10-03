-- Policy: Authenticated can read the runtime registry catalog
--
-- ai_runtime_registry is AISHA's catalog of execution runtimes (the axis ABOVE
-- backend_kind: which engine — workflowEngine / hermes / cli / ... — can carry a
-- clow). Like ai_provider_registry, this catalog is NON-SENSITIVE: it lists what
-- runtimes EXIST and their declared capabilities; it holds no secrets (secrets
-- live in env vars referenced by name, never in the row).
--
-- Read posture mirrors ai_provider_registry_authenticated_read: any authenticated
-- principal may SELECT the whole catalog. This is NOT an allow-list — the row set
-- is not a maintained list of "permitted" runtimes. AVAILABILITY is derived
-- per-row at resolve time from the runtime's OWN is_enabled state (and a
-- registered adapter); a registered-but-disabled runtime is still visible in the
-- catalog but is not usable. Capability MATCH and GOVERNANCE (risk/spend
-- thresholds) are applied downstream by the resolver/policy layer, not by hiding
-- rows here.

CREATE POLICY "runtime_registry_read"
  ON public.ai_runtime_registry
  FOR SELECT
  TO authenticated
  USING (true);
