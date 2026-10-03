-- Index: idx_aisha_static_defense_rules_active
-- Table: aisha_static_defense_rules
-- Partial — only rows in `active` status. Supports the generator's primary
-- read path (`aisha_get_active_static_defense_rules` filters by
-- `status = 'active'` and joins on `category`).

CREATE INDEX IF NOT EXISTS idx_aisha_static_defense_rules_active
  ON public.aisha_static_defense_rules (category, status)
  WHERE status = 'active';
