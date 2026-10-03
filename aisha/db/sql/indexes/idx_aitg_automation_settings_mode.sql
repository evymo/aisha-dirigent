-- Index: idx_aitg_automation_settings_mode
-- Extracted from tables/aitg_automation_settings.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_automation_settings_mode
  ON public.aitg_automation_settings(mode);
