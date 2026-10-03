-- Index: idx_expedition_calendar_status
-- Table: expedition_calendar

CREATE INDEX idx_expedition_calendar_status ON public.expedition_calendar USING btree (status);
