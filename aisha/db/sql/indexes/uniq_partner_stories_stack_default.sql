-- Index: uniq_partner_stories_stack_default
-- Table: partner_stories
-- Auto-extracted from migration 20260516130000_stack_default_story.sql
-- Singleton invariant — only one row with is_stack_default = true exists per database.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_partner_stories_stack_default
  ON public.partner_stories (is_stack_default)
  WHERE is_stack_default = true;
