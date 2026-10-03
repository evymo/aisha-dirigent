-- Trigger: trg_timeline_product_log

CREATE TRIGGER trg_timeline_product_log
  AFTER INSERT ON public.member_product_logs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_product_log();
