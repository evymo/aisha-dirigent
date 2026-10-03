-- Function: public.get_cosmos_ledger_status_admin
-- Purpose: Returns aggregated blockchain audit record stats for admin dashboard.
-- Access: admin/staff only via is_admin_or_staff() check.

CREATE OR REPLACE FUNCTION public.get_cosmos_ledger_status_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
  v_pending bigint;
  v_confirmed bigint;
  v_failed bigint;
  v_last_sync timestamptz;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Forbidden: admin or staff role required';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE (data->>'status') = 'pending'),
    count(*) FILTER (WHERE (data->>'status') = 'confirmed'),
    count(*) FILTER (WHERE (data->>'status') = 'failed')
  INTO v_total, v_pending, v_confirmed, v_failed
  FROM public.blockchain_audit_records;

  SELECT max(created_at)
  INTO v_last_sync
  FROM public.blockchain_audit_records
  WHERE (data->>'status') = 'confirmed';

  RETURN jsonb_build_object(
    'total', COALESCE(v_total, 0),
    'pending', COALESCE(v_pending, 0),
    'confirmed', COALESCE(v_confirmed, 0),
    'failed', COALESCE(v_failed, 0),
    'last_sync', v_last_sync
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cosmos_ledger_status_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cosmos_ledger_status_admin() TO authenticated;
