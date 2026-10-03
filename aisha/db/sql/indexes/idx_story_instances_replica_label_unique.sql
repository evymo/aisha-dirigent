-- Index: idx_story_instances_replica_label_unique
-- Table: story_instances
--
-- Uniqueness invariant for non-origin (replica) instances: at most one
-- replica instance per (story_id, instance_label). Backs the idempotent
-- INSERT ... ON CONFLICT path in bootstrap_story_replica so concurrent
-- bootstrap calls cannot create duplicate replica rows. Origin instances
-- (is_origin = true) are outside the predicate.

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_instances_replica_label_unique
  ON public.story_instances (story_id, instance_label)
  WHERE is_origin = false;
