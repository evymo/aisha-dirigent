-- Function: audience_admin_content_reach
--
-- Governed SECURITY DEFINER replacement for the direct-granted admin view
-- public.audience_admin_content_reach_v (#572, finding N2). The view ran
-- owner-rights and was GRANT SELECT to authenticated/anon, so any logged-in
-- (or anonymous) caller could read every creator's PII (creator_email) with
-- RLS bypassed. This RPC serves the IDENTICAL projection through an admin gate:
-- is_admin_or_staff() must pass or the call RAISEs 42501. No column is dropped
-- — creator_email is preserved, but now only reachable by admin/staff.
--
-- Shape is identical to the view: one row per creator per content item,
-- unioning news (deliveries=reads + story_entries discussion/reactions) and
-- partner stories (participants=reads/attendance + story_entries discussion/
-- reactions), with 30d/90d windows, a composite reach_total, and a
-- 30d-over-prior-30d reach_trend_pct_30d. reads_prev_30d stays CTE-internal
-- (exactly as in the view) — it only feeds the trend, it was never projected.
-- Paginated (LIMIT/OFFSET) for PostgREST/Appsmith.

CREATE OR REPLACE FUNCTION public.audience_admin_content_reach(
  p_limit  integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
 RETURNS TABLE(
   metric_source        text,
   content_id           uuid,
   creator_user_id      uuid,
   creator_name         text,
   creator_email        text,
   content_title        text,
   content_slug         text,
   is_published         boolean,
   published_at         timestamp with time zone,
   content_created_at   timestamp with time zone,
   reads_total          bigint,
   reads_30d            bigint,
   reads_90d            bigint,
   discussion_total     bigint,
   discussion_30d       bigint,
   discussion_90d       bigint,
   reactions_total      bigint,
   reactions_30d        bigint,
   reactions_90d        bigint,
   attendance_total     bigint,
   attendance_30d       bigint,
   attendance_90d       bigint,
   reach_total          bigint,
   reach_30d            bigint,
   reach_90d            bigint,
   reach_trend_pct_30d  numeric
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_is_admin boolean := public.is_admin_or_staff();
  v_uid      uuid    := auth.uid();
BEGIN
  -- Role-scoped, per extranet spec 02 §3 "Studio autora / školitele":
  --   admin/staff        → every creator's rows (unchanged)
  --   authenticated author → ONLY their own rows (scoped in the final WHERE)
  --   anonymous          → denied, exactly as before
  --
  -- This does NOT reopen #572 finding N2. That leak was an owner-rights VIEW
  -- granted to authenticated/anon, so anyone could read EVERY creator's
  -- creator_email with RLS bypassed. Here a non-admin is filtered to
  -- creator_user_id = auth.uid(), so the only PII they can reach is their own —
  -- which is the whole point of an author-facing Creator Studio.
  IF NOT v_is_admin AND v_uid IS NULL THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH news_content AS (
    SELECT 'news'::text AS metric_source,
      na.id AS content_id,
      na.created_by AS creator_user_id,
      -- Resolve the i18n key to a human title. news_articles stores title_key
      -- (namespace `news`); the story branch below projects a plain-text title,
      -- so emitting the raw key here made one column carry two meanings and the
      -- Studio tiles would read "some-slug.title". Falls back locale → en → the
      -- key itself, so a missing translation degrades to today's behaviour
      -- rather than to NULL.
      public.get_translation_value_with_fallback(
        na.title_key, 'news', NULL, 'en', na.title_key
      ) AS content_title,
      na.slug AS content_slug,
      na.is_published,
      na.published_at,
      na.created_at AS content_created_at,
      -- reads / deliveries: one delivery row per recipient
      ( SELECT count(*) FROM news_article_deliveries d
         WHERE d.news_article_id = na.id) AS reads_total,
      ( SELECT count(*) FROM news_article_deliveries d
         WHERE d.news_article_id = na.id
           AND d.delivered_at > (now() - '30 days'::interval)) AS reads_30d,
      ( SELECT count(*) FROM news_article_deliveries d
         WHERE d.news_article_id = na.id
           AND d.delivered_at > (now() - '60 days'::interval)
           AND d.delivered_at <= (now() - '30 days'::interval)) AS reads_prev_30d,
      ( SELECT count(*) FROM news_article_deliveries d
         WHERE d.news_article_id = na.id
           AND d.delivered_at > (now() - '90 days'::interval)) AS reads_90d,
      -- discussion + reactions attach via story_entries subject pointer
      ( SELECT count(*) FROM story_entries se
         WHERE se.subject_type = 'news'::text AND se.subject_id = na.id
           AND se.status = 'visible'::text AND se.entry_type <> 'reaction'::text) AS discussion_total,
      ( SELECT count(*) FROM story_entries se
         WHERE se.subject_type = 'news'::text AND se.subject_id = na.id
           AND se.status = 'visible'::text AND se.entry_type <> 'reaction'::text
           AND se.created_at > (now() - '30 days'::interval)) AS discussion_30d,
      ( SELECT count(*) FROM story_entries se
         WHERE se.subject_type = 'news'::text AND se.subject_id = na.id
           AND se.status = 'visible'::text AND se.entry_type <> 'reaction'::text
           AND se.created_at > (now() - '90 days'::interval)) AS discussion_90d,
      ( SELECT count(*) FROM story_entries se
         WHERE se.subject_type = 'news'::text AND se.subject_id = na.id
           AND se.status = 'visible'::text AND se.entry_type = 'reaction'::text) AS reactions_total,
      ( SELECT count(*) FROM story_entries se
         WHERE se.subject_type = 'news'::text AND se.subject_id = na.id
           AND se.status = 'visible'::text AND se.entry_type = 'reaction'::text
           AND se.created_at > (now() - '30 days'::interval)) AS reactions_30d,
      ( SELECT count(*) FROM story_entries se
         WHERE se.subject_type = 'news'::text AND se.subject_id = na.id
           AND se.status = 'visible'::text AND se.entry_type = 'reaction'::text
           AND se.created_at > (now() - '90 days'::interval)) AS reactions_90d,
      0::bigint AS attendance_total,
      0::bigint AS attendance_30d,
      0::bigint AS attendance_90d
    FROM news_articles na
  ), story_content AS (
    SELECT 'story'::text AS metric_source,
      ps.id AS content_id,
      COALESCE(ps.user_id, ps.partner_id) AS creator_user_id,
      ps.title AS content_title,
      NULL::text AS content_slug,
      (ps.status = 'published'::text) AS is_published,
      ps.last_activity_at AS published_at,
      ps.created_at AS content_created_at,
      -- stories have no delivery log; reach surrogate is its participants
      ( SELECT count(*) FROM story_participants sp
         WHERE sp.story_id = ps.id) AS reads_total,
      ( SELECT count(*) FROM story_participants sp
         WHERE sp.story_id = ps.id
           AND sp.joined_at > (now() - '30 days'::interval)) AS reads_30d,
      ( SELECT count(*) FROM story_participants sp
         WHERE sp.story_id = ps.id
           AND sp.joined_at > (now() - '60 days'::interval)
           AND sp.joined_at <= (now() - '30 days'::interval)) AS reads_prev_30d,
      ( SELECT count(*) FROM story_participants sp
         WHERE sp.story_id = ps.id
           AND sp.joined_at > (now() - '90 days'::interval)) AS reads_90d,
      ( SELECT count(*) FROM story_entries se
         WHERE se.story_id = ps.id AND se.status = 'visible'::text
           AND se.entry_type <> 'reaction'::text) AS discussion_total,
      ( SELECT count(*) FROM story_entries se
         WHERE se.story_id = ps.id AND se.status = 'visible'::text
           AND se.entry_type <> 'reaction'::text
           AND se.created_at > (now() - '30 days'::interval)) AS discussion_30d,
      ( SELECT count(*) FROM story_entries se
         WHERE se.story_id = ps.id AND se.status = 'visible'::text
           AND se.entry_type <> 'reaction'::text
           AND se.created_at > (now() - '90 days'::interval)) AS discussion_90d,
      ( SELECT count(*) FROM story_entries se
         WHERE se.story_id = ps.id AND se.status = 'visible'::text
           AND se.entry_type = 'reaction'::text) AS reactions_total,
      ( SELECT count(*) FROM story_entries se
         WHERE se.story_id = ps.id AND se.status = 'visible'::text
           AND se.entry_type = 'reaction'::text
           AND se.created_at > (now() - '30 days'::interval)) AS reactions_30d,
      ( SELECT count(*) FROM story_entries se
         WHERE se.story_id = ps.id AND se.status = 'visible'::text
           AND se.entry_type = 'reaction'::text
           AND se.created_at > (now() - '90 days'::interval)) AS reactions_90d,
      ( SELECT count(*) FROM story_participants sp
         WHERE sp.story_id = ps.id) AS attendance_total,
      ( SELECT count(*) FROM story_participants sp
         WHERE sp.story_id = ps.id
           AND sp.joined_at > (now() - '30 days'::interval)) AS attendance_30d,
      ( SELECT count(*) FROM story_participants sp
         WHERE sp.story_id = ps.id
           AND sp.joined_at > (now() - '90 days'::interval)) AS attendance_90d
    FROM partner_stories ps
  ), unioned AS (
    SELECT * FROM news_content
    UNION ALL
    SELECT * FROM story_content
  )
  SELECT u.metric_source,
    u.content_id,
    u.creator_user_id,
    p.display_name AS creator_name,
    p.email AS creator_email,
    u.content_title,
    u.content_slug,
    u.is_published,
    u.published_at,
    u.content_created_at,
    u.reads_total,
    u.reads_30d,
    u.reads_90d,
    u.discussion_total,
    u.discussion_30d,
    u.discussion_90d,
    u.reactions_total,
    u.reactions_30d,
    u.reactions_90d,
    u.attendance_total,
    u.attendance_30d,
    u.attendance_90d,
    -- single composite reach metric across all engagement kinds
    (u.reads_total + u.discussion_total + u.reactions_total + u.attendance_total) AS reach_total,
    (u.reads_30d + u.discussion_30d + u.reactions_30d + u.attendance_30d) AS reach_30d,
    (u.reads_90d + u.discussion_90d + u.reactions_90d + u.attendance_90d) AS reach_90d,
    -- 30d-over-prior-30d trend on the reads/deliveries spine (NULL when no base)
    CASE
      WHEN u.reads_prev_30d > 0 THEN round(((u.reads_30d - u.reads_prev_30d)::numeric / u.reads_prev_30d::numeric) * 100::numeric, 1)
      WHEN u.reads_30d > 0 THEN 100.0
      ELSE NULL::numeric
    END AS reach_trend_pct_30d
  FROM unioned u
    LEFT JOIN profiles p ON p.user_id = u.creator_user_id
  -- Author self-scope. Admin/staff short-circuits to the full set; everyone else
  -- is pinned to their own content. Filtering here (not in the CTEs) keeps the
  -- union shape intact and makes LIMIT/OFFSET paginate the scoped result.
  WHERE v_is_admin OR u.creator_user_id = v_uid
  ORDER BY u.content_created_at DESC, u.content_id
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

REVOKE ALL ON FUNCTION audience_admin_content_reach(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_content_reach(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_content_reach(integer, integer) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_content_reach(integer, integer) TO service_role;

COMMENT ON FUNCTION public.audience_admin_content_reach(integer, integer) IS
  'Governed admin RPC replacing the direct-granted view audience_admin_content_reach_v (#572 finding N2: owner-rights view + GRANT SELECT to authenticated/anon = RLS-bypass PII leak). SECURITY DEFINER, role-scoped (extranet spec 02 §3): admin/staff see every creator; an authenticated non-admin is filtered to their OWN rows (creator_user_id = auth.uid()) so authors get a Creator Studio without reaching anyone else''s PII; anonymous is denied (RAISE 42501). Projection is identical to the view — one row per creator per content item, unioning news (news_article_deliveries=reads + story_entries discussion/reactions) and partner stories (story_participants=reads/attendance + story_entries discussion/reactions), with 30d/90d windows, composite reach_total/reach_30d/reach_90d and a 30d-over-prior-30d reach_trend_pct_30d. creator_email PII is preserved (no downgrade); admin/staff read it for every creator, an author only for themselves. content_title resolves news title_key via get_translation_value_with_fallback(namespace ''news'', locale→en→key) so the column is a human title for BOTH branches, not a raw i18n key on the news side. metric_source is ''news''|''story''. ORDER BY content_created_at DESC, content_id; LIMIT/OFFSET paginated. audience_ prefix inherits audience_autorevoke_public_execute (auto-strips PUBLIC/anon EXECUTE) + audience_audit_grants gates.';
