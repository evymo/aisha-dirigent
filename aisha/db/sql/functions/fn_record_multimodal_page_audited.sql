-- Function: fn_record_multimodal_page_audited
-- Single text-input audited writer for a multimodal page's v2 (halfvec(2560)) embedding —
-- mirrors the chunk path insert_knowledge_embedding_v2_audited(text). Takes the embedding
-- as a JSON text array (NULL/'' = page recorded without an embedding yet), casts it to
-- halfvec(2560) for knowledge_multimodal_pages.embedding_v2, upserts the page, and writes
-- its audit_journal row (the _audited contract).
--
-- ONE overload by design: the prior vector/halfvec typed overloads were a PGRST203-
-- ambiguous back-port artifact with identical parameter names and zero callers, consolidated
-- into this canonical text form (rewrite, not capability removal — the multimodal v2 space,
-- the embedding_v2 halfvec(2560) column, is untouched).

CREATE OR REPLACE FUNCTION public.fn_record_multimodal_page_audited(p_item_id uuid, p_page_number integer, p_page_image_uri text, p_page_image_sha256 text, p_page_text text, p_embedding_v2 text, p_embedding_model text, p_embedding_version text, p_metadata jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id uuid;
  v_embedding halfvec(2560);
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_item_id IS NULL OR p_page_number IS NULL THEN
    RAISE EXCEPTION 'p_item_id and p_page_number are required';
  END IF;

  -- text -> halfvec(2560) (the v2 space constant); NULL/'' means "page recorded, no
  -- embedding yet" so status stays 'pending'. Cast after the auth/arg guards.
  v_embedding := CASE
    WHEN p_embedding_v2 IS NULL OR p_embedding_v2 = '' THEN NULL
    ELSE p_embedding_v2::halfvec(2560)
  END;

  INSERT INTO public.knowledge_multimodal_pages (
    knowledge_item_id, page_number, page_image_uri, page_image_sha256,
    page_text, embedding_v2, embedding_model, embedding_version,
    embedding_generated_at, status, metadata
  ) VALUES (
    p_item_id, p_page_number, p_page_image_uri, p_page_image_sha256,
    p_page_text, v_embedding, p_embedding_model, p_embedding_version,
    CASE WHEN v_embedding IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN v_embedding IS NOT NULL THEN 'embedded' ELSE 'pending' END,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (knowledge_item_id, page_number) DO UPDATE
    SET page_image_uri = EXCLUDED.page_image_uri,
        page_image_sha256 = EXCLUDED.page_image_sha256,
        page_text = EXCLUDED.page_text,
        embedding_v2 = EXCLUDED.embedding_v2,
        embedding_model = EXCLUDED.embedding_model,
        embedding_version = EXCLUDED.embedding_version,
        embedding_generated_at = EXCLUDED.embedding_generated_at,
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata
  RETURNING id INTO v_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'knowledge.multimodal_page_recorded',
    jsonb_build_object('page_id', v_id, 'item_id', p_item_id,
      'page_number', p_page_number, 'embedding_model', p_embedding_model));

  RETURN v_id;
END;
$function$
;

REVOKE ALL ON FUNCTION fn_record_multimodal_page_audited(uuid,integer,text,text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_record_multimodal_page_audited(uuid,integer,text,text,text,text,text,text,jsonb) TO service_role;
