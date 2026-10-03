-- Trigger: trg_timeline_wearable_analysis_file

CREATE TRIGGER trg_timeline_wearable_analysis_file
  AFTER INSERT ON public.wearable_analysis_files
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_wearable_analysis_file();
