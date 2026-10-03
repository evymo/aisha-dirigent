-- Policy: runtime_registry_admin_manage
-- Table: ai_runtime_registry
-- Source-of-truth pair: aisha/db/sql/tables/ai_runtime_registry.sql
--
-- Admin + staff get full CRUD on the runtime catalog (register a runtime,
-- toggle its own is_enabled state, edit its declared capabilities). This is
-- the registry that makes capability-availability DERIVABLE: a runtime is
-- usable iff it is REGISTERED + ENABLED + has a registered adapter — mirroring
-- ai_provider_registry. There is NO allow-list of permitted runtime names; each
-- row governs itself via its own is_enabled column, and authority to mutate the
-- catalog is gated purely by role membership (is_admin_or_staff), not by any
-- maintained list of permitted entities.
--
-- service_role bypasses RLS, so the cold-start generator scripts and the AISHA
-- autonomous loop (self-registration of runtimes/adapters) don't need a JWT.
-- Everyone else is denied — non-admin authenticated users cannot read or mutate
-- the runtime catalog through direct table access.
--
-- Placement note: policies live in policies/ (emitted AFTER functions in the
-- baseline) so public.is_admin_or_staff exists when the policy binds —
-- inline-in-table placement would break cold-start ordering.

DROP POLICY IF EXISTS runtime_registry_admin_manage
  ON public.ai_runtime_registry;

CREATE POLICY runtime_registry_admin_manage
  ON public.ai_runtime_registry
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
