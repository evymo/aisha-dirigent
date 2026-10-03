-- Table: chat_conversations
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text,
  summary text,
  primary_agent_id uuid,
  status text NOT NULL DEFAULT 'active'::text,
  message_count int4 NOT NULL DEFAULT 0,
  total_tokens_used int4 DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  archived_at timestamptz,
  PRIMARY KEY (id),
  -- primary_agent_id column kept for historical analytics (FK to agent_configurations removed)
  CONSTRAINT chat_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
