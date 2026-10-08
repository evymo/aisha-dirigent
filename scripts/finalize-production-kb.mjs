/**
 * Finalize production setup — seed story context, knowledge chunks,
 * agent decision trees, and verify the complete KB pipeline.
 *
 * Usage: KB_CREATED_BY=<user uuid> node scripts/finalize-production-kb.mjs
 *
 * KB_CREATED_BY — the actor recorded as created_by on the decision trees. It is
 * an explicit input, checked against aisha_auth.users before anything is
 * written. There is no built-in id: the former one belonged to a demo partner
 * the platform seed no longer ships.
 */
import { fileURLToPath } from "url";
import { ANON_KEY, PG_URL as PG_META_URL } from './lib/remote-api.mjs';
import { DIRIGENT_API_URL, N8N_URL, GIT_BASE_URL, LANGFUSE_URL, COOLIFY_URL } from './lib/env.mjs';

// Well-known UUIDs for AISHA's own story
const AISHA_STORY_ID = "a0000000-0000-0000-0000-000000000001";
const AISHA_RULESET_ID = "b0000000-0000-0000-0000-000000000001";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates KB_CREATED_BY (explicit, existing user) — fails loud, never guesses. */
async function resolveCreatedBy() {
  const createdBy = process.env.KB_CREATED_BY ?? "";
  if (!UUID_RE.test(createdBy)) {
    throw new Error(
      "KB_CREATED_BY must be the UUID of an existing aisha_auth.users row (recorded as created_by) — there is no default",
    );
  }
  const rows = await pgQuery(`SELECT id FROM aisha_auth.users WHERE id = '${createdBy}'::uuid`);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`KB_CREATED_BY ${createdBy} does not exist in aisha_auth.users`);
  }
  return createdBy;
}

