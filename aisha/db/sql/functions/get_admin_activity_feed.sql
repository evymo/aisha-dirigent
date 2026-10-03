-- Function: public.get_admin_activity_feed
-- Arguments: p_action_type text, p_limit integer, p_offset integer, p_search text
-- Description: Returns unified activity feed of all pending admin actions across the system.
--              Each item includes member context (non-sensitive data: display_name, membership_tier)
--              and type-specific metadata for inline action handling.
-- Security: SECURITY DEFINER; admin/staff guard + audit logging.

CREATE OR REPLACE FUNCTION public.get_admin_activity_feed(
  p_action_type text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
 RETURNS TABLE(
  item_id text,
  item_type text,
  user_id uuid,
  display_name text,
  membership_tier text,
  action_required boolean,
  metadata jsonb,
  created_at timestamptz
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_search_pattern text;
BEGIN
  IF NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'view',
    p_area := 'admin',
    p_details := jsonb_build_object(
      'dataset', 'activity_feed',
      'action_type_filter', p_action_type,
      'limit', p_limit,
      'offset', p_offset
    ),
    p_entity_id := NULL,
    p_entity_type := 'admin_activity_feed',
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'notice',
    p_summary := 'Admin viewing activity feed',
    p_tags := ARRAY['admin', 'activity_feed'],
    p_user_id := v_user_id
  );

  v_search_pattern := CASE
    WHEN p_search IS NOT NULL AND p_search <> '' THEN '%' || lower(p_search) || '%'
    ELSE NULL
  END;

  RETURN QUERY
  WITH feed_items AS (
    -- 1. Pending subscriptions
    SELECT
      'subscription:' || ms.id::text AS item_id,
      'subscription_pending'::text AS item_type,
      ms.user_id,
      p.display_name,
      m_tier.tier::text AS membership_tier,
      true AS action_required,
      jsonb_build_object(
        'subscription_id', ms.id,
        'package_name', COALESCE(sp.name, 'Unknown'),
        'package_tier', COALESCE(sp.tier::text, 'basic'),
        'amount_paid', ms.amount_paid,
        'currency', COALESCE(ms.currency, public.commerce_base_currency())
      ) AS metadata,
      ms.created_at
    FROM public.member_subscriptions ms
    JOIN public.profiles p ON p.user_id = ms.user_id
    LEFT JOIN public.subscription_packages sp ON sp.id = ms.package_id
    LEFT JOIN LATERAL (
      SELECT tier FROM public.memberships WHERE memberships.user_id = ms.user_id ORDER BY created_at DESC LIMIT 1
    ) m_tier ON true
    WHERE ms.status = 'pending'
      AND (p_action_type IS NULL OR p_action_type = 'subscription_pending')
      AND (v_search_pattern IS NULL OR lower(COALESCE(p.display_name, '')) LIKE v_search_pattern)

    UNION ALL

    -- 2. Pending deletion requests
    SELECT
      'deletion:' || adr.id::text AS item_id,
      'deletion_pending'::text AS item_type,
      adr.user_id,
      p.display_name,
      m_tier.tier::text AS membership_tier,
      true AS action_required,
      jsonb_build_object(
        'request_id', adr.id,
        'reason', COALESCE(adr.reason, ''),
        'scheduled_for', adr.scheduled_deletion_at,
        'days_remaining', GREATEST(0, EXTRACT(DAY FROM (adr.scheduled_deletion_at - now())))::integer
      ) AS metadata,
      adr.created_at
    FROM public.account_deletion_requests adr
    JOIN public.profiles p ON p.user_id = adr.user_id
    LEFT JOIN LATERAL (
      SELECT tier FROM public.memberships WHERE memberships.user_id = adr.user_id ORDER BY created_at DESC LIMIT 1
    ) m_tier ON true
    WHERE adr.status = 'pending'
      AND (p_action_type IS NULL OR p_action_type = 'deletion_pending')
      AND (v_search_pattern IS NULL OR lower(COALESCE(p.display_name, '')) LIKE v_search_pattern)

    UNION ALL

    -- 3. Pending registrations
    SELECT
      'registration:' || se.id::text AS item_id,
      'registration_pending'::text AS item_type,
      se.user_id,
      p.display_name,
      m_tier.tier::text AS membership_tier,
      true AS action_required,
      jsonb_build_object(
        'registration_id', se.id,
        'study_id', se.study_id,
        'study_name', COALESCE(s.name, 'Unknown'),
        'registration_status', se.status::text
      ) AS metadata,
      se.created_at
    FROM public.study_registrations se
    JOIN public.profiles p ON p.user_id = se.user_id
    LEFT JOIN public.studies s ON s.id = se.study_id
    LEFT JOIN LATERAL (
      SELECT tier FROM public.memberships WHERE memberships.user_id = se.user_id ORDER BY created_at DESC LIMIT 1
    ) m_tier ON true
    WHERE se.status::text IN ('pending', 'screening')
      AND (p_action_type IS NULL OR p_action_type = 'registration_pending')
      AND (v_search_pattern IS NULL OR lower(COALESCE(p.display_name, '')) LIKE v_search_pattern)

    UNION ALL

    -- 4. Pending contributions
    SELECT
      'contribution:' || sc.id::text AS item_id,
      'contribution_pending'::text AS item_type,
      sc.user_id,
      p.display_name,
      m_tier.tier::text AS membership_tier,
      true AS action_required,
      jsonb_build_object(
        'contribution_id', sc.id,
        'study_id', sc.study_id,
        'study_name', COALESCE(s.name, 'Unknown'),
        'amount', sc.amount,
        'currency', COALESCE(sc.currency, public.commerce_base_currency())
      ) AS metadata,
      sc.created_at
    FROM public.study_contributions sc
    JOIN public.profiles p ON p.user_id = sc.user_id
    LEFT JOIN public.studies s ON s.id = sc.study_id
    LEFT JOIN LATERAL (
      SELECT tier FROM public.memberships WHERE memberships.user_id = sc.user_id ORDER BY created_at DESC LIMIT 1
    ) m_tier ON true
    WHERE sc.status::text = 'pending'
      AND (p_action_type IS NULL OR p_action_type = 'contribution_pending')
      AND (v_search_pattern IS NULL OR lower(COALESCE(p.display_name, '')) LIKE v_search_pattern)

    UNION ALL

    -- 5. Pending consultant approvals
    SELECT
      'consultant:' || scon.id::text AS item_id,
      'consultant_pending'::text AS item_type,
      pp.user_id,
      COALESCE(pp.business_name, p.display_name) AS display_name,
      NULL::text AS membership_tier,
      true AS action_required,
      jsonb_build_object(
        'consultant_id', scon.id,
        'study_id', scon.study_id,
        'study_name', COALESCE(s.name, 'Unknown'),
        'partner_id', scon.partner_id,
        'role', scon.role
      ) AS metadata,
      scon.created_at
    FROM public.study_consultants scon
    JOIN public.partner_profiles pp ON pp.id = scon.partner_id
    JOIN public.profiles p ON p.user_id = pp.user_id
    LEFT JOIN public.studies s ON s.id = scon.study_id
    WHERE scon.status::text = 'pending'
      AND (p_action_type IS NULL OR p_action_type = 'consultant_pending')
      AND (v_search_pattern IS NULL OR lower(COALESCE(pp.business_name, p.display_name, '')) LIKE v_search_pattern)

    UNION ALL

    -- 6. Pending escalations
    SELECT
      'escalation:' || me.id::text AS item_id,
      'escalation_pending'::text AS item_type,
      me.user_id,
      p.display_name,
      m_tier.tier::text AS membership_tier,
      true AS action_required,
      jsonb_build_object(
        'escalation_id', me.id,
        'escalation_type', me.escalation_type,
        'priority', me.priority
      ) AS metadata,
      me.created_at
    FROM public.message_escalations me
    JOIN public.profiles p ON p.user_id = me.user_id
    LEFT JOIN LATERAL (
      SELECT tier FROM public.memberships WHERE memberships.user_id = me.user_id ORDER BY created_at DESC LIMIT 1
    ) m_tier ON true
    WHERE me.status = 'pending'
      AND (p_action_type IS NULL OR p_action_type = 'escalation_pending')
      AND (v_search_pattern IS NULL OR lower(COALESCE(p.display_name, '')) LIKE v_search_pattern)

    UNION ALL

    -- 7. Pending moderation
    SELECT
      'moderation:' || kmq.id::text AS item_id,
      'moderation_pending'::text AS item_type,
      NULL::uuid AS user_id,
      kmq.resource_type || ':' || kmq.resource_id::text AS display_name,
      NULL::text AS membership_tier,
      true AS action_required,
      jsonb_build_object(
        'queue_id', kmq.id,
        'resource_type', kmq.resource_type,
        'resource_id', kmq.resource_id,
        'risk_score', kmq.risk_score,
        'risk_tags', kmq.risk_tags
      ) AS metadata,
      kmq.created_at
    FROM public.knowledge_moderation_queue kmq
    WHERE kmq.status = 'pending'
      AND (p_action_type IS NULL OR p_action_type = 'moderation_pending')
      AND (v_search_pattern IS NULL)

    UNION ALL

    -- 8. Pending/processing orders
    SELECT
      'order:' || o.id::text AS item_id,
      'order_pending'::text AS item_type,
      o.user_id,
      p.display_name,
      m_tier.tier::text AS membership_tier,
      true AS action_required,
      jsonb_build_object(
        'order_id', o.id,
        'order_status', o.status::text,
        'total', o.total,
        'currency', COALESCE(o.currency, public.commerce_base_currency())
      ) AS metadata,
      o.created_at
    FROM public.orders o
    JOIN public.profiles p ON p.user_id = o.user_id
    LEFT JOIN LATERAL (
      SELECT tier FROM public.memberships WHERE memberships.user_id = o.user_id ORDER BY created_at DESC LIMIT 1
    ) m_tier ON true
    WHERE o.status::text IN ('pending', 'paid', 'processing')
      AND (p_action_type IS NULL OR p_action_type = 'order_pending')
      AND (v_search_pattern IS NULL OR lower(COALESCE(p.display_name, '')) LIKE v_search_pattern)
  )
  SELECT
    fi.item_id,
    fi.item_type,
    fi.user_id,
    fi.display_name,
    fi.membership_tier,
    fi.action_required,
    fi.metadata,
    fi.created_at
  FROM feed_items fi
  ORDER BY fi.action_required DESC, fi.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_admin_activity_feed(text, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_activity_feed(text, integer, integer, text) TO authenticated;

COMMENT ON FUNCTION public.get_admin_activity_feed(text, integer, integer, text) IS
'Unified admin activity feed combining all pending actions from subscriptions, deletions, registrations, contributions, consultants, escalations, moderation, and orders. Non-sensitive data with member context.';
