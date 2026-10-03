-- Table: token_reward_rules
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS token_reward_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  token_type text NOT NULL DEFAULT 'aisha'::text,
  action_name_key text,
  description_key text,
  base_amount numeric DEFAULT 1.0,
  multiplier numeric DEFAULT 1.0,
  min_amount numeric,
  max_amount numeric,
  cooldown_hours int4,
  daily_limit int4,
  weekly_limit int4,
  monthly_limit int4,
  requires_membership bool DEFAULT false,
  membership_tier_required text,
  is_active bool DEFAULT true,
  sort_order int4 DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT token_reward_rules_action_type_key UNIQUE (action_type)
);

ALTER TABLE token_reward_rules ENABLE ROW LEVEL SECURITY;
