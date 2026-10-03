-- Table: leaderboard_reward_config

CREATE TABLE IF NOT EXISTS public.leaderboard_reward_config (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  period_type text DEFAULT 'weekly'::text NOT NULL,
  rank_from integer DEFAULT 1 NOT NULL,
  rank_to integer DEFAULT 1 NOT NULL,
  bonus_tokens integer DEFAULT 0 NOT NULL,
  bonus_token_type text DEFAULT 'aisha'::text NOT NULL,
  voucher_product_id uuid,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.leaderboard_reward_config ENABLE ROW LEVEL SECURITY;
