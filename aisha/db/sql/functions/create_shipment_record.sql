-- Function: public.create_shipment_record
-- Records an outbound carrier-dispatch reference when svc-packeta hands a shipment
-- to a carrier (routes/create-packet.ts, routes/packeta-api.ts). Best-effort audit
-- trail (the service call is non-critical). Idempotent on (carrier, external_id).
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.create_shipment_record(
  p_barcode text,
  p_carrier text,
  p_external_id text,
  p_order_id uuid,
  p_status text,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_carrier IS NULL OR p_external_id IS NULL THEN
    RAISE EXCEPTION 'carrier and external_id are required' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.shipment_dispatch_records
    (user_id, order_id, carrier, external_id, barcode, status)
  VALUES
    (p_user_id, p_order_id, p_carrier, p_external_id, p_barcode, COALESCE(p_status, 'created'))
  ON CONFLICT (carrier, external_id) DO UPDATE
    SET status     = EXCLUDED.status,
        barcode    = EXCLUDED.barcode,
        order_id   = EXCLUDED.order_id,
        user_id    = EXCLUDED.user_id,
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.create_shipment_record(text, text, text, uuid, text, uuid) IS
  'Upserts a per-dispatch carrier shipment reference into shipment_dispatch_records (idempotent on carrier + external_id).';

REVOKE ALL ON FUNCTION public.create_shipment_record(text, text, text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shipment_record(text, text, text, uuid, text, uuid) TO service_role;
