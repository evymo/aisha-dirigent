/**
 * Knowledge Import Script
 *
 * Imports knowledge-extraction/ Markdown documents into the expert_rules table
 * as publishable expert rules. Each document becomes an expert rule with
 * appropriate category, expertise area, and AI context tags.
 *
 * Usage:
 *   PGPASSWORD=postgres npx ts-node scripts/import-knowledge-to-expert-rules.ts
 *
 * Or via psql with the generated SQL (see --sql-only flag).
 *
 * @module
 */

/**
 * Mapping of knowledge-extraction files to expert rule metadata.
 * Each entry defines how a Markdown document maps to expert_rules columns.
 */
const KNOWLEDGE_DOCUMENTS: Array<{
  file: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  expertise_area_slug: string;
  ai_context_tags: string[];
}> = [
  {
    file: "DEVELOPMENT_LAWS.md",
    slug: "aisha-development-laws",
    title: "Evymo Development Laws",
    summary:
      "Core development laws — what MUST be done and what MUST NOT in Evymo platform development. RPC-only data access, no sensitive data in logs, mandatory i18n, proper TypeScript usage.",
    category: "coding_standard",
    expertise_area_slug: "fullstack",
    ai_context_tags: [
      "typescript",
      "react",
      "supabase",
      "rpc",
      "security",
      "i18n",
      "development-laws",
      "evymo",
    ],
  },
  {
    file: "ARCHITECTURE_PATTERNS.md",
    slug: "aisha-architecture-patterns",
    title: "Evymo Architecture Patterns",
    summary:
      "Project structuring, layers, responsibilities. How to organize React + Supabase application with hooks, components, pages, and shared utilities.",
    category: "architecture_pattern",
    expertise_area_slug: "frontend-development",
    ai_context_tags: [
      "react",
      "architecture",
      "project-structure",
      "hooks",
      "components",
      "supabase",
      "evymo",
    ],
  },
  {
    file: "API_COMMUNICATION.md",
    slug: "aisha-api-communication",
    title: "Evymo API Communication Patterns",
    summary:
      "How to communicate with Supabase API exclusively through hooks. RPC-only pattern, TanStack Query integration, Zod validation, auth flow.",
    category: "api_design",
    expertise_area_slug: "api-integrations",
    ai_context_tags: [
      "supabase",
      "rpc",
      "tanstack-query",
      "zod",
      "react-hooks",
      "api",
      "data-fetching",
      "evymo",
    ],
  },
  {
    file: "HOOKS_PATTERNS.md",
    slug: "aisha-hooks-patterns",
    title: "Evymo Hook Design Patterns",
    summary:
      "Design patterns for React hooks — templates, conventions, Zod validation, TanStack Query mutations, error handling, barrel exports.",
    category: "integration_pattern",
    expertise_area_slug: "frontend-development",
    ai_context_tags: [
      "react",
      "hooks",
      "typescript",
      "zod",
      "tanstack-query",
      "testing",
      "design-patterns",
      "evymo",
    ],
  },
  {
    file: "TESTING_PHILOSOPHY.md",
    slug: "aisha-testing-philosophy",
    title: "Evymo Testing Philosophy",
    summary:
      "What to test, when, how, and why — 4 test levels. Mock patterns, vitest configuration, hook testing with renderHook, gate tests.",
    category: "testing_strategy",
    expertise_area_slug: "testing-qa",
    ai_context_tags: [
      "vitest",
      "testing",
      "react-testing",
      "mocking",
      "gate-tests",
      "hooks",
      "tdd",
      "evymo",
    ],
  },
  {
    file: "CODE_QUALITY_GATES.md",
    slug: "aisha-code-quality-gates",
    title: "Evymo Code Quality Gates",
    summary:
      "CI gate tests, code hygiene, what must pass before merge. ESLint rules, TypeScript strictness, emoji ban, i18n completeness, accessibility.",
    category: "coding_standard",
    expertise_area_slug: "testing-qa",
    ai_context_tags: [
      "ci",
      "quality",
      "eslint",
      "typescript",
      "gate-tests",
      "code-review",
      "evymo",
    ],
  },
  {
    file: "SECURITY_STANDARDS.md",
    slug: "aisha-security-standards",
    title: "Evymo Security Standards",
    summary:
      "Security patterns — sensitive data protection, safe logging, authentication, RLS policies, SECURITY DEFINER functions, consent management.",
    category: "security_practice",
    expertise_area_slug: "security",
    ai_context_tags: [
      "security",
      "rls",
      "authentication",
      "logging",
      "owasp",
      "sensitive-data",
      "supabase",
      "evymo",
    ],
  },
  {
    file: "i18n_STANDARDS.md",
    slug: "aisha-i18n-standards",
    title: "Evymo i18n Standards",
    summary:
      "Internationalization — every user-facing text through translations. Segment structure, DeepL integration, bracket detection, no hardcoded fallbacks.",
    category: "coding_standard",
    expertise_area_slug: "frontend-development",
    ai_context_tags: [
      "i18n",
      "translations",
      "react-i18next",
      "deepl",
      "localization",
      "evymo",
    ],
  },
  {
    file: "PROJECT_COMPLEXITY_TRACKING.md",
    slug: "aisha-project-complexity-tracking",
    title: "Evymo Project Complexity Tracking",
    summary:
      "Tracking project complexity, task management, backlog organization, progress measurement for AI-assisted development.",
    category: "project_management",
    expertise_area_slug: "project-management",
    ai_context_tags: [
      "project-management",
      "complexity",
      "task-tracking",
      "backlog",
      "ai-development",
      "evymo",
    ],
  },
  {
    file: "COMMIT_WORKFLOW.md",
    slug: "aisha-commit-workflow",
    title: "Evymo Commit Workflow",
    summary:
      "Git commit conventions, PR workflow, pre-commit hooks, conventional commits, branch strategy for Evymo platform.",
    category: "devops_pipeline",
    expertise_area_slug: "devops-infrastructure",
    ai_context_tags: [
      "git",
      "commits",
      "pr-workflow",
      "conventional-commits",
      "pre-commit",
      "ci-cd",
      "evymo",
    ],
  },
  {
    file: "COOLIFY_OPERATIONS.md",
    slug: "aisha-coolify-operations",
    title: "Coolify Operations & API Patterns",
    summary:
      "Provozní pravidla pro Coolify: API vzory, domain management, stack lifecycle, running:unhealthy diagnostika, HTTP health checks.",
    category: "devops_pipeline",
    expertise_area_slug: "devops-infrastructure",
    ai_context_tags: [
      "coolify",
      "operations",
      "api",
      "deployment",
      "domains",
      "healthcheck",
      "troubleshooting",
      "devops",
      "evymo",
    ],
  },
  {
    file: "SSO_OIDC_PATTERNS.md",
    slug: "aisha-sso-oidc-patterns",
    title: "SSO & OIDC Integration Patterns",
    summary:
      "Keycloak OIDC integrace: OAuth2 Proxy pattern, PKCE constraints, Langfuse/Appsmith OIDC.",
    category: "security_practice",
    expertise_area_slug: "security",
    ai_context_tags: [
      "sso",
      "oidc",
      "keycloak",
      "oauth2-proxy",
      "authentication",
      "security",
      "evymo",
    ],
  },
];

