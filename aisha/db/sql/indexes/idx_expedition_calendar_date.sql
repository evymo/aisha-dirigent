-- Index: idx_expedition_calendar_date
-- Table: expedition_calendar

CREATE INDEX idx_expedition_calendar_date ON public.expedition_calendar USING btree (expedition_date);
