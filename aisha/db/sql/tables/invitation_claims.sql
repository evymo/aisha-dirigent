-- Table: invitation_claims
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS invitation_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT invitation_claims_invitation_id_claimed_by_key UNIQUE (invitation_id, user_id),
  CONSTRAINT invitation_claims_invitation_id_user_id_key UNIQUE (user_id, invitation_id),
  CONSTRAINT invitation_claims_claimed_by_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT invitation_claims_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE,
  CONSTRAINT invitation_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE invitation_claims ENABLE ROW LEVEL SECURITY;
