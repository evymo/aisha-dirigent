-- Index: idx_ai_runtime_registry_lookup
-- Runtime-availability lookup. Mirrors idx_ai_provider_registry_enabled:
-- availability is DERIVED, not allow-listed — the resolver asks "which runtimes
-- of this kind are usable?" by filtering on runtime_kind plus the entity's own
-- is_enabled self-governance flag. A registered + enabled runtime (with a
-- registered adapter) is usable; nothing here enumerates permitted names.
CREATE INDEX IF NOT EXISTS idx_ai_runtime_registry_lookup
  ON public.ai_runtime_registry (runtime_kind, is_enabled);
