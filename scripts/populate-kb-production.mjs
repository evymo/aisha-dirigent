/**
 * Populate expert_rules on production from knowledge-extraction/ markdown files.
 * Sends SQL via pg-meta API to avoid JSON escaping issues with large markdown content.
 *
 * Usage: node scripts/populate-kb-production.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ANON_KEY, PG_URL as PG_META_URL } from './lib/remote-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOCS = [
  {
    file: "DEVELOPMENT_LAWS.md",
    slug: "aisha-development-laws",
    title: "Evymo Development Laws",
    summary:
      "Core development laws for Evymo platform development. RPC-only data access, no sensitive data in logs, mandatory i18n, proper TypeScript usage.",
    category: "coding_standard",
    area: "fullstack",
    tags: [
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
      "Project structuring, layers, responsibilities for React + Supabase application with hooks, components, pages.",
    category: "architecture_pattern",
    area: "frontend-development",
    tags: [
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
      "Supabase API communication through hooks. RPC-only pattern, TanStack Query integration, Zod validation.",
    category: "api_design",
    area: "api-integrations",
    tags: [
      "supabase",
      "rpc",
      "tanstack-query",
      "zod",
      "react-hooks",
      "api",
      "evymo",
    ],
  },
  {
    file: "HOOKS_PATTERNS.md",
    slug: "aisha-hooks-patterns",
    title: "Evymo Hook Design Patterns",
    summary:
      "Design patterns for React hooks: templates, conventions, Zod validation, TanStack Query mutations, error handling.",
    category: "integration_pattern",
    area: "frontend-development",
    tags: [
      "react",
      "hooks",
      "typescript",
      "zod",
      "tanstack-query",
      "testing",
      "evymo",
    ],
  },
  {
    file: "TESTING_PHILOSOPHY.md",
    slug: "aisha-testing-philosophy",
    title: "Evymo Testing Philosophy",
    summary:
      "What to test, when, how, and why. 4 test levels, mock patterns, vitest configuration, hook testing.",
    category: "testing_strategy",
    area: "testing-qa",
    tags: [
      "vitest",
      "testing",
      "react-testing",
      "mocking",
      "gate-tests",
      "hooks",
      "evymo",
    ],
  },
  {
    file: "CODE_QUALITY_GATES.md",
    slug: "aisha-code-quality-gates",
    title: "Evymo Code Quality Gates",
    summary:
      "CI gate tests, code hygiene, what must pass before merge. ESLint rules, TypeScript strictness.",
    category: "coding_standard",
    area: "testing-qa",
    tags: [
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
      "Security patterns: sensitive data protection, safe logging, authentication, RLS policies, SECURITY DEFINER.",
    category: "security_practice",
    area: "security",
    tags: [
      "security",
      "rls",
      "authentication",
      "logging",
      "owasp",
      "supabase",
      "evymo",
    ],
  },
  {
    file: "i18n_STANDARDS.md",
    slug: "aisha-i18n-standards",
    title: "Evymo i18n Standards",
    summary:
      "Internationalization: every user-facing text through translations. Segment structure, DeepL integration.",
    category: "coding_standard",
    area: "frontend-development",
    tags: [
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
      "Tracking project complexity, task management, backlog organization for AI-assisted development.",
    category: "project_management",
    area: "project-management",
    tags: [
      "project-management",
      "complexity",
      "task-tracking",
      "backlog",
      "evymo",
    ],
  },
  {
    file: "COMMIT_WORKFLOW.md",
    slug: "aisha-commit-workflow",
    title: "Evymo Commit Workflow",
    summary:
      "Git commit conventions, PR workflow, pre-commit hooks, conventional commits, branch strategy.",
    category: "devops_pipeline",
    area: "devops-infrastructure",
    tags: [
      "git",
      "commits",
      "pr-workflow",
      "conventional-commits",
      "ci-cd",
      "evymo",
    ],
  },
];

// Also add project-rules from copilot-instructions.md sections
const PROJECT_RULES = [
  {
    slug: "aisha-rpc-only-pattern",
    title: "RPC-Only Pattern",
    summary:
      "Absolutní pravidlo: žádné přímé .from() dotazy na tabulky, vše přes supabase.rpc(). RPC funkce = PostgreSQL funkce volané přes PostgREST.",
    category: "architecture_pattern",
    area: "api-integrations",
    tags: ["rpc", "supabase", "postgrest", "architecture", "evymo"],
    content: `# RPC-Only Pattern

## Absolutní pravidlo č. 1

**Žádné přímé .from() dotazy na tabulky, vše přes supabase.rpc().**

Toto je základní architektonický princip celé platformy Evymo.

## Správný přístup

\`\`\`typescript
// ✅ SPRÁVNĚ - RPC s auditem
const { data } = await supabase.rpc("get_my_health_check_ins_audited", {
  p_limit: 30
});
\`\`\`

## Anti-pattern

\`\`\`typescript
// ❌ ŠPATNĚ - Přímý dotaz na sensitive data
const { data } = await supabase.from("health_check_ins").select("*");
\`\`\`

## Pravidla

- **Explicitní sloupce** — žádné .select("*"), vždy vyjmenovat potřebné sloupce
- **Audit suffix** — nové RPC funkce pro sensitive data mají _audited suffix
- **RLS** — Row Level Security na každé tabulce jako druhá vrstva ochrany
- RPC funkce = PostgreSQL funkce volané přes PostgREST
- SECURITY DEFINER = funkce běží s právy vlastníka (postgres), MUSÍ mít SET search_path
- SECURITY INVOKER = funkce běží s právy volajícího (respektuje RLS)
- anon role = nepřihlášený uživatel, funkce s GRANT TO anon MUSÍ mít SECURITY DEFINER`,
  },
  {
    slug: "aisha-security-definer-pattern",
    title: "SECURITY DEFINER Pattern pro anon funkce",
    summary:
      "Funkce s GRANT TO anon MUSÍ mít SECURITY DEFINER + SET search_path. Povinné pro veřejné RPC funkce.",
    category: "security_practice",
    area: "security",
    tags: [
      "security-definer",
      "anon",
      "rls",
      "postgresql",
      "supabase",
      "evymo",
    ],
    content: `# SECURITY DEFINER Pattern pro anon funkce

## KRITICKÉ: Funkce s GRANT TO anon MUSÍ mít SECURITY DEFINER!

\`\`\`sql
CREATE OR REPLACE FUNCTION get_public_entity()
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY SELECT ... FROM table WHERE is_public = true;
END;
$$;

REVOKE ALL ON FUNCTION get_public_entity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_entity() TO anon;
GRANT EXECUTE ON FUNCTION get_public_entity() TO authenticated;
\`\`\`

## Pravidla

- SECURITY DEFINER = funkce běží s právy vlastníka (postgres)
- SET search_path TO 'public' = POVINNÉ s SECURITY DEFINER (prevence search_path hijacking)
- REVOKE ALL FROM PUBLIC = odebrat výchozí přístup
- GRANT EXECUTE TO anon, authenticated = explicitní přidělení přístupu`,
  },
  {
    slug: "aisha-audit-journal-pattern",
    title: "Audit Journal Pattern",
    summary:
      "Unified audit pattern pro všechny sensitive operace. INSERT INTO audit_journal s user_id, action, metadata.",
    category: "security_practice",
    area: "security",
    tags: [
      "audit",
      "journal",
      "security",
      "logging",
      "compliance",
      "evymo",
    ],
    content: `# Audit Journal — Unified Pattern

## Struktura záznamu

- id: UUID
- user_id: auth.uid()
- action: 'LOGIN', 'HEALTH_READ', 'CONSENT_GRANT', etc.
- metadata: JSONB (area, severity, entity_type, entity_id)
- created_at: timestamptz

## Zapisování

INSERT INTO audit_journal (user_id, action, metadata)
VALUES (auth.uid(), 'HEALTH_READ', jsonb_build_object('area', 'sensitive', 'severity', 'info', 'entity_type', 'health_check_in', 'limit', p_limit));

## NIKDY neukládej sensitive data do metadata!

Pouze IDs a metadata. Žádné emaily, jména, zdravotní data.`,
  },
  {
    slug: "aisha-migration-workflow",
    title: "Migration Workflow",
    summary:
      "Produkční migrační workflow: soubor → register → migrate → types. Migrace se NEARCHIVUJÍ.",
    category: "devops_pipeline",
    area: "devops-infrastructure",
    tags: [
      "migration",
      "database",
      "workflow",
      "supabase",
      "typescript",
      "evymo",
    ],
    content: `# Migrační workflow

## Produkční režim (od 2026-02-16)

Všechny DB změny MUSÍ jít přes migrační soubory.

## Správný postup

1. Vytvoř migraci v aisha/db/migrations/YYYYMMDDHHMMSS_popis.sql
2. Spusť npm run db:migration:register
3. Spusť npm run db:migrate:local
4. Spusť npm run db:types:gen:local
5. Commitni vše včetně migration-registry.json

## Zakázáno

- NIKDY nearchivuj migrace do the absorbed migration (now in the baseline)!
- NIKDY nemanuálně edituj migration-registry.json!
- Nepoužívej psql meta-příkazy v migracích
- Nepoužívej COPY ... FROM STDIN`,
  },
  {
    slug: "aisha-code-hygiene",
    title: "Code Hygiene Rules",
    summary:
      "Absolutní pravidla: žádné emoji, any, console.log, ts-ignore, hardcoded texty. Gate testy musí projít.",
    category: "coding_standard",
    area: "fullstack",
    tags: [
      "typescript",
      "eslint",
      "hygiene",
      "code-quality",
      "evymo",
    ],
    content: `# Hygiena kódu

## Absolutní pravidla

1. Žádné emoji v UI — Používat lucide-react ikony
2. Žádné any typy — Používat proper typy nebo unknown + type guard
3. Žádné console.log() — Error logovat přes safeError()
4. Žádné @ts-ignore — Použít @ts-expect-error s vysvětlujícím komentářem
5. Gate testy musí projít — npm run test:gates
6. Žádné hardcoded texty — Vše přes i18n t()

## Permission checks

Používat dynamické permissions (hasPermission), ne hardcoded role checks.

## TSDoc povinný

Veškerý exportovaný kód musí mít TSDoc komentáře.`,
  },
  {
    slug: "aisha-testing-rules",
    title: "Testing Rules",
    summary:
      "Spouštěj POUZE relevantní testy. Mock musí odpovídat implementaci. Použij vi.mocked() konzistentně.",
    category: "testing_strategy",
    area: "testing-qa",
    tags: [
      "testing",
      "vitest",
      "mocking",
      "react",
      "hooks",
      "evymo",
    ],
    content: `# Testovací pravidla

## Kritické: Spouštěj POUZE relevantní testy

npm run test:run -- src/tests/hooks/useMyHook.test.ts

## Mock musí odpovídat skutečné implementaci

VŽDY zkontroluj implementaci hooku před psaním testu!

## Používej vi.mocked() konzistentně

vi.mocked(supabase.rpc).mockClear();
vi.mocked(supabase.rpc).mockResolvedValue({ data: "ok", error: null });

## Po KAŽDÉ změně Zod schématu spusť test

parseRpcArraySafe používá safeParse — tiše zahodí nevalidní položky.`,
  },
  {
    slug: "aisha-i18n-rules",
    title: "i18n Rules",
    summary:
      "Všechny UI texty přes t(). Žádné hardcoded fallbacky. EN je kanonická sada klíčů.",
    category: "coding_standard",
    area: "frontend-development",
    tags: [
      "i18n",
      "translations",
      "react",
      "localization",
      "evymo",
    ],
    content: `# Internacionalizace (i18n)

## Absolutní pravidlo

Všechny uživatelské texty MUSÍ jít přes i18n:

const { t } = useTranslation();
<Button>{t("common.save")}</Button>

## Žádné hardcoded fallbacky

t("common.save", "Save") — ŠPATNĚ
t("common.save", { defaultValue: "Save" }) — ŠPATNĚ

## Workflow pro nový text

1. Přidej klíč do src/i18n/segments/en/*.json
2. Přidej překlad do src/i18n/segments/cs/*.json
3. Spusť npm run i18n:check

## Zdroj pravdy

EN je kanonická sada klíčů.
Segmenty: src/i18n/segments/<lng>/{core,auth,member,partner,admin,shop,research}.json`,
  },
];

function escapeSQL(str) {
  return str.replace(/'/g, "''");
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
  console.log("=== Populate Knowledge Base on Production ===\n");

  // Check partner_profiles
  const partners = await pgQuery(
    "SELECT id FROM partner_profiles LIMIT 1"
  );
  if (!partners.length) {
    console.error("ERROR: No partner_profiles found! Create one first.");
    process.exit(1);
  }
  console.log(`Partner ID: ${partners[0].id}`);

  // Check guild_expertise_areas
  const areas = await pgQuery(
    "SELECT slug FROM guild_expertise_areas"
  );
  const areaSlugs = new Set(areas.map((a) => a.slug));
  console.log(`Expertise areas: ${areaSlugs.size} (${[...areaSlugs].join(", ")})\n`);

  const knowledgeDir = path.resolve(__dirname, "..", "knowledge-extraction");
  let successCount = 0;
  let errorCount = 0;

  // Phase 1: Import knowledge-extraction/ docs
  console.log("--- Phase 1: Knowledge-extraction documents ---");
  for (const doc of DOCS) {
    const filePath = path.join(knowledgeDir, doc.file);
    if (!fs.existsSync(filePath)) {
      console.log(`SKIP: ${doc.file} not found`);
      continue;
    }

    if (!areaSlugs.has(doc.area)) {
      console.log(`WARN: Area "${doc.area}" not found for ${doc.file}, using NULL`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const escapedContent = escapeSQL(content);
    const escapedTitle = escapeSQL(doc.title);
    const escapedSummary = escapeSQL(doc.summary);
    const aiInstructions = escapeSQL(
      `This knowledge document defines ${doc.title}. Follow these guidelines when working on the Evymo platform.`
    );
    const tagsArray = doc.tags.map((t) => `'${t}'`).join(", ");

    const sql = `INSERT INTO expert_rules (
  slug, title, summary, body_markdown, category,
  expertise_area_id, author_partner_id, visibility,
  ai_instructions, ai_context_tags, status, is_verified, version
) VALUES (
  '${doc.slug}',
  '${escapedTitle}',
  '${escapedSummary}',
  '${escapedContent}',
  '${doc.category}'::expert_rule_category,
  (SELECT id FROM guild_expertise_areas WHERE slug = '${doc.area}'),
  (SELECT id FROM partner_profiles LIMIT 1),
  'public',
  '${aiInstructions}',
  ARRAY[${tagsArray}],
  'published', true, 1
) ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  category = EXCLUDED.category,
  expertise_area_id = EXCLUDED.expertise_area_id,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  updated_at = now()
RETURNING slug`;

    try {
      const result = await pgQuery(sql);
      console.log(`  ✓ ${doc.file} → ${doc.slug} (${content.length} bytes)`);
      successCount++;
    } catch (err) {
      console.error(`  ✗ ${doc.file}: ${err.message}`);
      errorCount++;
    }
  }

  // Phase 2: Import project-rules (inline content)
  console.log("\n--- Phase 2: Project rules ---");
  for (const rule of PROJECT_RULES) {
    const escapedContent = escapeSQL(rule.content);
    const escapedTitle = escapeSQL(rule.title);
    const escapedSummary = escapeSQL(rule.summary);
    const aiInstructions = escapeSQL(
      `Project rule: ${rule.title}. This is a mandatory rule for the Evymo platform.`
    );
    const tagsArray = rule.tags.map((t) => `'${t}'`).join(", ");

    const areaSubquery = areaSlugs.has(rule.area)
      ? `(SELECT id FROM guild_expertise_areas WHERE slug = '${rule.area}')`
      : "NULL";

    const sql = `INSERT INTO expert_rules (
  slug, title, summary, body_markdown, category,
  expertise_area_id, author_partner_id, visibility,
  ai_instructions, ai_context_tags, status, is_verified, version
) VALUES (
  '${rule.slug}',
  '${escapedTitle}',
  '${escapedSummary}',
  '${escapedContent}',
  '${rule.category}'::expert_rule_category,
  ${areaSubquery},
  (SELECT id FROM partner_profiles LIMIT 1),
  'public',
  '${aiInstructions}',
  ARRAY[${tagsArray}],
  'published', true, 1
) ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  body_markdown = EXCLUDED.body_markdown,
  category = EXCLUDED.category,
  expertise_area_id = EXCLUDED.expertise_area_id,
  ai_instructions = EXCLUDED.ai_instructions,
  ai_context_tags = EXCLUDED.ai_context_tags,
  updated_at = now()
RETURNING slug`;

    try {
      const result = await pgQuery(sql);
      console.log(`  ✓ ${rule.slug}`);
      successCount++;
    } catch (err) {
      console.error(`  ✗ ${rule.slug}: ${err.message}`);
      errorCount++;
    }
  }

  // Final count
  const finalCount = await pgQuery(
    "SELECT count(*) as cnt FROM expert_rules"
  );

  console.log(`\n=== Results ===`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Total expert_rules in DB: ${finalCount[0].cnt}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
