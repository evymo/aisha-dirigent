-- Enum: tool_handler_type
-- Source: 20260302000000_phase2_tool_system.sql

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tool_handler_type') THEN
    CREATE TYPE tool_handler_type AS ENUM ('rpc', 'edge_function', 'webhook');
  END IF;
END $$;
