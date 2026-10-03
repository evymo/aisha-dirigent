-- Index: idx_ai_provider_registry_health
-- Health-status lookup (operators query "which providers are degraded?").

CREATE INDEX IF NOT EXISTS idx_ai_provider_registry_health
  ON public.ai_provider_registry (last_health_status, last_health_checked_at)
  WHERE is_enabled;
