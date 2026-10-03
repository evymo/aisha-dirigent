-- Function: consult_decision_tree

CREATE OR REPLACE FUNCTION public.consult_decision_tree(p_agent_slug text, p_tree_name text, p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tree jsonb;
  v_nodes jsonb;
  v_current_id text;
  v_current_node jsonb;
  v_node_type text;
  v_field text;
  v_field_value text;
  v_branches jsonb;
  v_branch jsonb;
  v_matched boolean;
  v_max_iterations integer := 20;
  v_iteration integer := 0;
BEGIN
  -- Fetch the tree
  SELECT adt.tree_definition INTO v_tree
  FROM agent_decision_trees adt
  JOIN agent_catalog ac ON ac.id = adt.agent_id
  WHERE ac.slug = p_agent_slug
    AND adt.tree_name = p_tree_name
    AND adt.is_active = true;

  IF v_tree IS NULL THEN
    RETURN jsonb_build_object('status', 'no_tree', 'message', 'No active decision tree found');
  END IF;

  v_nodes := v_tree->'nodes';
  v_current_id := v_tree->>'root';

  -- Walk the tree
  WHILE v_iteration < v_max_iterations LOOP
    v_iteration := v_iteration + 1;

    -- Find current node
    SELECT node INTO v_current_node
    FROM jsonb_array_elements(v_nodes) AS node
    WHERE node->>'id' = v_current_id;

    IF v_current_node IS NULL THEN
      RETURN jsonb_build_object('status', 'error', 'message', 'Node not found: ' || v_current_id);
    END IF;

    v_node_type := v_current_node->>'type';

    -- Terminal nodes
    IF v_node_type IN ('action', 'escalation') THEN
      RETURN v_current_node || jsonb_build_object('status', 'resolved', 'iterations', v_iteration);
    END IF;

    -- Condition node: evaluate branches
    IF v_node_type = 'condition' THEN
      v_field := v_current_node->>'field';
      -- Extract value from context using dot notation (e.g., "task.category")
      v_field_value := p_context #>> string_to_array(v_field, '.');
      v_branches := v_current_node->'branches';
      v_matched := false;

      FOR v_branch IN SELECT * FROM jsonb_array_elements(v_branches) LOOP
        IF v_branch->>'value' = v_field_value OR v_branch->>'value' = 'default' THEN
          v_current_id := v_branch->>'next';
          v_matched := true;
          EXIT;
        END IF;
      END LOOP;

      IF NOT v_matched THEN
        -- Try default branch
        FOR v_branch IN SELECT * FROM jsonb_array_elements(v_branches) LOOP
          IF v_branch->>'value' = 'default' THEN
            v_current_id := v_branch->>'next';
            v_matched := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF NOT v_matched THEN
        RETURN jsonb_build_object('status', 'no_match', 'message', 'No matching branch for field ' || v_field || ' = ' || COALESCE(v_field_value, 'NULL'));
      END IF;
    ELSE
      RETURN jsonb_build_object('status', 'error', 'message', 'Unknown node type: ' || v_node_type);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'error', 'message', 'Max iterations reached');
END;
$function$;

REVOKE ALL ON FUNCTION consult_decision_tree(p_agent_slug text, p_tree_name text, p_context jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consult_decision_tree(text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION consult_decision_tree(text,text,jsonb) TO service_role;
