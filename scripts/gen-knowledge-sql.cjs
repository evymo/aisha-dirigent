/**
 * Generate SQL for importing knowledge-extraction/ documents into expert_rules.
 * Usage: node scripts/gen-knowledge-sql.cjs > /tmp/knowledge-import.sql
 */
const fs = require("fs");
const path = require("path");

const DOCS = [
  {
    file: "DEVELOPMENT_LAWS.md",
    slug: "aisha-development-laws",
    title: "Evymo Development Laws",
    summary: "Core development laws for Evymo platform development. RPC-only data access, no sensitive data in logs, mandatory i18n, proper TypeScript usage.",
    category: "coding_standard",
    area: "fullstack",
    tags: ["typescript", "react", "supabase", "rpc", "security", "i18n", "development-laws", "evymo"],
  },
  {
    file: "ARCHITECTURE_PATTERNS.md",
    slug: "aisha-architecture-patterns",
    title: "Evymo Architecture Patterns",
    summary: "Project structuring, layers, responsibilities for React + Supabase application with hooks, components, pages.",
    category: "architecture_pattern",
    area: "frontend-development",
    tags: ["react", "architecture", "project-structure", "hooks", "components", "supabase", "evymo"],
  },
  {
    file: "API_COMMUNICATION.md",
    slug: "aisha-api-communication",
    title: "Evymo API Communication Patterns",
    summary: "Supabase API communication through hooks. RPC-only pattern, TanStack Query integration, Zod validation.",
    category: "api_design",
    area: "api-integrations",
    tags: ["supabase", "rpc", "tanstack-query", "zod", "react-hooks", "api", "evymo"],
  },
  {
    file: "HOOKS_PATTERNS.md",
    slug: "aisha-hooks-patterns",
    title: "Evymo Hook Design Patterns",
    summary: "Design patterns for React hooks: templates, conventions, Zod validation, TanStack Query mutations, error handling.",
    category: "integration_pattern",
    area: "frontend-development",
    tags: ["react", "hooks", "typescript", "zod", "tanstack-query", "testing", "evymo"],
  },
  {
    file: "TESTING_PHILOSOPHY.md",
    slug: "aisha-testing-philosophy",
    title: "Evymo Testing Philosophy",
    summary: "What to test, when, how, and why. 4 test levels, mock patterns, vitest configuration, hook testing.",
    category: "testing_strategy",
    area: "testing-qa",
    tags: ["vitest", "testing", "react-testing", "mocking", "gate-tests", "hooks", "evymo"],
  },
  {
    file: "CODE_QUALITY_GATES.md",
    slug: "aisha-code-quality-gates",
    title: "Evymo Code Quality Gates",
    summary: "CI gate tests, code hygiene, what must pass before merge. ESLint rules, TypeScript strictness.",
    category: "coding_standard",
    area: "testing-qa",
    tags: ["ci", "quality", "eslint", "typescript", "gate-tests", "code-review", "evymo"],
  },
  {
    file: "SECURITY_STANDARDS.md",
    slug: "aisha-security-standards",
    title: "Evymo Security Standards",
    summary: "Security patterns: sensitive data protection, safe logging, authentication, RLS policies, SECURITY DEFINER.",
    category: "security_practice",
    area: "security",
    tags: ["security", "rls", "authentication", "logging", "owasp", "supabase", "evymo"],
  },
  {
    file: "i18n_STANDARDS.md",
    slug: "aisha-i18n-standards",
    title: "Evymo i18n Standards",
    summary: "Internationalization: every user-facing text through translations. Segment structure, DeepL integration.",
    category: "coding_standard",
    area: "frontend-development",
    tags: ["i18n", "translations", "react-i18next", "deepl", "localization", "evymo"],
  },
  {
    file: "PROJECT_COMPLEXITY_TRACKING.md",
    slug: "aisha-project-complexity-tracking",
    title: "Evymo Project Complexity Tracking",
    summary: "Tracking project complexity, task management, backlog organization for AI-assisted development.",
    category: "project_management",
    area: "project-management",
    tags: ["project-management", "complexity", "task-tracking", "backlog", "evymo"],
  },
  {
    file: "COMMIT_WORKFLOW.md",
    slug: "aisha-commit-workflow",
    title: "Evymo Commit Workflow",
    summary: "Git commit conventions, PR workflow, pre-commit hooks, conventional commits, branch strategy.",
    category: "devops_pipeline",
    area: "devops-infrastructure",
    tags: ["git", "commits", "pr-workflow", "conventional-commits", "ci-cd", "evymo"],
  },
];

function escapeSQL(str) {
  return str.replace(/'/g, "''");
}

const knowledgeDir = path.resolve(__dirname, "..", "knowledge-extraction");
const lines = ["BEGIN;", ""];

for (const doc of DOCS) {
  const filePath = path.join(knowledgeDir, doc.file);
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`SKIP: ${doc.file} not found\n`);
    continue;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const escapedContent = escapeSQL(content);
  const escapedTitle = escapeSQL(doc.title);
  const escapedSummary = escapeSQL(doc.summary);
  const tagsArray = doc.tags.map((t) => `'${t}'`).join(", ");
  const aiInstructions = escapeSQL(
    `This knowledge document defines ${doc.title}. Follow these guidelines when working on the Evymo platform.`
  );

  lines.push(`-- Import: ${doc.file} (${content.length} bytes)`);
  lines.push(`INSERT INTO expert_rules (`);
  lines.push(`  slug, title, summary, body_markdown, category,`);
  lines.push(`  expertise_area_id, author_partner_id, visibility,`);
  lines.push(`  ai_instructions, ai_context_tags, status, is_verified, version`);
  lines.push(`) VALUES (`);
  lines.push(`  '${doc.slug}',`);
  lines.push(`  '${escapedTitle}',`);
  lines.push(`  '${escapedSummary}',`);
  lines.push(`  '${escapedContent}',`);
  lines.push(`  '${doc.category}'::expert_rule_category,`);
  lines.push(`  (SELECT id FROM guild_expertise_areas WHERE slug = '${doc.area}'),`);
  lines.push(`  (SELECT id FROM partner_profiles LIMIT 1),`);
  lines.push(`  'public',`);
  lines.push(`  '${aiInstructions}',`);
  lines.push(`  ARRAY[${tagsArray}],`);
  lines.push(`  'published', true, 1`);
  lines.push(`) ON CONFLICT (slug) DO UPDATE SET`);
  lines.push(`  title = EXCLUDED.title,`);
  lines.push(`  summary = EXCLUDED.summary,`);
  lines.push(`  body_markdown = EXCLUDED.body_markdown,`);
  lines.push(`  category = EXCLUDED.category,`);
  lines.push(`  expertise_area_id = EXCLUDED.expertise_area_id,`);
  lines.push(`  ai_instructions = EXCLUDED.ai_instructions,`);
  lines.push(`  ai_context_tags = EXCLUDED.ai_context_tags,`);
  lines.push(`  updated_at = now();`);
  lines.push("");
}

lines.push("COMMIT;");

process.stdout.write(lines.join("\n") + "\n");
process.stderr.write(`Generated SQL for ${DOCS.length} documents\n`);
