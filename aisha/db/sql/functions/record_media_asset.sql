-- Function: public.record_media_asset
-- Description: Zapíše (nebo obnoví) záznam nahraného média. Volá storage-auth
--              pod service_role ve chvíli, kdy objekt PROŠEL antivirem a leží
--              v cílovém veřejném bucketu — dřív záznam vzniknout nesmí, jinak
--              by galerie nabízela obrázek, který se nikdy neservíruje.
--              Idempotentní: (bucket, object_key) je klíč objektu; opakované
--              ohlášení téhož nahrání záznam jen obnoví (deleted_at → NULL).
-- Security: SECURITY DEFINER, JEN service_role — identita nahrávajícího přichází
--           v p_uploaded_by z ověřeného tokenu ve storage-auth, ne od klienta.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.record_media_asset(
  p_bucket text,
  p_bytes bigint,
  p_content_type text,
  p_object_key text,
  p_original_name text DEFAULT NULL,
  p_uploaded_by uuid DEFAULT NULL
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
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF COALESCE(p_bucket, '') = '' OR COALESCE(p_object_key, '') = '' OR COALESCE(p_content_type, '') = '' THEN
    RAISE EXCEPTION 'bucket, object_key and content_type are required';
  END IF;

  INSERT INTO public.media_assets (bucket, object_key, content_type, bytes, original_name, uploaded_by)
  VALUES (p_bucket, p_object_key, p_content_type, COALESCE(p_bytes, 0), NULLIF(p_original_name, ''), p_uploaded_by)
  ON CONFLICT (bucket, object_key) DO UPDATE SET
    content_type  = EXCLUDED.content_type,
    bytes         = EXCLUDED.bytes,
    original_name = COALESCE(EXCLUDED.original_name, media_assets.original_name),
    uploaded_by   = COALESCE(EXCLUDED.uploaded_by, media_assets.uploaded_by),
    deleted_at    = NULL
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_media_asset(text, bigint, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_media_asset(text, bigint, text, text, text, uuid) TO service_role;
