-- Table: shipment_dispatch_records
-- Generic outbound carrier-dispatch reference recorded by svc-packeta when a
-- shipment is handed to a carrier (Packeta/Zásilkovna today). Distinct from the
-- member-distribution table shipment_records (monthly member fulfilment with
-- member_token + distribution_month): this is the lightweight per-dispatch audit
-- reference the create-packet / packeta-api routes write via create_shipment_record
-- (carrier + external packet id + barcode + order + status + user). Non-critical
-- audit trail — the service call is best-effort (.catch()).
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS public.shipment_dispatch_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  order_id uuid,
  carrier text NOT NULL,
  external_id text,
  barcode text,
  status text NOT NULL DEFAULT 'created',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT shipment_dispatch_records_carrier_external_key UNIQUE (carrier, external_id),
  CONSTRAINT shipment_dispatch_records_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT shipment_dispatch_records_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL
);

ALTER TABLE public.shipment_dispatch_records ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.shipment_dispatch_records IS
  'Per-dispatch outbound carrier reference (carrier/external_id/barcode/order/status/user) '
  'written by svc-packeta via create_shipment_record. Idempotent on (carrier, external_id).';
