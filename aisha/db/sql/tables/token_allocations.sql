-- Table: token_allocations
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS token_allocations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid ,
  allocation_name text,
  allocation_type text,
  token_type text DEFAULT 'aisha'::text,
  total_amount numeric(20,8) DEFAULT 0,
  distributed_amount numeric(20,8) DEFAULT 0,
  balance numeric(20,8) DEFAULT 0,
  locked_balance numeric(20,8) DEFAULT 0,
  vesting_schedule text,
  vesting_start timestamptz,
  vesting_end timestamptz,
  cliff_months int4,
  is_active bool DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  current_streak int4 DEFAULT 0,
  best_streak int4 DEFAULT 0,
  last_activity_date date,
  PRIMARY KEY (id),
  CONSTRAINT token_allocations_user_id_key UNIQUE (user_id),
  CONSTRAINT token_allocations_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE token_allocations ENABLE ROW LEVEL SECURITY;
