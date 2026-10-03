-- Function: public.delete_media_asset_admin
-- Description: Měkké smazání záznamu média (deleted_at). Samotný objekt maže
--              storage-auth (DELETE /object/<bucket>/<klíč>, admin/staff);
--              klient volá obojí — nejdřív objekt, pak tenhle záznam, aby galerie
--              nikdy nenabízela obrázek, který v úložišti chybí.
-- Security: SECURITY DEFINER, admin/staff.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.delete_media_asset_admin(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.media_assets m SET deleted_at = now()
  WHERE m.id = p_id AND m.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Media asset not found';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'MEDIA_ASSET_DELETE',
          jsonb_build_object('area', 'content', 'severity', 'info', 'entity_type', 'media_asset',
                             'entity_id', p_id::text));
END;
$$;

REVOKE ALL ON FUNCTION public.delete_media_asset_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_media_asset_admin(uuid) TO authenticated;
