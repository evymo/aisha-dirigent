-- Function: sync_topic_version_to_knowledge_item

CREATE OR REPLACE FUNCTION public.sync_topic_version_to_knowledge_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_topic RECORD;
  v_existing_id uuid;
  v_tags text[];
BEGIN
  -- Get parent topic info
  SELECT kt.id, kt.slug, kt.title_key, kt.summary_key,
         kt.visibility, kt.verification_status
  INTO v_topic
  FROM knowledge_topics kt
  WHERE kt.id = NEW.topic_id;

  IF v_topic IS NULL THEN
    RETURN NEW;
  END IF;

  -- Build tags from slug
  v_tags := ARRAY[v_topic.slug, 'knowledge-topic', 'project-rules'];

  -- Check if knowledge_item already exists for this topic
  SELECT id INTO v_existing_id
  FROM knowledge_items
  WHERE source_type = 'knowledge_topic' AND source_id = v_topic.id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Update existing
    UPDATE knowledge_items SET
      title = COALESCE(v_topic.title_key, v_topic.slug),
      body_markdown = NEW.body_markdown,
      ai_context_tags = v_tags,
      status = CASE WHEN v_topic.verification_status = 'verified' THEN 'active' ELSE 'active' END,
      visibility = CASE v_topic.visibility
        WHEN 'internal' THEN 'guild'
        WHEN 'members' THEN 'members'
        ELSE 'public'
      END,
      version = NEW.version_no,
      updated_at = now()
    WHERE id = v_existing_id;
  ELSE
    -- Insert new
    INSERT INTO knowledge_items (
      item_type, source_type, source_id, source_slug,
      title, summary, body_markdown,
      ai_instructions, ai_context_tags,
      category, status, visibility, version,
      is_verified, published_at
    ) VALUES (
      'engineering_doc',
      'knowledge_topic',
      v_topic.id,
      v_topic.slug,
      COALESCE(v_topic.title_key, v_topic.slug),
      COALESCE(v_topic.summary_key, ''),
      NEW.body_markdown,
      'Toto je projektová zásada/pravidlo platformy Evymo. Používej ji při rozhodování o architektuře, kódu a procesech.',
      v_tags,
      'project-rules',
      'active',
      CASE v_topic.visibility
        WHEN 'internal' THEN 'guild'
        WHEN 'members' THEN 'members'
        ELSE 'public'
      END,
      NEW.version_no,
      v_topic.verification_status = 'verified',
      CASE WHEN v_topic.verification_status = 'verified' THEN now() ELSE NULL END
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION sync_topic_version_to_knowledge_item() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_topic_version_to_knowledge_item() TO PUBLIC;
GRANT EXECUTE ON FUNCTION sync_topic_version_to_knowledge_item() TO authenticated;
GRANT EXECUTE ON FUNCTION sync_topic_version_to_knowledge_item() TO service_role;
