-- Table: knowledge_topics
-- Knowledge Base topic registry
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS knowledge_topics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title_key text NOT NULL,
  summary_key text,
  source_locale text NOT NULL DEFAULT 'en',
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','members','internal')),
  verification_status text NOT NULL DEFAULT 'draft' CHECK (verification_status IN ('draft','reviewed','verified')),
  is_locked boolean DEFAULT false,
  expert_rule_id uuid REFERENCES public.expert_rules(id),
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT knowledge_topics_slug_key UNIQUE (slug),
  CONSTRAINT knowledge_topics_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE knowledge_topics ENABLE ROW LEVEL SECURITY;

-- Grants: public knowledge topics
GRANT SELECT ON knowledge_topics TO anon;
GRANT SELECT ON knowledge_topics TO authenticated;
GRANT ALL ON knowledge_topics TO service_role;
