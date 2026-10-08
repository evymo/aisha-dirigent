-- Grants: member_dashboard_widgets

GRANT SELECT ON public.member_dashboard_widgets TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.member_dashboard_widgets TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.member_dashboard_widgets TO service_role;
