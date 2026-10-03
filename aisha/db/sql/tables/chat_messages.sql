-- Table: chat_messages
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  content_metadata jsonb DEFAULT '{}'::jsonb,
  routed_to_agent_id uuid,
  routing_category text,
  model_used text,
  tokens_input int4,
  tokens_output int4,
  response_time_ms int4,
  guardrails_result jsonb,
  guardrails_triggered bool DEFAULT false,
  user_rating int4,
  user_feedback text,
  admin_rating smallint,
  admin_review_note text,
  is_golden_example bool DEFAULT false,
  is_visible bool NOT NULL DEFAULT true,
  is_edited bool NOT NULL DEFAULT false,
  original_content text,
  eval_score jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
  -- NOTE: routed_to_agent_id column kept (no FK) — agent_configurations table dropped in 20260411180000_drop_agent_configurations.sql
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
