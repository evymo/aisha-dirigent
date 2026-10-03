-- Table: expert_rules

CREATE TABLE IF NOT EXISTS public.expert_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  summary text,
  body_markdown text NOT NULL,
  category expert_rule_category DEFAULT 'other'::expert_rule_category NOT NULL,
  expertise_area_id uuid,
  author_partner_id uuid NOT NULL,
  status expert_rule_status DEFAULT 'draft'::expert_rule_status NOT NULL,
  visibility text DEFAULT 'public'::text NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  is_verified boolean DEFAULT false,
  verified_by uuid,
  verified_at timestamp with time zone,
  ai_instructions text,
  ai_context_tags text[] DEFAULT '{}'::text[],
  subscriber_count integer DEFAULT 0,
  usage_count integer DEFAULT 0,
  rating_avg numeric DEFAULT 0,
  rating_count integer DEFAULT 0,
  published_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  content_embedding vector(1024),
  is_default boolean DEFAULT false NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.expert_rules ENABLE ROW LEVEL SECURITY;
