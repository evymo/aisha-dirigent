-- Index: idx_coolify_app_slots_recent_switch
-- Source: aisha/db/migrations/20260428102000_coolify_app_slots_phase2.sql

CREATE INDEX IF NOT EXISTS idx_coolify_app_slots_recent_switch
  ON public.coolify_app_slots (last_switch_at DESC) WHERE last_switch_at IS NOT NULL;
