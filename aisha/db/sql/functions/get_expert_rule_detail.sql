-- Function: public.get_expert_rule_detail
-- Arguments: p_rule_slug text, p_audience_user_id uuid (jen služba smí jmenovat publikum)
--
-- Viditelnost (2026-10-05, revize B1): pravidlo podle public.expert_rule_visible_to pro toho, PRO KOHO
-- se čte (domov viditelnosti; autor své, správa vše). Do 2026-10-05 funkce filtrovala jen stav —
-- anonym dostal tělo i pokyny pravidla `private`, `guild` i `members` (změřeno revizí).
-- Signatura se mění výměnou (přibyl parametr s výchozí hodnotou).
DROP FUNCTION IF EXISTS public.get_expert_rule_detail(text);
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_expert_rule_detail(p_rule_slug text, p_audience_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_rule record;
  v_result jsonb;
  v_audience_user uuid;  -- pro koho se čte (služba smí říct; jinak volající sám; bez identity NULL)
BEGIN
  v_audience_user := CASE
    WHEN public.get_jwt_role() = 'service_role' THEN COALESCE(p_audience_user_id, auth.uid())
    ELSE auth.uid()
  END;

  SELECT er.*, pp.display_name AS author_display_name, pp.avatar_url AS author_avatar_url,
         pp.guild_tier AS author_guild_tier, pp.guild_bio AS author_guild_bio,
         gea.slug AS expertise_area_slug, gea.name_key AS expertise_area_name_key,
         gea.icon AS expertise_area_icon
  INTO v_rule
  FROM expert_rules er
  JOIN partner_profiles pp ON pp.id = er.author_partner_id
  LEFT JOIN guild_expertise_areas gea ON gea.id = er.expertise_area_id
  WHERE er.slug = p_rule_slug
    AND (
      er.status = 'published'
      OR (er.author_partner_id IN (SELECT pp2.id FROM public.partner_profiles pp2 WHERE pp2.user_id = v_audience_user))
    )
    -- Viditelnost pro toho, pro koho se čte (autor své, správa vše, ostatní podle domova).
    AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, v_audience_user);

  IF v_rule IS NULL THEN
    RETURN NULL;
  END IF;

  -- Log audit for rule access
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (auth.uid(), 'EXPERT_RULE_VIEW', jsonb_build_object(
      'area', 'knowledge',
      'severity', 'info',
      'rule_id', v_rule.id,
      'rule_slug', v_rule.slug
    ));
  END IF;

  v_result := jsonb_build_object(
    'id', v_rule.id,
    'slug', v_rule.slug,
    'title', v_rule.title,
    'summary', v_rule.summary,
    'body_markdown', v_rule.body_markdown,
    'category', v_rule.category,
    'expertise_area_slug', v_rule.expertise_area_slug,
    'expertise_area_name_key', v_rule.expertise_area_name_key,
    'expertise_area_icon', v_rule.expertise_area_icon,
    'author_partner_id', v_rule.author_partner_id,
    'author_display_name', v_rule.author_display_name,
    'author_avatar_url', v_rule.author_avatar_url,
    'author_guild_tier', v_rule.author_guild_tier,
    'ai_instructions', v_rule.ai_instructions,
    'ai_context_tags', v_rule.ai_context_tags,
    'is_verified', v_rule.is_verified,
    'version', v_rule.version,
    'subscriber_count', v_rule.subscriber_count,
    'usage_count', v_rule.usage_count,
    'rating_avg', v_rule.rating_avg,
    'rating_count', v_rule.rating_count,
    'status', v_rule.status,
    'visibility', v_rule.visibility,
    'published_at', v_rule.published_at,
    'created_at', v_rule.created_at,
    'updated_at', v_rule.updated_at,
    'documents', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', erd.id,
        'title', erd.title,
        'description', erd.description,
        'file_path', erd.file_path,
        'file_name', erd.file_name,
        'mime_type', erd.mime_type,
        'content_markdown', erd.content_markdown,
        'document_type', erd.document_type,
        'sort_order', erd.sort_order
      ) ORDER BY erd.sort_order)
      FROM expert_rule_documents erd
      WHERE erd.rule_id = v_rule.id),
      '[]'::jsonb
    ),
    'is_subscribed', COALESCE(
      (SELECT true FROM expert_rule_subscriptions ers
       WHERE ers.rule_id = v_rule.id AND ers.user_id = auth.uid() AND ers.is_active = true),
      false
    )
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_expert_rule_detail(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expert_rule_detail(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_expert_rule_detail(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expert_rule_detail(text, uuid) TO service_role;
