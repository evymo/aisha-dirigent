-- Function: public.kanban_stories_view
-- Description: Drives the mission-control kanban (`/admin/mission-control/kanban`).
--   Returns one row per visible story, joined with:
--     - workflow_statuses (swimlane label, sort order, color, is_terminal)
--     - latest ai_runs row (current_agent_slug, current_run_status)
--     - latest ai_trace_event timestamp (last_event_at)
--     - per-story AI cost aggregate (cost_to_date, tokens_to_date) over ai_runs
--     - per-story budget cap (ai_budget scope_type='story') → limit / consumed / state
--   Visibility:
--     - Admin/staff: every story
--     - Otherwise: participant stories ∪ stack-default singleton
--   The query is intentionally read-only — drag-drop mutations go through
--   update_story_status_audited (transition graph in workflow_status_transitions).
-- Security: SECURITY DEFINER. Authorization performed inline (mirrors
--   get_story_detail_audited's admin-or-participant pattern).
-- See also: workflow_statuses, workflow_status_transitions,
--   update_story_status_audited, ai_budget, useKanbanBoard hook.

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.kanban_stories_view(uuid);

CREATE OR REPLACE FUNCTION public.kanban_stories_view(
  p_partner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  story_id              uuid,
  partner_id            uuid,
  user_id               uuid,
  is_stack_default      boolean,
  title                 text,
  status                text,
  status_label_i18n_key text,
  status_sort_order     int,
  status_swimlane_color text,
  status_is_terminal    boolean,
  priority              text,
  is_starred            boolean,
  last_activity_at      timestamptz,
  default_branch        text,
  latest_run_id         uuid,
  current_agent_slug    text,
  current_run_status    text,
  last_event_at         timestamptz,
  cost_to_date      numeric,
  tokens_to_date        bigint,
  budget_cost_limit numeric,
  budget_consumed   numeric,
  budget_state          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);

  RETURN QUERY
  WITH visible_stories AS (
    SELECT ps.*
    FROM public.partner_stories ps
    WHERE
      (p_partner_id IS NULL OR ps.partner_id = p_partner_id)
      AND (
        v_is_admin
        OR ps.is_stack_default = true
        OR EXISTS (
          SELECT 1 FROM public.story_participants sp
          WHERE sp.story_id = ps.id AND sp.user_id = v_user_id
        )
      )
  ),
  latest_runs AS (
    SELECT DISTINCT ON (ar.story_id)
      ar.story_id,
      ar.id        AS run_id,
      ar.status    AS run_status,
      COALESCE(
        ar.route_plan -> 'agents' -> 0 ->> 'slug',
        ar.metadata ->> 'agent_slug',
        ar.kind
      ) AS agent_slug,
      ar.started_at,
      ar.finished_at
    FROM public.ai_runs ar
    WHERE ar.story_id IS NOT NULL
      AND ar.story_id IN (SELECT id FROM visible_stories)
    ORDER BY ar.story_id, ar.started_at DESC
  ),
  cost_agg AS (
    -- Per-story AI spend to date, aggregated over the canonical
    -- ai_runs.cost_total_json = { total, tokens_input, tokens_output }.
    SELECT
      ar.story_id,
      COALESCE(SUM(NULLIF(ar.cost_total_json->>'total', '')::numeric), 0) AS cost_to_date,
      -- SUM() over bigint operands returns numeric; the RETURNS TABLE column
      -- is declared bigint, so cast back explicitly or the function raises
      -- 42804 (numeric vs bigint) for every caller. See also final projection.
      COALESCE(SUM(
        COALESCE(NULLIF(ar.cost_total_json->>'tokens_input',  '')::bigint, 0) +
        COALESCE(NULLIF(ar.cost_total_json->>'tokens_output', '')::bigint, 0)
      ), 0)::bigint AS tokens_to_date
    FROM public.ai_runs ar
    WHERE ar.story_id IS NOT NULL
      AND ar.story_id IN (SELECT id FROM visible_stories)
    GROUP BY ar.story_id
  ),
  latest_events AS (
    SELECT lr.story_id, MAX(ate.created_at) AS last_event_at
    FROM latest_runs lr
    LEFT JOIN public.ai_trace_events ate ON ate.run_id = lr.run_id
    GROUP BY lr.story_id
  )
  SELECT
    vs.id                                       AS story_id,
    vs.partner_id,
    vs.user_id,
    vs.is_stack_default,
    vs.title,
    vs.status,
    ws.label_i18n_key                           AS status_label_i18n_key,
    ws.sort_order                               AS status_sort_order,
    ws.swimlane_color                           AS status_swimlane_color,
    COALESCE(ws.is_terminal, false)             AS status_is_terminal,
    vs.priority,
    vs.is_starred,
    vs.last_activity_at,
    vs.default_branch,
    lr.run_id                                   AS latest_run_id,
    lr.agent_slug                               AS current_agent_slug,
    lr.run_status                               AS current_run_status,
    le.last_event_at,
    COALESCE(ca.cost_to_date, 0)            AS cost_to_date,
    COALESCE(ca.tokens_to_date, 0)::bigint      AS tokens_to_date,
    ab.cost_limit                           AS budget_cost_limit,
    ab.consumed_cost                        AS budget_consumed,
    CASE
      WHEN ab.id IS NULL THEN NULL
      WHEN (ab.cost_limit IS NOT NULL AND ab.cost_limit > 0
            AND ab.consumed_cost / ab.cost_limit >= 1)
        OR (ab.token_limit IS NOT NULL AND ab.token_limit > 0
            AND ab.consumed_tokens::numeric / ab.token_limit >= 1)
        THEN 'stopped'
      WHEN (ab.cost_limit IS NOT NULL AND ab.cost_limit > 0
            AND ab.consumed_cost / ab.cost_limit >= 0.8)
        OR (ab.token_limit IS NOT NULL AND ab.token_limit > 0
            AND ab.consumed_tokens::numeric / ab.token_limit >= 0.8)
        THEN 'approaching'
      ELSE 'ok'
    END                                         AS budget_state
  FROM visible_stories vs
  LEFT JOIN public.workflow_statuses ws ON ws.status = vs.status
  LEFT JOIN latest_runs lr              ON lr.story_id = vs.id
  LEFT JOIN latest_events le            ON le.story_id = vs.id
  LEFT JOIN cost_agg ca                 ON ca.story_id = vs.id
  LEFT JOIN public.ai_budget ab         ON ab.scope_type = 'story'
                                       AND ab.scope_id = vs.id
                                       AND ab.period = 'lifetime'
  ORDER BY
    -- Stack-default first (pinned lane), then by sort_order, then by recency.
    vs.is_stack_default DESC,
    COALESCE(ws.sort_order, 9999) ASC,
    vs.last_activity_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.kanban_stories_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kanban_stories_view(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kanban_stories_view(uuid) TO service_role;
