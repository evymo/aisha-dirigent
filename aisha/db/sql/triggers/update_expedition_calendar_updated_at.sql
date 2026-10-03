-- Trigger: update_expedition_calendar_updated_at
-- Table: expedition_calendar

CREATE TRIGGER update_expedition_calendar_updated_at
BEFORE UPDATE
ON public.expedition_calendar
FOR EACH ROW
EXECUTE FUNCTION update_distribution_adjustment_timestamp();
