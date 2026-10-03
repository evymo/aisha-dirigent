-- Table: expert_rule_subscriptions

CREATE TABLE IF NOT EXISTS public.expert_rule_subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES aisha_auth.users ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.expert_rules ON DELETE CASCADE,
  is_active boolean DEFAULT true,
  subscribed_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone,
  usage_count integer DEFAULT 0,
  last_used_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.expert_rule_subscriptions ENABLE ROW LEVEL SECURITY;
