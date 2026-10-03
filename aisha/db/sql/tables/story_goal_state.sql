-- Table: story_goal_state
-- Source: hand-authored; deploy via migration 20260501000000_dirigent_supervisor.sql
-- Purpose: Per-story autonomous-loop state for the Stop hook continuation pattern.
--          Each row tracks acceptance_criteria progress, loop iteration count, and
--          fingerprint of last evaluator output. Enables Stop hook to return
--          decision:block when criteria unmet (loop continuation) and decision:ask
--          when loop_max reached (escalate to user).

CREATE TABLE IF NOT EXISTS public.story_goal_state (
  story_id uuid NOT NULL,
  acceptance_criteria jsonb NOT NULL,
  last_evaluated_at timestamp with time zone,
  loop_iterations integer DEFAULT 0 NOT NULL,
  loop_max integer DEFAULT 12 NOT NULL,
  fingerprint text,
  last_evaluator_output jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (story_id),
  CONSTRAINT story_goal_state_loop_max_check CHECK (loop_max BETWEEN 1 AND 100),
  CONSTRAINT story_goal_state_loop_iter_check CHECK (loop_iterations >= 0)
);

ALTER TABLE public.story_goal_state ENABLE ROW LEVEL SECURITY;
