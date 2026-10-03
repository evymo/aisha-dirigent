-- Table: mcp_auth_tokens

CREATE TABLE IF NOT EXISTS public.mcp_auth_tokens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  scope text NOT NULL,
  account_id uuid,
  project_id uuid,
  allowed_tools text[] DEFAULT '{}'::text[] NOT NULL,
  denied_tools text[] DEFAULT '{}'::text[] NOT NULL,
  rate_limit_rpm integer DEFAULT 60 NOT NULL,
  rate_limit_daily integer DEFAULT 1000 NOT NULL,
  expires_at timestamp with time zone,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid NOT NULL,
  -- §8 PAT identity: owning user (chargeback/audit attribution; req.user.sub).
  user_id uuid REFERENCES aisha_auth.users ON DELETE SET NULL,
  -- §8.5 bind-at-issuance story scope. NULL ⇒ unscoped ⇒ /v1 fail-closes.
  scoped_to_story_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  usage_count bigint DEFAULT 0 NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.mcp_auth_tokens ENABLE ROW LEVEL SECURITY;
