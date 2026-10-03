-- Index: idx_partner_stories_stack_default_lookup
-- Auto-extracted from migration 20260516130000_stack_default_story.sql
-- Speeds up ensure_stack_default_story() lookups (partial — only the singleton row).

CREATE INDEX IF NOT EXISTS idx_partner_stories_stack_default_lookup
  ON public.partner_stories (is_stack_default)
  WHERE is_stack_default = true;
