-- Function: audience_note_vectorize

CREATE OR REPLACE FUNCTION public.audience_note_vectorize()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_user_id UUID;
BEGIN
  -- Only process actor_note entries
  IF NEW.entry_type NOT IN ('actor_note', 'audit_event') THEN
    RETURN NEW;
  END IF;

  -- Resolve actor (story owner)
  SELECT user_id INTO v_actor_user_id FROM public.partner_stories WHERE id = NEW.story_id;
  IF v_actor_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Nothing to vectorize without body text (knowledge_items.body_markdown is NOT NULL).
  IF NEW.content IS NULL OR length(trim(NEW.content)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Insert into knowledge_items; svc-mcp-knowledge embedding pipeline picks it up.
  -- Mapped to the current knowledge_items schema: note text -> body_markdown, a
  -- derived title, item_type as the enum, and the former metadata fields routed to
  -- their real columns (story_id, author_id) + ai_context_tags. (The original
  -- back-ported body inserted non-existent content/metadata columns.)
  INSERT INTO public.knowledge_items (
    item_type,
    source_type,
    source_id,
    title,
    body_markdown,
    story_id,
    author_id,
    ai_context_tags
  ) VALUES (
    'domain_doc'::public.knowledge_item_type,
    CASE NEW.entry_type
      WHEN 'actor_note' THEN 'actor_overlay'
      WHEN 'audit_event' THEN 'audit_journal'
      ELSE 'story_entry'
    END,
    NEW.id,
    COALESCE(NULLIF(left(NEW.content, 120), ''), 'Story entry ' || NEW.id::text),
    NEW.content,
    NEW.story_id,
    v_actor_user_id,
    ARRAY[NEW.entry_type]
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$

;

REVOKE ALL ON FUNCTION public.audience_note_vectorize() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audience_note_vectorize() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.audience_note_vectorize() TO service_role;
