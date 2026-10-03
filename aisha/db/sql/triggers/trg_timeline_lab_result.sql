-- Trigger: trg_timeline_lab_result

CREATE TRIGGER trg_timeline_lab_result
  AFTER INSERT ON public.lab_results
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_lab_result();
