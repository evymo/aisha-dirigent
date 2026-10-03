-- Table: expert_rule_ratings

CREATE TABLE IF NOT EXISTS public.expert_rule_ratings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  rule_id uuid NOT NULL REFERENCES public.expert_rules ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES aisha_auth.users ON DELETE CASCADE,
  rating integer NOT NULL,
  review_text text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.expert_rule_ratings ENABLE ROW LEVEL SECURITY;
