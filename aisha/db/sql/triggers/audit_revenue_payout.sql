-- Trigger: audit_revenue_payout
-- Table: revenue_splits

CREATE TRIGGER audit_revenue_payout
    AFTER UPDATE ON public.revenue_splits
    FOR EACH ROW
    EXECUTE FUNCTION audit_revenue_payout();

