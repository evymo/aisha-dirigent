-- Table: knowledge_moderation_queue
-- Moderation queue for knowledge topics and posts
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS knowledge_moderation_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (resource_type IN ('topic','post','expert_rule','agent')),
  resource_id uuid NOT NULL,
  risk_score numeric,
  risk_tags text[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','escalated')),
  reviewer_user_id uuid,
  reviewer_notes text,
  aisha_evaluation jsonb,
  auto_decision boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT knowledge_moderation_queue_reviewer_fkey FOREIGN KEY (reviewer_user_id) REFERENCES aisha_auth.users(id)
);

ALTER TABLE knowledge_moderation_queue ENABLE ROW LEVEL SECURITY;

-- Grants: only service_role and admins via RPC
GRANT ALL ON knowledge_moderation_queue TO service_role;
