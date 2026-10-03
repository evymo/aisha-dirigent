-- Table: story_ai_sessions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS story_ai_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL,
  conversation_id uuid,
  session_type text NOT NULL,
  context_snapshot jsonb,
  tokens_used int4 NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT story_ai_sessions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE SET NULL,
  CONSTRAINT story_ai_sessions_story_id_fkey FOREIGN KEY (story_id) REFERENCES partner_stories(id) ON DELETE CASCADE
);

ALTER TABLE story_ai_sessions ENABLE ROW LEVEL SECURITY;

-- Columns added by later migrations (back-port reconciliation):
ALTER TABLE public.story_ai_sessions ADD COLUMN IF NOT EXISTS focus_actor_id uuid;
