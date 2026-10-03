-- Enum: plugin_kind
-- Purpose: Category of plugin in the plugin control plane. full_stack added in migration 20260418110000.
--          'agent' added for the agent marketplace (certified guild members publish agents).
--          An 'agent' is a distinct runtime contract: declarative (run-as-story via
--          install_agent_as_story, no code artifact) or executable (call-mode, Phase 2).
--          NOT overloaded onto full_stack/automation_node — those bind fixed module interfaces.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plugin_kind') THEN
    CREATE TYPE public.plugin_kind AS ENUM (
      'web_tracking',
      'auth_provider',
      'backend_provider',
      'automation_node',
      'full_stack',
      'agent',
      'data_source'
    );
  END IF;
END $$;

-- 'data_source' — connector plugins that materialize into the ingest spine
-- (agent_knowledge_sources + the source-broker plugin host). A data connector
-- reads external observations (telematics, ERP, IoT) and promotes them onto the
-- raw signal lane; it is NOT a backend_provider (that kind is LLM-shaped:
-- supports_chat/vision → ai_provider_registry). Fresh DBs get it from the CREATE
-- above; existing DBs converge via the idempotent ALTER below.
ALTER TYPE public.plugin_kind ADD VALUE IF NOT EXISTS 'data_source';