type KnowledgeDocument = (typeof KNOWLEDGE_DOCUMENTS)[number];

/** Escape a value for a single-quoted SQL literal. */
function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** The ai_instructions directive carried by an imported knowledge rule. */
function aiInstructionsFor(doc: KnowledgeDocument): string {
  return `This knowledge document defines ${doc.title}. Follow these guidelines when working on the Evymo platform.`;
}

/**
 * Build the idempotent import SQL for the knowledge documents.
 *
 * `resolveBody` supplies each document's body_markdown — real file content in the
 * Node path, a placeholder in the Deno path (which does not read the tree). A
 * document whose body resolves to null is skipped.
 *
 * The whole batch runs inside ONE DO block that resolves the authoring partner
 * once and skips gracefully when the partner bootstrap has not run — the same
 * contract as aisha/db/seed/core/38_anthropic_operating_principles.sql.
 * author_partner_id is NOT NULL, so without that guard every insert fails.
 *
 * Dollar-quoted with $import$ rather than $$ so a document containing `$$` in a
 * fenced code block cannot terminate the block early.
 *
 * Single generator on purpose: this file previously carried two near-identical
 * copies of the statement builder, which is how the category values drifted out
 * of expert_rule_category unnoticed in both at once.
 */
function buildImportSQL(resolveBody: (doc: KnowledgeDocument) => string | null): string {
  const out: string[] = [
    "-- =============================================================================",
    "-- Knowledge Import: knowledge-extraction/ → expert_rules",
    "-- Generated by scripts/import-knowledge-to-expert-rules.ts — do not edit by hand.",
    "-- =============================================================================",
    "-- Idempotent: ON CONFLICT (slug) DO UPDATE — safe to re-run.",
    "-- Skips gracefully when the partner bootstrap has not run yet.",
    "",
    "DO $import$",
    "DECLARE",
    "  v_partner_id uuid;",
    "BEGIN",
    "  SELECT id INTO v_partner_id FROM partner_profiles ORDER BY created_at LIMIT 1;",
    "  IF v_partner_id IS NULL THEN",
    "    RAISE NOTICE 'No partner_profiles found — skipping knowledge import (re-run after partner bootstrap).';",
    "    RETURN;",
    "  END IF;",
    "",
  ];

  for (const doc of KNOWLEDGE_DOCUMENTS) {
    const body = resolveBody(doc);
    if (body === null) continue;

    const tagsArray = doc.ai_context_tags.map((t) => `'${sqlLiteral(t)}'`).join(", ");

    out.push(
      `  -- Import: ${doc.file}`,
      `  INSERT INTO expert_rules (`,
      `    slug, title, summary, body_markdown, category,`,
      `    expertise_area_id, author_partner_id, visibility,`,
      `    ai_instructions, ai_context_tags, status, is_verified, version`,
      `  ) VALUES (`,
      `    '${sqlLiteral(doc.slug)}',`,
      `    '${sqlLiteral(doc.title)}',`,
      `    '${sqlLiteral(doc.summary)}',`,
      `    '${sqlLiteral(body)}',`,
      `    '${doc.category}'::expert_rule_category,`,
      `    (SELECT id FROM guild_expertise_areas WHERE slug = '${sqlLiteral(doc.expertise_area_slug)}'),`,
      `    v_partner_id,`,
      `    'public',`,
      `    '${sqlLiteral(aiInstructionsFor(doc))}',`,
      `    ARRAY[${tagsArray}],`,
      `    'published',`,
      `    true,`,
      `    1`,
      `  ) ON CONFLICT (slug) DO UPDATE SET`,
      `    title = EXCLUDED.title,`,
      `    summary = EXCLUDED.summary,`,
      `    body_markdown = EXCLUDED.body_markdown,`,
      `    category = EXCLUDED.category,`,
      `    expertise_area_id = EXCLUDED.expertise_area_id,`,
      `    ai_instructions = EXCLUDED.ai_instructions,`,
      `    ai_context_tags = EXCLUDED.ai_context_tags,`,
      `    status = 'published',`,
      `    updated_at = now();`,
      "",
    );
  }

  out.push("END", "$import$;", "");
  return out.join("\n");
}

