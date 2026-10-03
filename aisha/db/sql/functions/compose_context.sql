-- Source of Truth: compose_context
-- Purpose: Build a context bundle for an AI agent based on a context profile.
--          Assembles project context, rulesets, KB retrieval, agent memory, trace memory,
--          governance (TAO) and personality (Psyché) layers within a token budget.
--          Traces the compose event.
--          Phase E: Query-based rule relevance scoring — only pertinent rules in system prompt.
--          Psyché module: personality_context layer for character DNA (unconditional).
-- Used by: ai-context-composer edge function, orchestrationBridge.ts
-- Migration: 20260216_aisha_phase3_router.sql (original), 20260309091500 (agent memory),
--            20260312214929 (fix GROUP BY + LIMIT bugs), 20260329100000 (project-scoped KB + scoring),
--            20260405133819 (Phase E: query-based rule relevance filtering),
--            20260603002713 (Step 7.3: graph_context retrieval layer — seeds from
--                            kb_retrieval, walks fn_graph_multihop; enabled on RAG profiles)

-- Drop the legacy 5-arg signature so the requester-scoped 6-arg version below is
-- the ONLY overload. Without this, an upgrade-in-place would leave both — and a
-- PostgREST call omitting p_requester_id could resolve to the old unguarded
-- function, re-opening LEAK 2. No-op on a fresh baseline apply (IF EXISTS).
DROP FUNCTION IF EXISTS public.compose_context(uuid, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.compose_context(
  p_story_id uuid,
  p_context_profile_slug text DEFAULT 'repo_plus_rules'::text,
  p_run_id uuid DEFAULT NULL::uuid,
  p_query text DEFAULT NULL::text,
  p_agent_slug text DEFAULT NULL::text,
  p_requester_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_profile RECORD;
  v_bundle jsonb := '{}'::jsonb;
  v_project_ctx jsonb;
  v_project_preview_ctx jsonb;
  v_ruleset_ctx jsonb;
  v_kb_ctx jsonb;
  v_memory_ctx jsonb;
  v_agent_memory_ctx jsonb;
  v_governance_ctx jsonb;
  v_psyche_ctx jsonb;
  v_tokens_used int := 0;
  v_layer text;
  v_user_id uuid;
  v_requester uuid;
  -- Phase A: project scoping variables
  v_story_domain text[];
  v_story_tech_stack text[];
  v_project_tags text[];
  v_max_chunks int;
  -- Phase E: query-based rule filtering
  v_query_lower text;
BEGIN
  -- ── RBAC: a story-scoped composition requires a verified requester ─────────
  -- compose_context is SECURITY DEFINER and GRANTed to service_role, so its internal
  -- mcp_search_knowledge_v2(p_story_id) call runs as service_role and BYPASSES v2's own
  -- per-story RBAC. The MCP tool surface is safe (it runs as the user via rpcUserClaims),
  -- but the agent path (orchestrationBridge.enrichWithAishaContext) reaches this through a
  -- service-role client and could otherwise be pointed at ANY p_story_id and leak that
  -- story's KB / learnings / graph layers — a cross-tenant RAG leak.
  --
  -- Fail-closed: when p_story_id is set, a requester WITH access is required. Authenticated
  -- direct callers fall back to auth.uid(); service-role orchestration MUST pass
  -- p_requester_id. Unlike a permissive `p_requester_id IS NOT NULL` skip, a NULL identity on
  -- a story-scoped call is REFUSED — a genuine background job passes an explicit system
  -- principal as p_requester_id rather than relying on a silent service-role bypass.
  IF p_story_id IS NOT NULL THEN
    v_requester := COALESCE(p_requester_id, auth.uid());
    IF v_requester IS NULL THEN
      RAISE EXCEPTION 'compose_context: p_requester_id required for a story-scoped composition'
        USING ERRCODE = '42501';
    END IF;
    IF NOT (
      public.is_admin_or_staff(v_requester)
      OR EXISTS (SELECT 1 FROM public.partner_stories ps WHERE ps.id = p_story_id AND ps.user_id = v_requester)
      OR EXISTS (SELECT 1 FROM public.story_participants sp WHERE sp.story_id = p_story_id AND sp.user_id = v_requester)
    ) THEN
      RAISE EXCEPTION 'Access denied to story %', p_story_id USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Load profile
  SELECT * INTO v_profile
  FROM context_profiles
  WHERE slug = p_context_profile_slug AND is_active = true;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Context profile not found: %', p_context_profile_slug
      USING ERRCODE = 'P0002';
  END IF;

  -- Try to get user_id and project metadata from the story
  IF p_story_id IS NOT NULL THEN
    SELECT s.user_id, s.domain, s.tech_stack
    INTO v_user_id, v_story_domain, v_story_tech_stack
    FROM partner_stories s
    WHERE s.id = p_story_id;
  END IF;

  -- Phase A: Build project-scoped context tags for KB filtering
  -- Convention: project tags like 'project:acme', domain/tech tags
  v_project_tags := COALESCE(v_story_domain, '{}') || COALESCE(v_story_tech_stack, '{}');

  -- Phase E: Prepare query for rule relevance scoring
  v_query_lower := lower(COALESCE(p_query, ''));

  -- Build each layer in priority order
  FOREACH v_layer IN ARRAY v_profile.priority_order
  LOOP
    -- Respect token budget
    IF v_tokens_used >= v_profile.token_budget THEN
      EXIT;
    END IF;

    CASE v_layer
      WHEN 'project_context' THEN
        IF (v_profile.layers->'project_context'->>'enabled')::boolean THEN
          SELECT mcp_get_story_context(p_story_id) INTO v_project_ctx;
          v_bundle := v_bundle || jsonb_build_object('project_context', v_project_ctx);
          v_tokens_used := v_tokens_used + 500;
        END IF;

      WHEN 'project_preview' THEN
        IF (v_profile.layers->'project_preview'->>'enabled')::boolean AND p_story_id IS NOT NULL THEN
          SELECT ps.project_preview INTO v_project_preview_ctx
          FROM partner_stories ps
          WHERE ps.id = p_story_id;

          IF v_project_preview_ctx IS NOT NULL THEN
            v_bundle := v_bundle || jsonb_build_object('project_preview', v_project_preview_ctx);
            v_tokens_used := v_tokens_used + 300;
          END IF;
        END IF;

      WHEN 'ruleset' THEN
        IF (v_profile.layers->'ruleset'->>'enabled')::boolean THEN
          -- Phase E: Query-based rule relevance filtering.
          -- When p_query is provided, rules are scored by text relevance
          -- so only the most pertinent rules enter the system prompt.
          -- Without query, all rules are equally weighted (score=1).
          SELECT jsonb_build_object(
            'fingerprint', sr.ruleset_fingerprint,
            'rules', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'slug', scored.slug,
                  'title', scored.title,
                  'category', scored.category,
                  'ai_instructions', scored.ai_instructions,
                  'relevance_score', scored.relevance_score
                ) ||
                CASE
                  WHEN (v_profile.layers->'ruleset'->>'include_body')::boolean
                  THEN jsonb_build_object('body_markdown', scored.body_markdown)
                  ELSE '{}'::jsonb
                END
                ORDER BY scored.relevance_score DESC, scored.slug
              )
              FROM (
                -- CTE-like subquery: score each rule once
                SELECT
                  er.slug,
                  er.title,
                  er.category,
                  er.ai_instructions,
                  er.body_markdown,
                  CASE
                    WHEN v_query_lower = '' THEN 1
                    ELSE (
                      -- Title word match: highest signal
                      CASE WHEN v_query_lower ~ ANY(
                        string_to_array(
                          regexp_replace(lower(er.title), '[^a-z0-9]+', '|', 'g'),
                          '|'
                        )
                      ) THEN 10 ELSE 0 END
                      +
                      -- AI instructions: query words (4+ chars) match
                      CASE WHEN lower(COALESCE(er.ai_instructions, '')) ~ ANY(
                        ARRAY(
                          SELECT w FROM unnest(
                            string_to_array(
                              regexp_replace(v_query_lower, '[^a-záčďéěíňóřšťúůýž0-9]+', ' ', 'g'),
                              ' '
                            )
                          ) AS w
                          WHERE length(w) >= 4
                        )
                      ) THEN 5 ELSE 0 END
                      +
                      -- Category match
                      CASE WHEN v_query_lower LIKE '%' || replace(lower(er.category::text), '_', ' ') || '%'
                        OR v_query_lower LIKE '%' || replace(lower(er.category::text), '_', '%') || '%'
                      THEN 3 ELSE 0 END
                      +
                      -- Base: every rule gets minimum 1
                      1
                    )
                  END AS relevance_score
                FROM expert_rules er
                WHERE er.id = ANY(sr.rule_ids)
                  AND er.status = 'published'
                ORDER BY relevance_score DESC, er.slug
                LIMIT COALESCE((v_profile.layers->'ruleset'->>'max_rules')::int, 20)
              ) scored
              -- Phase E: When query is present, filter out irrelevant rules (base-only score).
              -- min_relevance_score in profile overrides default threshold of 2.
              WHERE CASE
                WHEN v_query_lower = '' THEN true  -- no query → keep all rules
                ELSE scored.relevance_score >= COALESCE(
                  (v_profile.layers->'ruleset'->>'min_relevance_score')::int, 2
                )
              END
            ), '[]'::jsonb)
          ) INTO v_ruleset_ctx
          FROM story_contexts sc
          JOIN story_rulesets sr ON sr.id = sc.ruleset_id
          WHERE sc.story_id = p_story_id;

          IF v_ruleset_ctx IS NOT NULL THEN
            v_bundle := v_bundle || jsonb_build_object('ruleset', v_ruleset_ctx);
            v_tokens_used := v_tokens_used + COALESCE(
              (SELECT count(*) FROM jsonb_array_elements(v_ruleset_ctx->'rules')) *
                CASE WHEN (v_profile.layers->'ruleset'->>'include_body')::boolean THEN 300 ELSE 100 END,
              0
            );
          END IF;
        END IF;

      WHEN 'kb_retrieval' THEN
        IF (v_profile.layers->'kb_retrieval'->>'enabled')::boolean AND p_query IS NOT NULL THEN
          v_max_chunks := COALESCE((v_profile.layers->'kb_retrieval'->>'max_chunks')::int, 10);

          -- Phase D: Use mcp_search_knowledge_v2 scoring instead of naive created_at ordering
          -- Phase A: Filter by project tags from story metadata
          SELECT jsonb_build_object(
            'chunks', COALESCE(
              (SELECT jsonb_agg(jsonb_build_object(
                'knowledge_item_id', (r->>'knowledge_item_id')::uuid,
                'title', r->>'title',
                'chunk_text', r->>'chunk_text',
                'source_slug', r->>'source_slug',
                'score', (r->>'score')::float
              ))
              FROM (
                SELECT jsonb_array_elements(
                  mcp_search_knowledge_v2(
                    p_query_embedding := NULL,  -- No embedding in compose_context (text-only search)
                    p_query_text := p_query,
                    p_context_tags := v_project_tags,
                    p_limit := v_max_chunks,
                    p_story_id := p_story_id,   -- Per-story isolation: search scoped to this story + globals
                    p_audience_user_id := v_requester  -- Brick6 tier-ACL: gate by the requesting user's tier
                  )
                ) AS r
              ) sub),
              '[]'::jsonb
            )
          ) INTO v_kb_ctx;

          v_bundle := v_bundle || jsonb_build_object('kb_retrieval', v_kb_ctx);
          v_tokens_used := v_tokens_used +
            COALESCE((SELECT count(*) FROM jsonb_array_elements(v_kb_ctx->'chunks')) * 150, 0);
        END IF;

      WHEN 'agent_memory' THEN
        IF (v_profile.layers->'agent_memory'->>'enabled')::boolean AND p_agent_slug IS NOT NULL THEN
          -- Subquery so LIMIT actually restricts rows before aggregation
          SELECT COALESCE(
            (SELECT jsonb_agg(sub.obj) FROM (
              SELECT jsonb_build_object(
                'type', am.memory_type,
                'content', am.content,
                'importance', am.importance
              ) AS obj
              FROM agent_memories am
              WHERE am.agent_slug = p_agent_slug
                AND (am.user_id IS NULL OR am.user_id = v_user_id)
                AND am.importance >= COALESCE((v_profile.layers->'agent_memory'->>'min_importance')::int, 3)
                AND (am.expires_at IS NULL OR am.expires_at > now())
              ORDER BY am.importance DESC, am.created_at DESC
              LIMIT COALESCE((v_profile.layers->'agent_memory'->>'max_memories')::int, 10)
            ) sub),
            '[]'::jsonb
          ) INTO v_agent_memory_ctx;

          IF jsonb_array_length(v_agent_memory_ctx) > 0 THEN
            v_bundle := v_bundle || jsonb_build_object('agent_memory', v_agent_memory_ctx);
            -- Estimate: ~50 tokens per memory
            v_tokens_used := v_tokens_used + jsonb_array_length(v_agent_memory_ctx) * 50;
          END IF;
        END IF;

      WHEN 'memory' THEN
        IF (v_profile.layers->'memory'->>'enabled')::boolean AND p_run_id IS NOT NULL THEN
          -- Subquery so ORDER BY + LIMIT apply to rows before jsonb_agg()
          SELECT jsonb_build_object(
            'events', COALESCE(
              (SELECT jsonb_agg(sub.obj) FROM (
                SELECT jsonb_build_object(
                  'event_type', ate.event_type,
                  'status', ate.status,
                  'operation', ate.operation,
                  'agent_slug', ate.agent_slug,
                  'created_at', ate.created_at
                ) AS obj
                FROM ai_trace_events ate
                WHERE ate.run_id = p_run_id
                ORDER BY ate.created_at DESC
                LIMIT COALESCE((v_profile.layers->'memory'->>'max_events')::int, 10)
              ) sub),
              '[]'::jsonb
            )
          ) INTO v_memory_ctx;

          v_bundle := v_bundle || jsonb_build_object('memory', v_memory_ctx);
          v_tokens_used := v_tokens_used +
            COALESCE((SELECT count(*) FROM jsonb_array_elements(v_memory_ctx->'events')) * 50, 0);
        END IF;

      ELSE
        -- =====================================================================
        -- Named brain module layers (governance_context, psyche_context)
        -- These are unconditional — they define AISHA's core identity.
        -- =====================================================================

        -- TAO: governance_context — philosophical foundation, risk/escalation decisions
        IF v_layer = 'governance_context' THEN
          SELECT jsonb_build_object(
            'tao_principles', fn_get_tao_principles()
          ) INTO v_governance_ctx;

          IF v_governance_ctx IS NOT NULL AND
             jsonb_array_length(v_governance_ctx->'tao_principles') > 0 THEN
            v_bundle := v_bundle || jsonb_build_object('governance_context', v_governance_ctx);
            v_tokens_used := v_tokens_used +
              jsonb_array_length(v_governance_ctx->'tao_principles') * 30;
          END IF;
        END IF;

        -- Psyché: psyche_context — character DNA, behavioral patterns, warmth
        -- Unconditional: personality shapes EVERY response, not just governance.
        IF v_layer = 'psyche_context' THEN
          SELECT jsonb_build_object(
            'psyche_traits', fn_get_psyche_traits()
          ) INTO v_psyche_ctx;

          IF v_psyche_ctx IS NOT NULL AND
             jsonb_array_length(v_psyche_ctx->'psyche_traits') > 0 THEN
            v_bundle := v_bundle || jsonb_build_object('psyche_context', v_psyche_ctx);
            -- ~40 tokens per trait (includes ai_instructions + cluster)
            v_tokens_used := v_tokens_used +
              jsonb_array_length(v_psyche_ctx->'psyche_traits') * 40;
          END IF;
        END IF;

        -- Hippocampus learnings: pattern→resolution memories from prior reflection runs.
        -- Reuse-tracked: every retrieval touches updated_at + audits to audit_journal,
        -- enabling fn_maybe_promote_learning to promote to expert_rules.
        -- Note: requires p_query (text used for cheap server-side embedding via fn_search_learnings).
        IF v_layer = 'learnings' THEN
          IF (v_profile.layers->'learnings'->>'enabled')::boolean AND p_query IS NOT NULL THEN
            DECLARE
              v_learnings_ctx jsonb;
              v_max int := COALESCE((v_profile.layers->'learnings'->>'max_learnings')::int, 5);
              v_min_importance int := COALESCE((v_profile.layers->'learnings'->>'min_importance')::int, 3);
              v_query_embedding vector(1024);
            BEGIN
              -- Get embedding for query if knowledge_embeddings pipeline is available.
              -- Fallback: skip when embedding not derivable (caller should pre-compute).
              BEGIN
                SELECT ke.embedding
                INTO v_query_embedding
                FROM knowledge_embeddings ke
                JOIN knowledge_chunks kc ON kc.id = ke.chunk_id
                JOIN knowledge_items ki ON ki.id = kc.knowledge_item_id
                WHERE lower(kc.chunk_text) LIKE '%' || lower(p_query) || '%'
                LIMIT 1;
              EXCEPTION WHEN OTHERS THEN
                v_query_embedding := NULL;
              END;

              IF v_query_embedding IS NOT NULL THEN
                v_learnings_ctx := fn_search_learnings(
                  p_query_embedding := v_query_embedding,
                  p_story_id := p_story_id,
                  p_agent_slug := COALESCE(p_agent_slug, 'aisha'),
                  p_limit := v_max,
                  p_min_importance := v_min_importance
                );

                IF v_learnings_ctx IS NOT NULL AND jsonb_array_length(v_learnings_ctx) > 0 THEN
                  v_bundle := v_bundle || jsonb_build_object('learnings', v_learnings_ctx);
                  -- ~60 tokens per learning (content + critic context)
                  v_tokens_used := v_tokens_used + jsonb_array_length(v_learnings_ctx) * 60;
                END IF;
              END IF;
            END;
          END IF;
        END IF;

        -- Knowledge graph: the concepts/rules/memories the just-retrieved KB items
        -- connect to. Seeds from the kb_retrieval chunks (v_kb_ctx) → graph_nodes →
        -- fn_graph_multihop. Requires kb_retrieval to run earlier in priority_order so
        -- v_kb_ctx is populated. Reuses the exact traversal proven by
        -- fn_get_run_graph_context (Step 7.3) — here applied at compose time so the LLM
        -- can reason over the graph, not just see it in the explainability panel.
        IF v_layer = 'graph_context' THEN
          IF (v_profile.layers->'graph_context'->>'enabled')::boolean
             AND v_kb_ctx IS NOT NULL
             AND jsonb_array_length(COALESCE(v_kb_ctx->'chunks', '[]'::jsonb)) > 0 THEN
            DECLARE
              v_graph_ctx jsonb;
              -- Graph traversal depth/per_seed are governance-relevant reasoning
              -- budget → the typed, CHECK-constrained context_profiles columns are the
              -- single SoT (queryable by the resolver/admission), NOT the layers JSONB.
              -- fn_get_run_graph_context (explainability panel) reads the same columns,
              -- so panel-depth == retrieval-depth. max_edges stays per-layer JSONB config.
              v_graph_depth int := v_profile.graph_depth;
              v_graph_per_seed int := v_profile.graph_per_seed;
              v_graph_max int := COALESCE(
                (v_profile.layers->'graph_context'->>'max_edges')::int, 20);
            BEGIN
              SELECT COALESCE(
                       jsonb_agg(e.obj ORDER BY e.confidence DESC NULLS LAST, e.depth ASC),
                       '[]'::jsonb)
              INTO v_graph_ctx
              FROM (
                WITH seeds AS (
                  SELECT DISTINCT ON (gn.id)
                         gn.id          AS seed_id,
                         gn.entity_label AS seed_label
                  FROM jsonb_array_elements(v_kb_ctx->'chunks') AS c
                  JOIN graph_nodes gn
                    ON gn.source_table = 'knowledge_items'
                   AND gn.source_id = (c->>'knowledge_item_id')::uuid
                  ORDER BY gn.id,
                           (gn.story_id IS NOT DISTINCT FROM p_story_id) DESC,
                           gn.created_at ASC
                ),
                hops AS (
                  SELECT s.seed_label,
                         h.target_label,
                         h.target_type,
                         h.depth,
                         h.cumulative_confidence,
                         h.last_relationship
                  FROM seeds s
                  CROSS JOIN LATERAL public.fn_graph_multihop(
                    s.seed_id, v_graph_depth, NULL::text[], p_story_id, v_graph_per_seed
                  ) h
                  WHERE h.depth > 0
                )
                SELECT jsonb_build_object(
                         'from',       hops.seed_label,
                         'rel',        hops.last_relationship,
                         'to',         hops.target_label,
                         'type',       hops.target_type,
                         'depth',      hops.depth,
                         'confidence', round(hops.cumulative_confidence, 3)
                       ) AS obj,
                       hops.cumulative_confidence AS confidence,
                       hops.depth                 AS depth
                FROM hops
                ORDER BY hops.cumulative_confidence DESC NULLS LAST, hops.depth ASC
                LIMIT v_graph_max
              ) e;

              IF v_graph_ctx IS NOT NULL AND jsonb_array_length(v_graph_ctx) > 0 THEN
                v_bundle := v_bundle || jsonb_build_object('graph_context', v_graph_ctx);
                -- ~25 tokens per edge (from/rel/to/type/confidence)
                v_tokens_used := v_tokens_used + jsonb_array_length(v_graph_ctx) * 25;
              END IF;
            END;
          END IF;
        END IF;

        -- Unknown layer, skip
    END CASE;
  END LOOP;

  -- Trace the compose event if we have a run
  IF p_run_id IS NOT NULL THEN
    INSERT INTO ai_trace_events (run_id, event_type, operation, status, response_summary)
    VALUES (p_run_id, 'context_compose', 'compose_context', 'ok',
      jsonb_build_object('profile', p_context_profile_slug, 'tokens_used', v_tokens_used, 'agent_slug', p_agent_slug)
    );
  END IF;

  RETURN jsonb_build_object(
    'profile', p_context_profile_slug,
    'token_budget', v_profile.token_budget,
    'tokens_used', v_tokens_used,
    'layers', v_bundle,
    'profile_layers', v_profile.layers
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.compose_context(uuid, text, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compose_context(uuid, text, uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compose_context(uuid, text, uuid, text, text, uuid) TO service_role;
