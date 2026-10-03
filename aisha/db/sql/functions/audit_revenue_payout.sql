-- Function: audit_revenue_payout
-- Trigger function for auditing revenue split payouts.

CREATE OR REPLACE FUNCTION audit_revenue_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.payout_status IS DISTINCT FROM NEW.payout_status
     AND NEW.payout_status = 'paid' THEN
    -- user_id = auth.uid() (nullable): this trigger can fire under a service/system
    -- actor (auth.uid() NULL); the COALESCE fallback to '00000000-…0000' is not a
    -- real aisha_auth.users id → audit_journal_user_id_fkey violation that would
    -- abort the payout UPDATE. NULL is FK-safe.
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'REVENUE_PAYOUT',
      jsonb_build_object(
        'area', 'marketplace',
        'severity', 'info',
        'entity_type', 'revenue_split',
        'entity_id', NEW.id,
        'amount', NEW.amount,
        'recipient_type', NEW.recipient_type::text
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION audit_revenue_payout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_revenue_payout() TO authenticated;
GRANT EXECUTE ON FUNCTION audit_revenue_payout() TO service_role;

