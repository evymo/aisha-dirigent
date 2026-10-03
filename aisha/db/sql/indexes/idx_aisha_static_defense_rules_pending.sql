-- Index: idx_aisha_static_defense_rules_pending
-- Table: aisha_static_defense_rules
-- Partial — only rows in `draft` status, grouped by proposer. Supports the
-- operator UI's "review pending proposals" view and the Aisha autonomous
-- loop's queue of unapproved rule suggestions.

CREATE INDEX IF NOT EXISTS idx_aisha_static_defense_rules_pending
  ON public.aisha_static_defense_rules (proposed_by, status)
  WHERE status = 'draft';
