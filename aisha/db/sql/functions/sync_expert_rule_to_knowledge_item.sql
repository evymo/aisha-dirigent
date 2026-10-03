-- Function: sync_expert_rule_to_knowledge_item

CREATE OR REPLACE FUNCTION public.sync_expert_rule_to_knowledge_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_author_name text;
  v_ki_id uuid;
BEGIN
  -- Get author display name
  SELECT display_name INTO v_author_name
  FROM partner_profiles WHERE id = NEW.author_partner_id;

  -- Upsert into knowledge_items
  INSERT INTO knowledge_items (
    item_type,
    source_type,
    source_id,
    source_slug,
    locale,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
  ) VALUES (
    'expert_rule',
    'guild_db',
    NEW.id,
    NEW.slug,
    'global',  -- expert rules are language-agnostic; the locale-widened unique needs a value
    NEW.title,
    NEW.summary,
    NEW.body_markdown,
    NEW.ai_instructions,
    NEW.ai_context_tags,
    NEW.category::text,
    NEW.expertise_area_id,
    CASE WHEN NEW.status = 'published' THEN 'active' ELSE 'pending_review' END,
    NEW.visibility,
    NEW.version,
    NEW.author_partner_id,
    v_author_name,
    NEW.usage_count,
    NEW.rating_avg,
    NEW.is_verified,
    NEW.published_at,
    NEW.created_at,
    NEW.updated_at
  )
  -- Brick4 widened idx_knowledge_items_source_unique to (source_type, source_id,
  -- locale); the conflict target must match it (the 2-col target lost its backing
  -- index, which silently broke this upsert).
  ON CONFLICT (source_type, source_id, locale) WHERE source_type = 'guild_db'
  DO UPDATE SET
    source_slug = EXCLUDED.source_slug,
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    body_markdown = EXCLUDED.body_markdown,
    ai_instructions = EXCLUDED.ai_instructions,
    ai_context_tags = EXCLUDED.ai_context_tags,
    category = EXCLUDED.category,
    expertise_area_id = EXCLUDED.expertise_area_id,
    status = EXCLUDED.status,
    visibility = EXCLUDED.visibility,
    version = EXCLUDED.version,
    author_display_name = EXCLUDED.author_display_name,
    usage_count = EXCLUDED.usage_count,
    rating_avg = EXCLUDED.rating_avg,
    is_verified = EXCLUDED.is_verified,
    published_at = EXCLUDED.published_at,
    updated_at = now();

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION sync_expert_rule_to_knowledge_item() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_expert_rule_to_knowledge_item() TO PUBLIC;
GRANT EXECUTE ON FUNCTION sync_expert_rule_to_knowledge_item() TO authenticated;
GRANT EXECUTE ON FUNCTION sync_expert_rule_to_knowledge_item() TO service_role;
