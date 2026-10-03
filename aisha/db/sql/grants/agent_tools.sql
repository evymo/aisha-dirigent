-- Grants: agent_tools
-- Source: 20260302000000_phase2_tool_system.sql

GRANT SELECT ON agent_tools TO authenticated;
GRANT INSERT, UPDATE, DELETE ON agent_tools TO authenticated;
GRANT SELECT ON agent_tools TO service_role;
