-- Index: idx_system_config_updated_by
-- Table: system_config

CREATE INDEX IF NOT EXISTS idx_system_config_updated_by ON public.system_config(updated_by);
