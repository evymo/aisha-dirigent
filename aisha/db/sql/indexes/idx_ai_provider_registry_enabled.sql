-- Index: idx_ai_provider_registry_enabled
-- Enabled-providers lookup (filtered by backend_kind for resolver fast-path).

CREATE INDEX IF NOT EXISTS idx_ai_provider_registry_enabled
  ON public.ai_provider_registry (is_enabled, backend_kind)
  WHERE is_enabled;
