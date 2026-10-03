-- Trigger: trg_timeline_order

CREATE TRIGGER trg_timeline_order
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_timeline_order();
