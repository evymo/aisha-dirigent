-- Trigger: sla_tracking_updated_at
-- Table: sla_tracking

CREATE TRIGGER sla_tracking_updated_at
  BEFORE UPDATE ON public.sla_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
