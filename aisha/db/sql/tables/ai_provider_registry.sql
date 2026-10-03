-- Table: ai_provider_registry
-- AISHA's catalog of LLM providers + their access modes. AISHA reads this when
-- deciding which backend to use for each OpenClaw clow sub-agent. New providers
-- can be added at runtime (admin-gated) — AISHA tests them via
-- aisha_test_mcp_server / its own probe before relying on them in production.
--
-- This is the source-of-truth for "what providers exist". The existing
-- ai_model_registry references it via provider_registry_id (per-model).

CREATE TABLE IF NOT EXISTS public.ai_provider_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable identifier referenced by ai_model_registry rows
  slug text NOT NULL UNIQUE,                                  -- 'anthropic', 'openai', 'google', 'huggingface', 'ollama', 'vllm', 'custom-mcp-XYZ'
  display_name text NOT NULL,

  -- Backend kind controls how AISHA dispatches calls
  backend_kind text NOT NULL CHECK (backend_kind IN (
    'direct_cloud',          -- direct API call (Anthropic/OpenAI/Google/HuggingFace) — used for batch APIs + selected sync
    'llm_gateway',           -- routed via LLM Gateway transparent proxy (typically IDE traffic + batch passthrough)
    'local_ollama',          -- local Ollama runtime
    'local_vllm',            -- local vLLM runtime (GPU)
    'mcp_server'             -- a custom MCP server that exposes model access
  )),

  -- Network access
  endpoint_url text,                                          -- e.g. https://api.anthropic.com, http://ollama:11434, https://gateway.aisha.guru/v1
  health_url text,                                            -- optional probe path

  -- Auth
  auth_kind text NOT NULL DEFAULT 'bearer' CHECK (auth_kind IN ('bearer', 'api_key_header', 'none')),
  auth_env_var text,                                          -- env var name that holds the secret (NEVER store secret in DB)

  -- Capability flags (used by aisha_resolve_clow_backend)
  supports_chat boolean NOT NULL DEFAULT true,
  supports_tool_use boolean NOT NULL DEFAULT false,
  supports_vision boolean NOT NULL DEFAULT false,
  supports_batch boolean NOT NULL DEFAULT false,              -- has a deferred /batches endpoint (Anthropic, OpenAI)
  supports_streaming boolean NOT NULL DEFAULT true,

  -- Availability / health (set by probe; AISHA reads as input)
  is_enabled boolean NOT NULL DEFAULT true,
  last_health_status text NOT NULL DEFAULT 'unknown' CHECK (last_health_status IN ('healthy', 'degraded', 'down', 'unknown')),
  last_health_checked_at timestamptz,
  last_health_detail text,
  -- Consecutive non-healthy probes. Incremented on degraded/down, RESET to 0
  -- on healthy. Used by get_providers_due_health_probe for exponential backoff:
  -- failing providers get probed less frequently to avoid log spam + wasted
  -- probe cycles. Operator can manually reset via update_provider_admin.
  consecutive_failure_count int NOT NULL DEFAULT 0,

  -- Cost class for quick filtering (per_1m_avg_input) — refined by ai_model_benchmarks per-model
  cost_class text DEFAULT 'standard' CHECK (cost_class IN ('budget', 'standard', 'premium')),

  -- §19.4 per-instance scoping: NULL = base/global provider (visible to every
  -- instance); non-NULL = restricted to that instance only. The base ships global
  -- providers; an instance may add private ones (DB-seed/env), NEVER tenant code.
  scoped_to_instance_id uuid,

  -- Notes
  -- Provenance: NULL = built-in/operator-declared provider; non-NULL = materialized
  -- from an approved marketplace plugin (kind='backend_provider'). This column is
  -- what makes ownership enforceable: materialize_backend_provider only updates a
  -- row it already owns, so a plugin can never overwrite a built-in provider.
  source_plugin_id uuid REFERENCES public.plugin_catalog(id) ON DELETE SET NULL,

  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_provider_registry ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ai_provider_registry IS
  'Catalog of LLM providers (cloud + local + MCP). AISHA picks per-clow backend from here via aisha_resolve_clow_backend.';

-- Indexes live in aisha/db/sql/indexes/idx_ai_provider_registry.sql per
-- SQL Source Separation rule.
