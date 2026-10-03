-- Table: rule_quality_feedback
-- User feedback on expert rule quality and relevance in projects.
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS rule_quality_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  was_helpful boolean NOT NULL,
  relevance_rating integer NOT NULL,
  feedback_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT rule_quality_feedback_story_id_fkey FOREIGN KEY (story_id)
    REFERENCES partner_stories(id) ON DELETE CASCADE,
  CONSTRAINT rule_quality_feedback_rule_id_fkey FOREIGN KEY (rule_id)
    REFERENCES expert_rules(id) ON DELETE CASCADE,
  CONSTRAINT rule_quality_feedback_reviewer_id_fkey FOREIGN KEY (reviewer_id)
    REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT rule_quality_feedback_rating_range
    CHECK (relevance_rating >= 1 AND relevance_rating <= 5),
  CONSTRAINT rule_quality_feedback_unique
    UNIQUE (story_id, rule_id, reviewer_id)
);

ALTER TABLE rule_quality_feedback ENABLE ROW LEVEL SECURITY;

