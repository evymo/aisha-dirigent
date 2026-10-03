-- Index: idx_expedition_calendar_created_by
-- Table: expedition_calendar

CREATE INDEX IF NOT EXISTS idx_expedition_calendar_created_by ON public.expedition_calendar(created_by);
