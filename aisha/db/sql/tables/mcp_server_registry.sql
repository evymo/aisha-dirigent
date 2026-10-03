-- Table: mcp_server_registry
-- MCP servers AISHA can discover, test, and conditionally use. Separate from
-- ai_provider_registry because MCP servers may expose non-LLM tools (search,
-- code-exec, retrieval, etc.). When an MCP server *does* expose a model
-- endpoint, AISHA creates a paired ai_provider_registry row with
-- backend_kind='mcp_server' referencing this row via metadata.mcp_server_id.
--
-- Lifecycle: discovered → tested (passed/failed) → enabled → in_use → deprecated.
-- aisha_test_mcp_server runs a smoke probe and writes the result here.

CREATE TABLE IF NOT EXISTS public.mcp_server_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  slug text NOT NULL UNIQUE,                                  -- 'aisha-knowledge', 'huggingface-inference', 'github-mcp', ...
  display_name text NOT NULL,
  description text,

  -- Connection
  transport text NOT NULL CHECK (transport IN ('http', 'sse', 'stdio', 'websocket')),
  endpoint_url text,                                          -- for http/sse/websocket
  stdio_command text[],                                       -- for stdio transport

  auth_kind text NOT NULL DEFAULT 'bearer' CHECK (auth_kind IN ('bearer', 'api_key_header', 'none', 'oauth2')),
  auth_env_var text,

  -- Capability tags — AISHA reads these to decide whether to test/use this MCP for a task
  capability_tags text[] DEFAULT '{}'::text[],                -- e.g. ['retrieval', 'web_search', 'code_exec', 'image_gen', 'llm_chat']
  exposes_llm boolean NOT NULL DEFAULT false,                 -- when true, AISHA may also catalog this via ai_provider_registry

  -- Lifecycle
  status text NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'tested_ok', 'tested_failed', 'enabled', 'in_use', 'deprecated', 'rejected')),
  last_tested_at timestamptz,
  last_test_result jsonb,                                     -- { ok, latency_ms, supported_methods, sample_response_excerpt, error? }
  test_failure_count int NOT NULL DEFAULT 0,

  -- Provenance
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto_discovery', 'partner_provided')),
  registered_by uuid,                                         -- user who registered (or NULL for system)
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_server_registry ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mcp_server_registry IS
  'MCP servers AISHA may discover/test/use. Lifecycle status tracked. exposes_llm=true rows get paired into ai_provider_registry (backend_kind=mcp_server).';

-- Indexes live in aisha/db/sql/indexes/idx_mcp_server_registry.sql per
-- SQL Source Separation rule.
