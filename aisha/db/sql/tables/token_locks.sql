-- Table: token_locks
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS token_locks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric(20,8) NOT NULL,
  lock_type text ,
  locked_at timestamptz DEFAULT now(),
  unlocks_at timestamptz,
  unlocked_at timestamptz,
  reference_id uuid,
  created_at timestamptz DEFAULT now(),
  token_type text DEFAULT 'aisha'::text,
  lock_start timestamptz DEFAULT now(),
  lock_end timestamptz,
  unlock_schedule jsonb DEFAULT '"end"'::jsonb,
  unlocked_amount numeric DEFAULT 0,
  is_active bool DEFAULT true,
  lock_reason text,
  lock_condition text,
  unlock_condition text,
  locked_amount numeric(20,8),
  unlock_at timestamptz,
  reference_type text,
  notes text,
  created_by uuid,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT token_locks_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE token_locks ENABLE ROW LEVEL SECURITY;
