-- Table: agent_tools
-- Source: 20260302000000_phase2_tool_system.sql
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS agent_tools (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text UNIQUE NOT NULL,
  display_name_key  text NOT NULL DEFAULT '',
  description       text NOT NULL,
  parameters_schema jsonb NOT NULL DEFAULT '{}',
  handler_type      tool_handler_type NOT NULL,
  handler_ref       text NOT NULL,
  access_tier_min   text NOT NULL DEFAULT 'basic',
  is_active         boolean NOT NULL DEFAULT true,
  requires_consent  boolean NOT NULL DEFAULT false,
  audit_action      text DEFAULT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES aisha_auth.users(id),
  updated_by        uuid REFERENCES aisha_auth.users(id)
);

COMMENT ON TABLE agent_tools IS 'Registry of callable tools that AI agents can invoke during conversations.';
COMMENT ON COLUMN agent_tools.name IS 'Unique slug identifier used in tool_call references.';
COMMENT ON COLUMN agent_tools.description IS 'English description sent to the LLM for tool selection.';
COMMENT ON COLUMN agent_tools.parameters_schema IS 'JSON Schema describing the expected parameters.';
COMMENT ON COLUMN agent_tools.handler_type IS 'Execution method: rpc (Supabase RPC), edge_function, or webhook.';
COMMENT ON COLUMN agent_tools.handler_ref IS 'Reference to the handler: RPC function name, edge function name, or webhook URL.';
COMMENT ON COLUMN agent_tools.access_tier_min IS 'Minimum access tier required to execute this tool.';
COMMENT ON COLUMN agent_tools.requires_consent IS 'Whether data sharing consent is required before execution.';
COMMENT ON COLUMN agent_tools.audit_action IS 'If non-null, the tool execution is logged to audit_journal with this action.';

ALTER TABLE agent_tools ENABLE ROW LEVEL SECURITY;
