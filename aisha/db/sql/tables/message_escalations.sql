-- Table: message_escalations
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS message_escalations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  partner_id uuid NOT NULL,
  escalation_type text NOT NULL,
  user_note text,
  context_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  partner_response text,
  partner_responded_at timestamptz,
  status text NOT NULL DEFAULT 'pending'::text,
  priority text NOT NULL DEFAULT 'normal'::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT message_escalations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
  CONSTRAINT message_escalations_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  CONSTRAINT message_escalations_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id),
  CONSTRAINT message_escalations_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE message_escalations ENABLE ROW LEVEL SECURITY;
