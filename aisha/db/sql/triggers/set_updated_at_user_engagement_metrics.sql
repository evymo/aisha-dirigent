-- Trigger: auto-touch updated_at on user_engagement_metrics (universal updated_at convention)
CREATE TRIGGER set_updated_at_user_engagement_metrics
  BEFORE UPDATE ON public.user_engagement_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
