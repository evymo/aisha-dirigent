-- ============================================================================
-- Source of Truth: hub_upsert_supplier_offer
-- Popis: Connector write — idempotent UPSERT of a supplier offer (EDI/PRICAT). service.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627160000_hub_supplier_offer_reprice.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_upsert_supplier_offer(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.is_service_role()) THEN
    RAISE EXCEPTION 'Unauthorized: service_role required';
  END IF;
  INSERT INTO public.hub_supplier_offer
    (source_id, supplier_sku, ean, product_type, brand, title, size, season,
     price_buy, currency, stock_qty, warehouse, valid_from, snapshot_token, refreshed_at)
  VALUES
    ((p_payload->>'source_id')::uuid, p_payload->>'supplier_sku', p_payload->>'ean',
     p_payload->>'product_type', p_payload->>'brand', p_payload->>'title', p_payload->>'size',
     p_payload->>'season', (p_payload->>'price_buy')::numeric, COALESCE(p_payload->>'currency', public.commerce_base_currency()),
     (p_payload->>'stock_qty')::int, p_payload->>'warehouse', (p_payload->>'valid_from')::date,
     p_payload->>'snapshot_token', now())
  ON CONFLICT (source_id, supplier_sku) DO UPDATE SET
    ean=EXCLUDED.ean, product_type=EXCLUDED.product_type, brand=EXCLUDED.brand, title=EXCLUDED.title,
    size=EXCLUDED.size, season=EXCLUDED.season, price_buy=EXCLUDED.price_buy, currency=EXCLUDED.currency,
    stock_qty=EXCLUDED.stock_qty, warehouse=EXCLUDED.warehouse, valid_from=EXCLUDED.valid_from,
    snapshot_token=EXCLUDED.snapshot_token, refreshed_at=now(), updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.hub_upsert_supplier_offer(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_upsert_supplier_offer(jsonb) TO service_role;
