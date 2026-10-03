-- Function: audit_booking_status_change
-- Trigger function for auditing booking status changes.

CREATE OR REPLACE FUNCTION audit_booking_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'BOOKING_STATUS_CHANGE',
      jsonb_build_object(
        'area', 'marketplace',
        'severity', 'info',
        'entity_type', 'consultation_booking',
        'entity_id', NEW.id,
        'from_status', OLD.status::text,
        'to_status', NEW.status::text
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION audit_booking_status_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_booking_status_change() TO authenticated;
GRANT EXECUTE ON FUNCTION audit_booking_status_change() TO service_role;

