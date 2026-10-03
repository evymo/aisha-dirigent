-- ============================================================================
-- Source of Truth: publish_surface_snapshot_audited
-- Popis: Emit podepsaného read-only snímku surface (Ed25519). SERVICE-ROLE-ONLY
--        přes NULL-safe public.is_service_role() (#588) — fail-closed: bez jwt
--        claims / s cizí rolí končí výjimkou. Parita audited-write posture s
--        upsert_surface_block_audited (emise snímku nesmí jít mimo audit).
-- Podpis: Ed25519 vzniká v emitující SLUŽBĚ (privátní klíč jen v jejím env); DB
--         ukládá sha256/signature/key_id a NIKDY neověřuje (asymetrie — klient
--         ověřuje pinovaným public klíčem). max_sensitivity je v surface_snapshots
--         CHECK zastropováno na 'restricted' (confidential se do snímku nedostane).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_surface_snapshot_audited(
  p_snapshot_slug   text,
  p_surface         text,
  p_payload         jsonb,
  p_max_sensitivity text,
  p_sha256          text,
  p_signature       text,
  p_key_id          text,
  p_expires_at      timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'service role required' USING errcode = '42501';
  END IF;

  -- max_sensitivity nad 'restricted' je zamítnuto surface_snapshots CHECK
  -- (fail-closed na zápisu); INSERT propadne s jasnou chybou, žádné tiché stripování.
  INSERT INTO public.surface_snapshots AS ss
    (snapshot_slug, surface, payload, max_sensitivity, sha256, signature, key_id, expires_at)
  VALUES
    (p_snapshot_slug, p_surface, p_payload, p_max_sensitivity, p_sha256, p_signature, p_key_id, p_expires_at)
  RETURNING ss.id INTO v_id;

  -- Audit — platformní vzor (přímý INSERT do audit_journal, aditivně, hash-chain #585);
  -- tvar sloupců dle upsert_surface_block_audited (ověřeno proti HEAD).
  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'surface.snapshot_published', 'surface.snapshot_published', 'content', 'info',
          array['surface', 'snapshot'],
          jsonb_build_object('snapshot_slug', p_snapshot_slug, 'surface', p_surface,
                             'max_sensitivity', p_max_sensitivity, 'sha256', p_sha256, 'key_id', p_key_id));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_surface_snapshot_audited(text,text,jsonb,text,text,text,text,timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_surface_snapshot_audited(text,text,jsonb,text,text,text,text,timestamptz) TO service_role;
