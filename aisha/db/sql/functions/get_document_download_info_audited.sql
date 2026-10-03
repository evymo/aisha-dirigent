-- ============================================================================
-- Source of Truth: get_document_download_info_audited
-- Popis: Vydá informaci pro stažení binárky dokladu (bucket + content-addressed
--        klíč <sha256>.pdf). Uživatel se k objektu ve storage nikdy nedostává
--        přímo — tohle RPC je jediná cesta a každé vydání se audituje (kdo se
--        díval, je součást příběhu).
--        Bucket je DATA řádku (li_source_registry.storage_bucket, píše ingest)
--        — žádná instanční konstanta v kódu; chybějící bucket = jasná chyba.
-- Autorizace: service/admin vše; člen přes document_visible_to (třída
--        promovaného dokladu × spočtená úroveň tazatele; nepromovaný doklad
--        fail-closed). Jediný vlastník pravidla = document_visible_to.
-- Záchrana: regenerát z nasazené DB 2026-07-25 (live-only drift, task #16)
--        + odstraněn zadrátovaný bucket + zapojen sdílený predikát.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_document_download_info_audited(p_doc_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_doc record;
  v_uid uuid := auth.uid();
BEGIN
  SELECT id, source_sha256, filename, doc_type, story_id, storage_bucket
    INTO v_doc
    FROM li_source_registry
   WHERE id = p_doc_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokument nenalezen' USING errcode = 'P0002';
  END IF;

  IF NOT (public.is_service_role()
          OR public.is_admin_or_staff()
          OR public.document_visible_to(v_uid, v_doc.source_sha256)) THEN
    RAISE EXCEPTION 'Nemáte oprávnění k tomuto dokumentu' USING errcode = '42501';
  END IF;

  IF v_doc.storage_bucket IS NULL THEN
    RAISE EXCEPTION 'Doklad % nemá uloženou binárku (storage_bucket je NULL)', p_doc_id
      USING errcode = 'P0002';
  END IF;

  INSERT INTO audit_journal(user_id, action, metadata)
  VALUES (v_uid, 'DOCUMENT_DOWNLOAD',
          jsonb_build_object('doc_id', p_doc_id, 'filename', v_doc.filename,
                             'sha', v_doc.source_sha256));

  RETURN jsonb_build_object(
    'doc_id', v_doc.id, 'filename', v_doc.filename, 'doc_type', v_doc.doc_type,
    'storage_bucket', v_doc.storage_bucket,
    'storage_key', v_doc.source_sha256 || '.pdf',
    'provenance', jsonb_build_object('source_slug', 'li-source-registry',
                                     'trace_id', 'doc:download'));
END;
$$;

REVOKE ALL ON FUNCTION public.get_document_download_info_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_document_download_info_audited(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_document_download_info_audited(uuid) TO service_role;
