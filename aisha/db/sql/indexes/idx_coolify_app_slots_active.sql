-- Index: idx_coolify_app_slots_active
-- Source: aisha/db/migrations/20260428102000_coolify_app_slots_phase2.sql

CREATE INDEX IF NOT EXISTS idx_coolify_app_slots_active
  ON public.coolify_app_slots (active_slot);