async function pgQuery(sql) {
  const res = await fetch(PG_META_URL, {
      signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`pg-meta ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log("=== Finalize Production KB ===\n");

  // Resolved before any write, so a missing/unknown actor stops the run up front.
  const createdBy = await resolveCreatedBy();
  console.log(`  created_by: ${createdBy}\n`);

  // ═══════════════════════════════════════════════════════════════
  // Phase 1: Story Ruleset — bind ALL published expert_rules
  // ═══════════════════════════════════════════════════════════════
  console.log("--- Phase 1: Story Ruleset ---");

  const rulesetSQL = `
    INSERT INTO story_rulesets (
      id, story_id, rule_ids, rule_versions,
      context_profile, ruleset_fingerprint, created_at, created_by
    )
    SELECT
      '${AISHA_RULESET_ID}'::uuid,
      '${AISHA_STORY_ID}'::uuid,
      array_agg(er.id ORDER BY er.slug),
      jsonb_object_agg(er.slug, er.version),
      'repo_plus_rules',
      md5(string_agg(er.slug || ':' || er.version::text, ',' ORDER BY er.slug)),
      now(),
      'aisha'
    FROM expert_rules er
    WHERE er.status = 'published'
    HAVING count(*) > 0
    ON CONFLICT (id) DO UPDATE SET
      rule_ids = EXCLUDED.rule_ids,
      rule_versions = EXCLUDED.rule_versions,
      ruleset_fingerprint = EXCLUDED.ruleset_fingerprint
    RETURNING id, array_length(rule_ids, 1) as rule_count
  `;

  try {
    const result = await pgQuery(rulesetSQL);
    if (result.length > 0) {
      console.log(`  ✓ Story ruleset: ${result[0].rule_count} rules bound`);
    } else {
      console.log("  ⚠ Story ruleset: no rules found");
    }
  } catch (err) {
    console.error(`  ✗ Story ruleset: ${err.message}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 2: Story Context — link story to ruleset + build config
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Phase 2: Story Context ---");

  const contextSQL = `
    INSERT INTO story_contexts (
      story_id, ruleset_id,
      mcp_endpoint, build_config, env_hints, updated_at
    ) VALUES (
      '${AISHA_STORY_ID}'::uuid,
      '${AISHA_RULESET_ID}'::uuid,
      '${DIRIGENT_API_URL}/functions/v1/mcp-knowledge-server',
      '${JSON.stringify({
        framework: "react-vite",
        language: "typescript",
        test_runner: "vitest",
        bundler: "vite",
        css: "tailwind",
        db: "supabase-postgresql",
        edge_functions: "deno",
        orchestration: "n8n",
        ide: "vscode-extension",
      })}'::jsonb,
      '${JSON.stringify({
        supabase_url: "${DIRIGENT_API_URL}",
        n8n_url: "${N8N_URL}",
        git_base_url: "${GIT_BASE_URL}",
        langfuse_url: "${LANGFUSE_URL}",
        coolify_url: "${COOLIFY_URL}",
      })}'::jsonb,
      now()
    )
    ON CONFLICT (story_id) DO UPDATE SET
      ruleset_id = EXCLUDED.ruleset_id,
      mcp_endpoint = EXCLUDED.mcp_endpoint,
      build_config = EXCLUDED.build_config,
      env_hints = EXCLUDED.env_hints,
      updated_at = now()
    RETURNING story_id
  `;

  try {
    const result = await pgQuery(contextSQL);
    console.log(`  ✓ Story context created for story ${AISHA_STORY_ID}`);
  } catch (err) {
    console.error(`  ✗ Story context: ${err.message}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 3: Generate knowledge_chunks from knowledge_items
  //          Simple text chunking by splitting body_markdown
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Phase 3: Knowledge Chunks ---");

  // First get knowledge_items that don't have chunks yet
  const items = await pgQuery(`
    SELECT ki.id, ki.title, ki.body_markdown
    FROM knowledge_items ki
    WHERE ki.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_chunks kc
        WHERE kc.knowledge_item_id = ki.id
      )
    ORDER BY ki.created_at
  `);

  console.log(`  Found ${items.length} knowledge_items without chunks`);

  let chunkCount = 0;
  for (const item of items) {
    if (!item.body_markdown) continue;

    // Split by markdown headers (## or ###)
    const sections = item.body_markdown.split(/(?=^#{2,3}\s)/m);
    let chunkIndex = 0;

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed || trimmed.length < 20) continue;

      // Extract section title from first line if it's a header
      const headerMatch = trimmed.match(/^#{2,3}\s+(.+)/);
      const sectionTitle = headerMatch ? headerMatch[1].trim() : null;

      // Estimate token count (~4 chars per token)
      const tokenCount = Math.ceil(trimmed.length / 4);

      // If section is too large, split further by paragraphs
      if (tokenCount > 500) {
        const paragraphs = trimmed.split(/\n\n+/);
        let buffer = "";
        let subIndex = 0;

        for (const para of paragraphs) {
          if (buffer.length + para.length > 1500) {
            if (buffer.trim().length >= 20) {
              await insertChunk(
                item.id,
                chunkIndex++,
                buffer.trim(),
                sectionTitle,
                Math.ceil(buffer.length / 4)
              );
              chunkCount++;
            }
            buffer = para;
          } else {
            buffer += (buffer ? "\n\n" : "") + para;
          }
        }
        if (buffer.trim().length >= 20) {
          await insertChunk(
            item.id,
            chunkIndex++,
            buffer.trim(),
            sectionTitle,
            Math.ceil(buffer.length / 4)
          );
          chunkCount++;
        }
      } else {
        await insertChunk(
          item.id,
          chunkIndex++,
          trimmed,
          sectionTitle,
          tokenCount
        );
        chunkCount++;
      }
    }
  }

  console.log(`  ✓ Generated ${chunkCount} chunks from ${items.length} knowledge items`);

  // ═══════════════════════════════════════════════════════════════
  // Phase 4: Seed agent_decision_trees for core agents
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Phase 4: Agent Decision Trees ---");

  const agents = await pgQuery(
    "SELECT slug, purpose, default_model FROM agent_catalog ORDER BY slug"
  );
  console.log(`  Agent catalog: ${agents.length} agents`);

  // Seed basic decision trees for key agents
  const decisionTrees = [
    {
      slug: "dirigent",
      name: "Dirigent Routing Tree",
      tree: {
        question: "What type of task is this?",
        branches: {
          project_delivery: {
            action: "route",
            agents: ["aisha_planner", "dev_patch", "compliance_gate", "verifier"],
          },
          pr_gate: {
            action: "route",
            agents: ["compliance_gate"],
          },
          chat: {
            action: "route",
            agents: ["librarian"],
          },
          incident: {
            action: "route",
            agents: ["debug_agent", "dev_patch"],
          },
          doc_update: {
            action: "route",
            agents: ["librarian"],
          },
        },
      },
    },
    {
      slug: "compliance_gate",
      name: "Compliance Check Tree",
      tree: {
        question: "What compliance aspect to check?",
        branches: {
          security: {
            check: "RLS enabled, SECURITY DEFINER for anon, no sensitive data in logs",
            rules: ["aisha-security-standards", "aisha-security-definer-pattern"],
          },
          architecture: {
            check: "RPC-only, no .from() queries, explicit columns",
            rules: ["aisha-rpc-only-pattern", "aisha-architecture-patterns"],
          },
          code_hygiene: {
            check: "No emoji, no any, no console.log, no ts-ignore",
            rules: ["aisha-code-hygiene", "aisha-development-laws"],
          },
          i18n: {
            check: "All UI texts through t(), no hardcoded strings",
            rules: ["aisha-i18n-rules", "aisha-i18n-standards"],
          },
          testing: {
            check: "Tests match implementation, vi.mocked() usage",
            rules: ["aisha-testing-rules", "aisha-testing-philosophy"],
          },
        },
      },
    },
  ];

  // Get decision_trees schema first
  const dtSchema = await pgQuery(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'agent_decision_trees' ORDER BY ordinal_position"
  );
  console.log(`  Decision tree columns: ${dtSchema.map((c) => c.column_name).join(", ")}`);

  // Resolve agent_id from slug
  const agentRows = await pgQuery("SELECT id, slug FROM agent_catalog");
  const agentMap = Object.fromEntries(agentRows.map((a) => [a.slug, a.id]));

  for (const dt of decisionTrees) {
    const agentId = agentMap[dt.slug];
    if (!agentId) {
      console.error(`  ✗ Decision tree ${dt.slug}: agent not found in catalog`);
      continue;
    }
    const escapedTree = JSON.stringify(dt.tree).replace(/'/g, "''");
    const escapedName = dt.name.replace(/'/g, "''");

    try {
      await pgQuery(`
        INSERT INTO agent_decision_trees (
          agent_id, tree_name, tree_definition, version, is_active, created_by
        ) VALUES (
          '${agentId}',
          '${escapedName}',
          '${escapedTree}'::jsonb,
          1,
          true,
          '${createdBy}'
        )
        ON CONFLICT DO NOTHING
      `);
      console.log(`  ✓ Decision tree: ${dt.slug} — ${dt.name}`);
    } catch (err) {
      console.error(`  ✗ Decision tree ${dt.slug}: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 5: Update compose_context function
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Phase 5: Verify compose_context ---");

  const composeExists = await pgQuery(
    "SELECT proname FROM pg_proc WHERE proname = 'compose_context' AND pronamespace = 'public'::regnamespace"
  );
  console.log(`  compose_context: ${composeExists.length > 0 ? "exists ✓" : "MISSING ✗"}`);

  // ═══════════════════════════════════════════════════════════════
  // Phase 6: Final Verification
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Phase 6: Final Verification ---");

  const counts = await pgQuery(`
    SELECT 'expert_rules' as tbl, count(*) as cnt FROM expert_rules WHERE status = 'published'
    UNION ALL SELECT 'knowledge_items', count(*) FROM knowledge_items WHERE status = 'active'
    UNION ALL SELECT 'knowledge_chunks', count(*) FROM knowledge_chunks
    UNION ALL SELECT 'agent_catalog', count(*) FROM agent_catalog
    UNION ALL SELECT 'agent_decision_trees', count(*) FROM agent_decision_trees
    UNION ALL SELECT 'story_rulesets', count(*) FROM story_rulesets
    UNION ALL SELECT 'story_contexts', count(*) FROM story_contexts
    UNION ALL SELECT 'context_profiles', count(*) FROM context_profiles WHERE is_active = true
    UNION ALL SELECT 'guild_expertise_areas', count(*) FROM guild_expertise_areas
    ORDER BY tbl
  `);

  console.log("\n  ┌──────────────────────────┬───────┐");
  console.log("  │ Tabulka                  │ Count │");
  console.log("  ├──────────────────────────┼───────┤");
  for (const row of counts) {
    const status = row.cnt > 0 ? "✓" : "✗";
    console.log(
      `  │ ${row.tbl.padEnd(24)} │ ${String(row.cnt).padStart(3)}${status}  │`
    );
  }
  console.log("  └──────────────────────────┴───────┘");

  // Test compose_context
  console.log("\n--- Smoke Test: compose_context ---");
  try {
    const ctx = await pgQuery(`
      SELECT compose_context(
        '${AISHA_STORY_ID}'::uuid,
        'rules_only'
      ) as result
    `);
    if (ctx.length > 0 && ctx[0].result) {
      const result =
        typeof ctx[0].result === "string"
          ? JSON.parse(ctx[0].result)
          : ctx[0].result;
      console.log(`  Profile: ${result.profile}`);
      console.log(`  Token budget: ${result.token_budget}`);
      console.log(`  Tokens used: ${result.tokens_used}`);
      const layers = Object.keys(result.layers || {});
      console.log(`  Layers: ${layers.join(", ") || "(none)"}`);
      if (result.layers?.ruleset?.rules) {
        console.log(
          `  Rules in context: ${result.layers.ruleset.rules.length}`
        );
      }
      console.log("  ✓ compose_context works!");
    } else {
      console.log("  ⚠ compose_context returned empty result");
    }
  } catch (err) {
    console.error(`  ✗ compose_context failed: ${err.message}`);
  }

  // Test mcp_get_compliance_context
  console.log("\n--- Smoke Test: mcp_get_compliance_context ---");
  try {
    const compliance = await pgQuery(`
      SELECT mcp_get_compliance_context('${AISHA_STORY_ID}'::uuid) as result
    `);
    if (compliance.length > 0) {
      const result =
        typeof compliance[0].result === "string"
          ? JSON.parse(compliance[0].result)
          : compliance[0].result;
      const ruleCount = result?.ruleset?.rules?.length || 0;
      console.log(`  Rules in compliance context: ${ruleCount}`);
      console.log(
        `  Fingerprint: ${result?.ruleset?.fingerprint || "none"}`
      );
      console.log("  ✓ Compliance context works!");
    }
  } catch (err) {
    console.error(`  ✗ Compliance context failed: ${err.message}`);
  }

  console.log("\n=== Production KB Finalized ===");
  console.log(`Story ID for AISHA: ${AISHA_STORY_ID}`);
  console.log(
    "Use this story_id in validate commands and compose_context calls."
  );
}

async function insertChunk(
  knowledgeItemId,
  chunkIndex,
  chunkText,
  sectionTitle,
  tokenCount
) {
  const escapedText = chunkText.replace(/'/g, "''");
  const escapedTitle = sectionTitle
    ? `'${sectionTitle.replace(/'/g, "''")}'`
    : "NULL";

  await pgQuery(`
    INSERT INTO knowledge_chunks (
      knowledge_item_id, chunk_index, chunk_text, token_count,
      section_title, source_field, created_at
    ) VALUES (
      '${knowledgeItemId}'::uuid,
      ${chunkIndex},
      '${escapedText}',
      ${tokenCount},
      ${escapedTitle},
      'body',
      now()
    )
    ON CONFLICT DO NOTHING
  `);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
