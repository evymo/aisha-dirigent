-- Trigger: update_member_dashboard_widgets_updated_at
-- Table: member_dashboard_widgets

CREATE TRIGGER update_member_dashboard_widgets_updated_at
    BEFORE UPDATE ON public.member_dashboard_widgets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
