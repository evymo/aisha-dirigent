-- Table: data_sensitivity_registry
-- §11 residency: the DB-driven source of truth for which tables are sensitive.
-- Replaces the hardcoded CONFIDENTIAL_ANCHOR_TABLES literal in svc-ai-chat — a
-- 'confidential' row here forces on-prem residency (canUseCloudApis=false). The
-- svc reads it via get_data_sensitivity_registry() into a TTL cache (NEVER on the
-- hot path / SSE handshake) and fails SAFE to its built-in baseline list if this
-- registry is empty or unreachable (graceful degradation — never less strict).
-- RLS: ENABLED (global, non-PII config — authenticated read, admin write).
CREATE TABLE IF NOT EXISTS public.data_sensitivity_registry (
  table_name  text PRIMARY KEY,
  sensitivity public.data_sensitivity NOT NULL DEFAULT 'confidential',
  category    text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.data_sensitivity_registry ENABLE ROW LEVEL SECURITY;
