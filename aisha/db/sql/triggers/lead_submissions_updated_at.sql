-- Trigger: lead_submissions_updated_at
-- Table: lead_submissions
-- Bumps updated_at on every row UPDATE (operator triage status changes).

CREATE TRIGGER lead_submissions_updated_at
  BEFORE UPDATE ON public.lead_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