// Main execution
if (typeof Deno !== "undefined") {
  // Deno cannot read the knowledge tree here — emit the shape with placeholder bodies.
  console.log(buildImportSQL((doc) => `-- Content loaded from ${doc.file} --`));
  console.log("-- To load actual Markdown content, run the Node.js importer:");
  console.log("-- npx tsx scripts/import-knowledge-to-expert-rules.ts");
} else {
  // Running in Node.js — full import with file reading.
  // An import that fails must not exit 0: this wire was dead for months precisely
  // because every failure was swallowed and reported as a successful run.
  importWithNodeJS().catch((err) => {
    console.error(`❌ Import failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

async function importWithNodeJS(): Promise<void> {
  const fs = await import("fs");
  const path = await import("path");

  const knowledgeDir = path.resolve(
    import.meta.dirname ?? __dirname ?? ".",
    "..",
    "knowledge-extraction",
  );

  // Diagnostics go to stderr so `--sql-only` stdout is pure, pipeable SQL.
  console.error(`📚 Importing knowledge from: ${knowledgeDir}`);
  console.error(`📊 Documents to import: ${KNOWLEDGE_DOCUMENTS.length}`);

  // Check if we should output SQL or execute directly
  const sqlOnly = process.argv.includes("--sql-only");

  if (sqlOnly) {
    // Same generator as every other path — one place to drift, not two.
    let missing = 0;
    const sql = buildImportSQL((doc) => {
      const filePath = path.join(knowledgeDir, doc.file);
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  File not found: ${doc.file}, skipping`);
        missing++;
        return null;
      }
      return fs.readFileSync(filePath, "utf-8");
    });

    console.log(sql);
    if (missing > 0) {
      console.error(`❌ ${missing} registered document(s) missing from ${knowledgeDir}`);
      process.exit(1);
    }
    return;
  }

  // Direct import via pg client
  console.log("🔌 Connecting to database...");

  const dbUrl =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

  // Dynamic import of pg
  let pg: { default: { Client: new (connectionString: string) => { connect: () => Promise<void>; query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; end: () => Promise<void> } } };
  try {
    pg = await import("pg");
  } catch {
    console.error(
      "❌ pg package not installed. Run: npm install pg\n" +
        "   Or use --sql-only flag to generate SQL output.",
    );
    process.exit(1);
  }

  const client = new pg.default.Client(dbUrl);
  await client.connect();

  // Resolve the authoring partner ONCE, deterministically. `LIMIT 1` without an
  // ORDER BY picks whichever row the planner returns; and when the partner
  // bootstrap has not run the table is empty, so author_partner_id (NOT NULL)
  // makes every insert fail. Same contract as 38_anthropic_operating_principles.sql.
  const partnerResult = await client.query(
    `SELECT id FROM partner_profiles ORDER BY created_at LIMIT 1`,
  );
  const partnerId = (partnerResult.rows[0] as { id: string } | undefined)?.id;
  if (!partnerId) {
    await client.end();
    console.error(
      "❌ No partner_profiles found — run the partner bootstrap first, then re-run this import.",
    );
    process.exit(1);
  }

  let imported = 0;
  let skipped = 0;

  for (const doc of KNOWLEDGE_DOCUMENTS) {
    const filePath = path.join(knowledgeDir, doc.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${doc.file}, skipping`);
      skipped++;
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");

    try {
      await client.query(
        `INSERT INTO expert_rules (
          slug, title, summary, body_markdown, category,
          expertise_area_id, author_partner_id, visibility,
          ai_instructions, ai_context_tags, status, is_verified, version
        ) VALUES (
          $1, $2, $3, $4, $5::expert_rule_category,
          (SELECT id FROM guild_expertise_areas WHERE slug = $6),
          $9,
          'public', $7, $8, 'published', true, 1
        ) ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          body_markdown = EXCLUDED.body_markdown,
          category = EXCLUDED.category,
          expertise_area_id = EXCLUDED.expertise_area_id,
          ai_instructions = EXCLUDED.ai_instructions,
          ai_context_tags = EXCLUDED.ai_context_tags,
          status = 'published',
          updated_at = now()`,
        [
          doc.slug,
          doc.title,
          doc.summary,
          content,
          doc.category,
          doc.expertise_area_slug,
          aiInstructionsFor(doc),
          doc.ai_context_tags,
          partnerId,
        ],
      );

      console.log(`✅ ${doc.file} → ${doc.slug}`);
      imported++;
    } catch (err) {
      console.error(`❌ ${doc.file}: ${err}`);
      skipped++;
    }
  }

  await client.end();
  console.log("");
  console.log(`📊 Results: ${imported} imported, ${skipped} skipped`);

  // Fail loud. This wire was dead for months because a run that imported nothing
  // still exited 0 and looked like success. Any skip is a failure to surface.
  if (imported === 0) {
    console.error("❌ Nothing was imported — the knowledge documents did not reach expert_rules.");
    process.exit(1);
  }
  if (skipped > 0) {
    console.error(`❌ ${skipped} document(s) were skipped — partial import is not success.`);
    process.exit(1);
  }
}
