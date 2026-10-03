/**
 * get_workspace_context
 *
 * Returns a JSONB envelope of the caller's current AISHA workspace state for
 * Phase 13.1 (svc-ide-context). The envelope is consumed by per-IDE template
 * adapters (Claude Code, Cursor, GitHub Copilot, JetBrains future) to render
 * dynamic agent instructions that reflect what is actually happening RIGHT
 * NOW — not what was true at the time CLAUDE.md was generated.
 *
 * Contract:
 *   - SECURITY DEFINER + SET search_path TO 'public' (CLAUDE.md mandatory)
 *   - Caller MUST be authenticated (auth.uid() non-NULL)
 *   - Visibility is enforced application-side via is_story_participant() +
 *     is_admin_or_staff() helpers; RLS on underlying tables is bypassed by
 *     SECURITY DEFINER, so we manually re-implement the participant+admin
 *     visibility contract from P7 RLS policies.
 *   - NO PII in output — only IDs, slugs, statuses, timestamps, counts.
 *     `audit_journal.summary` field is INCLUDED because it is already PII-safe
 *     per project convention (per `feedback_no_pii_in_metadata.md`).
 *   - Output capped at small bounded sizes (top N stories, last 30 audit rows)
 *     so the rendered IDE instructions stay under a few KB.
 *
 * Returns jsonb with shape:
 *   {
 *     "user_id": uuid,
 *     "workspace_id": text (optional, opaque caller-supplied id),
 *     "generated_at": timestamptz,
 *     "stories": [ { id, title, status, delivery_status, is_stack_default,
 *                    default_branch, last_activity_at } ],
 *     "active_runs": [ { id, story_id, kind, status, started_at,
 *                        current_agent_slug } ],
 *     "pending_approvals": [ { story_id, story_title, delivery_status,
 *                              last_activity_at } ],
 *     "recent_audit": [ { id, action, severity, area, summary, created_at } ],
 *     "deploy_state": [ { app_name, story_id, active_slot, last_switch_at,
 *                         blue_health, green_health } ]
 *   }
 *
 * @param p_workspace_id - Optional opaque caller workspace id (e.g. local
 *                        machine + repo identifier). Echoed back in envelope.
 * @returns jsonb envelope
 */
CREATE OR REPLACE FUNCTION public.get_workspace_context(
  p_workspace_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_privileged boolean;
  v_envelope jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  v_is_privileged := public.is_admin_or_staff(v_user_id);

  WITH visible_stories AS (
    SELECT
      s.id,
      s.title,
      s.status,
      s.delivery_status,
      s.is_stack_default,
      s.default_branch,
      s.last_activity_at
    FROM public.partner_stories s
    WHERE
      v_is_privileged
      OR s.is_stack_default = true
      OR public.is_story_participant(v_user_id, s.id)
    ORDER BY s.last_activity_at DESC NULLS LAST
    LIMIT 10
  ),
  active_runs AS (
    SELECT
      r.id,
      r.story_id,
      r.kind,
      r.status,
      r.started_at,
      r.metadata->>'current_agent_slug' AS current_agent_slug
    FROM public.ai_runs r
    WHERE r.status = 'running'
      AND r.story_id IN (SELECT vs.id FROM visible_stories vs)
    ORDER BY r.started_at DESC
    LIMIT 20
  ),
  pending_approvals AS (
    SELECT
      vs.id AS story_id,
      vs.title AS story_title,
      vs.delivery_status,
      vs.last_activity_at
    FROM visible_stories vs
    JOIN public.delivery_statuses ds ON ds.status = vs.delivery_status
    WHERE ds.requires_approval = true
      AND ds.is_active = true
    ORDER BY vs.last_activity_at DESC
    LIMIT 20
  ),
  recent_audit AS (
    SELECT
      aj.id,
      aj.action,
      aj.severity,
      aj.area,
      aj.summary,
      aj.created_at
    FROM public.audit_journal aj
    WHERE v_is_privileged
       OR aj.user_id = v_user_id
    ORDER BY aj.created_at DESC
    LIMIT 30
  ),
  deploy_state AS (
    SELECT
      cas.app_name,
      cas.story_id,
      cas.active_slot,
      cas.last_switch_at,
      cas.blue_health,
      cas.green_health
    FROM public.coolify_app_slots cas
    WHERE cas.story_id IN (SELECT vs.id FROM visible_stories vs)
       OR (cas.story_id IS NULL AND v_is_privileged)
    ORDER BY cas.last_switch_at DESC NULLS LAST
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'user_id', v_user_id,
    'workspace_id', p_workspace_id,
    'generated_at', now(),
    'is_privileged', v_is_privileged,
    'stories', COALESCE((SELECT jsonb_agg(row_to_json(s)) FROM visible_stories s), '[]'::jsonb),
    'active_runs', COALESCE((SELECT jsonb_agg(row_to_json(r)) FROM active_runs r), '[]'::jsonb),
    'pending_approvals', COALESCE((SELECT jsonb_agg(row_to_json(p)) FROM pending_approvals p), '[]'::jsonb),
    'recent_audit', COALESCE((SELECT jsonb_agg(row_to_json(a)) FROM recent_audit a), '[]'::jsonb),
    'deploy_state', COALESCE((SELECT jsonb_agg(row_to_json(d)) FROM deploy_state d), '[]'::jsonb)
  ) INTO v_envelope;

  RETURN v_envelope;
END;
$function$;

-- Permissions per CLAUDE.md SECURITY DEFINER pattern
REVOKE ALL ON FUNCTION public.get_workspace_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_context(text) TO authenticated;
