-- Table: knowledge_attribution
-- Tracks which expert rules/knowledge items contributed to project outcomes.
-- Used for revenue splitting to knowledge contributors.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS knowledge_attribution (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL,
  rule_id uuid,
  knowledge_item_id uuid REFERENCES public.knowledge_items ON DELETE SET NULL,
  author_id uuid,
  ai_run_id uuid REFERENCES public.ai_runs ON DELETE SET NULL,
  usage_intensity numeric(3,2) NOT NULL DEFAULT 0,
  relevance_score numeric(3,2) NOT NULL DEFAULT 0,
  quality_score numeric(3,2),
  attribution_weight numeric(5,4) NOT NULL DEFAULT 0,
  tokens_influenced integer NOT NULL DEFAULT 0,
  context_used text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT knowledge_attribution_story_id_fkey FOREIGN KEY (story_id)
    REFERENCES partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT knowledge_attribution_rule_id_fkey FOREIGN KEY (rule_id)
    REFERENCES expert_rules(id) ON DELETE SET NULL,
  CONSTRAINT knowledge_attribution_author_id_fkey FOREIGN KEY (author_id)
    REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT knowledge_attribution_intensity_range
    CHECK (usage_intensity >= 0 AND usage_intensity <= 1),
  CONSTRAINT knowledge_attribution_relevance_range
    CHECK (relevance_score >= 0 AND relevance_score <= 1),
  CONSTRAINT knowledge_attribution_quality_range
    CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1))
);

ALTER TABLE knowledge_attribution ENABLE ROW LEVEL SECURITY;

