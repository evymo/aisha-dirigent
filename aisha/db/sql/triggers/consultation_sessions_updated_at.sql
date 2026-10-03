-- Trigger: consultation_sessions_updated_at
-- Table: consultation_sessions

CREATE TRIGGER consultation_sessions_updated_at
  BEFORE UPDATE ON public.consultation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
