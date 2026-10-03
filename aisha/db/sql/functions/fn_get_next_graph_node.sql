-- Function: fn_get_next_graph_node
-- Helper for svc-langgraph-runner: given a run + last completed node + transition_key,
-- evaluate graph edges and return the next node descriptor.
-- Encapsulates the edge-evaluation rules so the runner stays thin and DB-side
-- changes (new node types, new edge conditions) propagate uniformly.

CREATE OR REPLACE FUNCTION public.fn_get_next_graph_node(
  p_run_id uuid,
  p_last_node_id text DEFAULT NULL,
  p_transition_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_run                RECORD;
  v_graph              jsonb;
  v_entry_node         text;
  v_next_id            text;
  v_node               jsonb;
  v_edges              jsonb;
  v_edge               jsonb;
  v_condition          text;
  v_default_target     text;
BEGIN
  -- Auth
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id is required';
  END IF;

  -- Load run + graph
  SELECT r.id, r.status, r.workflow_definition_id, d.graph
  INTO v_run
  FROM ai_runs r
  JOIN ai_workflow_definitions d ON d.id = r.workflow_definition_id
  WHERE r.id = p_run_id;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'ai_run % not found or no workflow definition attached', p_run_id;
  END IF;

  v_graph := v_run.graph;
  v_entry_node := v_graph->>'entry';
  v_edges := v_graph->'edges';

  -- ============================================================
  -- Case 1: first node (no last_node_id) → return entry
  -- ============================================================
  IF p_last_node_id IS NULL THEN
    IF v_entry_node IS NULL THEN
      RAISE EXCEPTION 'Graph has no entry node (graph.entry missing)';
    END IF;

    SELECT n
    INTO v_node
    FROM jsonb_array_elements(v_graph->'nodes') n
    WHERE n->>'id' = v_entry_node;

    IF v_node IS NULL THEN
      RAISE EXCEPTION 'Graph entry node "%" not found in nodes[]', v_entry_node;
    END IF;

    RETURN jsonb_build_object(
      'next_node', v_node,
      'is_entry', true,
      'is_terminal', false
    );
  END IF;

  -- ============================================================
  -- Case 2: follow an edge from p_last_node_id
  -- ============================================================
  -- Priority order:
  --   1. Edge whose 'condition' contains the transition_key (heuristic match)
  --   2. Edge with no condition (default fall-through)
  -- The runner evaluates conditions in code; this RPC returns ALL candidate
  -- edges from p_last_node_id so runner can pick the matching one.

  -- Strategy: return descriptor of next candidate edges + their targets
  -- The runner will evaluate conditions JS-side (more flexible than SQL).
  -- We return: { candidates: [{edge, target_node}], default_target_node }

  -- Find matching edges
  WITH matching AS (
    SELECT
      e.value AS edge
    FROM jsonb_array_elements(v_edges) e
    WHERE e.value->>'from' = p_last_node_id
  )
  SELECT
    jsonb_build_object(
      'candidates', COALESCE(jsonb_agg(
        jsonb_build_object(
          'edge', m.edge,
          'target_node', (
            SELECT n
            FROM jsonb_array_elements(v_graph->'nodes') n
            WHERE n->>'id' = m.edge->>'to'
            LIMIT 1
          )
        )
        ORDER BY (m.edge->>'condition') IS NULL  -- conditional edges first, default last
      ), '[]'::jsonb),
      'is_terminal', NOT EXISTS(SELECT 1 FROM matching)
    )
  INTO v_node
  FROM matching m;

  -- If no edges at all, this is a terminal node
  IF v_node IS NULL OR (v_node->>'is_terminal')::boolean THEN
    RETURN jsonb_build_object(
      'next_node', NULL,
      'is_entry', false,
      'is_terminal', true,
      'message', format('No outgoing edges from node "%s"; run complete.', p_last_node_id)
    );
  END IF;

  RETURN v_node;
END;
$$;

COMMENT ON FUNCTION public.fn_get_next_graph_node(uuid, text, text) IS
  'Helper for svc-langgraph-runner: returns next node candidates given last completed '
  'node + transition_key. Runner evaluates JS-side conditions on candidates. '
  'When p_last_node_id IS NULL, returns the entry node.';

REVOKE ALL ON FUNCTION public.fn_get_next_graph_node(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_next_graph_node(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_next_graph_node(uuid, text, text) TO service_role;
