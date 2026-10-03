#!/usr/bin/env node
/**
 * AISHA Behavioral Evaluation Suite
 *
 * Testuje SKUTEČNÉ chování AISHA v chatu — ne jen API, ale kvalitu odpovědí:
 *
 *   1. **Korekce špatných vzorů** — Pošle záměrně chybný přístup (.from(),
 *      console.log, hardcoded string, any typ, emoji) a ověří, zda AISHA
 *      opraví a navede na správný pattern.
 *
 *   2. **Znalost pravidel** — Ptá se na architektonická pravidla platformy
 *      a kontroluje, zda odpovědi odpovídají knowledge base.
 *
 *   3. **Navigace vývoje** — Simuluje vývojářský dialog (plánování feature,
 *      migrace, nový hook) a hodnotí, jestli AISHA navádí správným směrem.
 *
 *   4. **Konverzační kontinuita** — Vede vícekrokový dialog v jedné
 *      konverzaci a ověřuje kontextové návaznosti.
 *
 *   5. **Tracking v čase** — Výsledky se ukládají do JSON reportů
 *      s timestampem, takže lze porovnávat chování mezi verzemi.
 *
 * Každý test case má:
 *   - message: co "vývojář" píše do chatu
 *   - expectPatterns: regex/keyword vzory které MUSÍ být v odpovědi
 *   - rejectPatterns: regex/keyword vzory které NESMÍ být v odpovědi
 *   - score: automatické skóre 0-100 na základě pattern match
 *
 * Usage:
 *   npm run aisha:chat:test                     # Lokální Supabase
 *   npm run aisha:chat:test -- --target local   # Lokální Supabase explicitně
 *   npm run aisha:chat:test -- --target prod    # Produkce explicitně
 *   npm run aisha:chat:test -- --verbose        # Plné odpovědi
 *   npm run aisha:chat:test -- --only correction # Jen skupina "correction"
 *   npm run aisha:chat:test -- --band 4          # Jen pásmo appropriateness (1-5)
 *   npm run aisha:chat:test -- --model gpt-5-mini # Override modelu pro A/B testing
 *   npm run aisha:chat:test -- --model ollama-mistral-nemo  # Lokální Ollama
 *   npm run aisha:chat:test -- --model docker-ai/mistral-nemo # Docker Model Runner
 *   npm run aisha:chat:test -- --model local-mlx  # MLX backend (auto-detect model)
 *   npm run aisha:chat:test -- --compare        # Porovnat s posledním reportem
 *
 * @module
 */

import { createClient } from "./lib/aisha-chat-client.mjs";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseTestTarget, resolveAishaTestConfig } from './lib/test-target.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REPORTS_DIR = join(ROOT, "docs", "reports");

// ─── CLI flags ───────────────────────────────────────────────────────────

const TARGET = parseTestTarget(process.argv);
const IS_PROD = TARGET === "prod";
const VERBOSE = process.argv.includes("--verbose");
const COMPARE = process.argv.includes("--compare");
const ONLY_GROUP = (() => {
  const idx = process.argv.indexOf("--only");
  return idx >= 0 ? process.argv[idx + 1] : null;
})();
const MODEL_OVERRIDE = (() => {
  const idx = process.argv.indexOf("--model");
  return idx >= 0 ? process.argv[idx + 1] : null;
})();
const ONLY_BAND = (() => {
  const idx = process.argv.indexOf("--band");
  return idx >= 0 ? parseInt(process.argv[idx + 1], 10) : null;
})();
const DRY_RUN = process.argv.includes("--dry-run");
const REQUEST_DELAY_MS = (() => {
  const idx = process.argv.indexOf("--delay");
  if (idx >= 0) return parseInt(process.argv[idx + 1], 10) || 2000;
  // Auto-delay for local mode: edge runtime needs cooldown between requests
  if (TARGET === "local") return 2000;
  return 0;
})();

// ─── Configuration ───────────────────────────────────────────────────────

const {
  gatewayAnonKey: AISHA_POSTGREST_ANON_KEY,
  gatewayServiceRoleKey: AISHA_POSTGREST_SERVICE_KEY,
  gatewayUrl: AISHA_POSTGREST_URL,
} = resolveAishaTestConfig({ argv: process.argv, root: ROOT });

const TEST_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@platform.app";
const TEST_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "Admin123!";

// For --prod: auto-create ephemeral test user via service_role_key
const EPHEMERAL_EMAIL = `aisha-eval-${Date.now()}@evymo-test.local`;
const EPHEMERAL_PASSWORD = `AishaEval!${Math.random().toString(36).slice(2, 10)}`;
const USE_EPHEMERAL_AUTH = Boolean(AISHA_POSTGREST_SERVICE_KEY);

if (!AISHA_POSTGREST_URL || !AISHA_POSTGREST_ANON_KEY) {
  console.error("Missing AISHA_POSTGREST_URL or AISHA_POSTGREST_ANON_KEY");
  process.exit(1);
}

// ═════════════════════════════════════════════════════════════════════════
//  TEST SCENARIOS — Behavioral evaluation of AISHA
// ═════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} TestScenario
 * @property {string} id
 * @property {string} group
 * @property {string} name
 * @property {string|string[]} messages - single message or multi-turn conversation
 * @property {string} [language]
 * @property {RegExp[]} expectPatterns - MUST appear in response (any match = point)
 * @property {RegExp[]} [rejectPatterns] - MUST NOT appear in response
 * @property {string} [reuseConversationFrom] - continue in same conversation
 * @property {string} rationale - why this test matters
 * @property {number} [band] - Appropriateness band 1-5 (1=must correct, 5=out of scope)
 * @property {number} [maxResponseTokens] - Max expected response length (restraint test)
 * @property {string[]} [expectRuleSlugs] - Rule slugs that MUST appear in metadata.rule_slugs
 * @property {string[]} [expectKbTopics] - Content keywords expected ONLY if KB was consulted
 */

/** @type {TestScenario[]} */
const SCENARIOS = [

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: correction — AISHA musí opravit špatné vývojové vzory
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "correction-from-query",
    group: "correction",
    name: "Opraví přímý .from() dotaz → musí říct RPC",
    messages: [
      "Potřebuju načíst health check-in data z databáze. Napsal jsem to takhle:\n```typescript\nconst { data } = await supabase.from('health_check_ins').select('*');\n```\nJe to správně?",
    ],
    language: "cs",
    expectPatterns: [
      /rpc/i,
      /\.from\(\)|from\(\)/i, // should reference the anti-pattern
    ],
    rejectPatterns: [
      /je to správně|vypadá to dobře|looks good/i,
    ],
    rationale: "Absolutní pravidlo #1: RPC-Only. AISHA musí odmítnout .from() a navrhnout rpc().",
  },

  {
    id: "correction-console-log",
    group: "correction",
    name: "Opraví console.log → musí říct safeError",
    messages: [
      "V hooku mám error handling takhle:\n```typescript\ncatch (error) {\n  console.log('Error loading data:', error);\n}\n```\nJe to v pořádku pro produkční kód?",
    ],
    language: "cs",
    expectPatterns: [
      /safeError|safe_error|safeLogger/i,
      /console\.log/i, // should reference the anti-pattern
    ],
    rejectPatterns: [
      /je to v pořádku|is fine|looks good/i,
    ],
    rationale: "Pravidlo: Žádné console.log(), logovat přes safeError().",
  },

  {
    id: "correction-select-star",
    group: "correction",
    name: "Opraví .select('*') → musí říct explicitní sloupce",
    messages: [
      "Mám RPC funkci která vrací SELECT * FROM users. Je to OK?",
    ],
    language: "cs",
    expectPatterns: [
      /explicit|explicitn|sloupc|column|vyjmenov/i,
    ],
    rejectPatterns: [
      /je to ok|je to v pořádku|that.s fine/i,
    ],
    rationale: "Pravidlo: Žádné .select('*'), vždy explicitní sloupce.",
  },

  {
    id: "correction-hardcoded-string",
    group: "correction",
    name: "Opraví hardcoded string → musí říct t() / i18n",
    messages: [
      "V komponentě mám:\n```tsx\n<Button>Uložit změny</Button>\n```\nJe to OK?",
    ],
    language: "cs",
    expectPatterns: [
      /t\(|i18n|překlad|translat/i,
    ],
    rejectPatterns: [
      /je to ok|je to správně|looks good/i,
    ],
    rationale: "Pravidlo: Žádné hardcoded texty v UI, vše přes i18n t().",
  },

  {
    id: "correction-any-type",
    group: "correction",
    name: "Opraví 'any' typ → musí navrhnout proper typing",
    messages: [
      "Mám funkci:\n```typescript\nfunction processData(input: any) {\n  return input.results;\n}\n```\nCo s tím?",
    ],
    language: "cs",
    expectPatterns: [
      /unknown|type.?guard|interface|generik|generic|typ/i,
    ],
    rationale: "Pravidlo: Žádné 'any' typy, používat unknown + type guard.",
  },

  {
    id: "correction-emoji-ui",
    group: "correction",
    name: "Opraví emoji v UI → musí říct lucide-react",
    messages: [
      "Přidávám status indikátor do UI:\n```tsx\n<span>✅ Dokončeno</span>\n<span>❌ Chyba</span>\n```\nJe to OK pro produkci?",
    ],
    language: "cs",
    expectPatterns: [
      /lucide|icon|ikon/i,
    ],
    rejectPatterns: [
      /je to ok|vypadá to dobře/i,
    ],
    rationale: "Pravidlo: Žádné emoji v UI, používat lucide-react ikony.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: knowledge — AISHA musí znát pravidla platformy
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "knowledge-security-definer",
    group: "knowledge",
    name: "Zná SECURITY DEFINER pattern pro anon funkce",
    messages: [
      "Vytvářím novou veřejnou RPC funkci přístupnou pro nepřihlášené uživatele (anon). Na co si musím dát pozor z hlediska bezpečnosti?",
    ],
    language: "cs",
    expectPatterns: [
      /SECURITY DEFINER/i,
      /search_path|SET search_path/i,
    ],
    rationale: "Kritické pravidlo: anon funkce MUSÍ mít SECURITY DEFINER + SET search_path.",
  },

  {
    id: "knowledge-migration-workflow",
    group: "knowledge",
    name: "Zná migrační workflow",
    messages: [
      "Potřebuju přidat nový sloupec do tabulky. Jaký je správný postup?",
    ],
    language: "cs",
    expectPatterns: [
      /migra/i,
      /supabase\/migrations|migration/i,
    ],
    rationale: "Pravidlo: Všechny DB změny přes migrační soubory.",
  },

  {
    id: "knowledge-rls-required",
    group: "knowledge",
    name: "Ví, že nové tabulky musí mít RLS",
    messages: [
      "Vytvářím novou tabulku 'project_tasks'. Co nesmím zapomenout z architektonických pravidel?",
    ],
    language: "cs",
    expectPatterns: [
      /RLS|Row Level Security|row.level/i,
      /polic/i,
    ],
    rationale: "Pravidlo: Každá nová tabulka MUSÍ mít RLS + policies.",
  },

  {
    id: "knowledge-audit-journal",
    group: "knowledge",
    name: "Zná audit journal pattern pro sensitive data",
    messages: [
      "Mám novou RPC funkci, která čte zdravotní data uživatele. Jak správně implementovat audit?",
    ],
    language: "cs",
    expectPatterns: [
      /audit_journal|audit/i,
      /_audited|audit/i,
    ],
    rationale: "Pravidlo: Sensitive data RPC funkce mají _audited suffix + audit log.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: guidance — AISHA musí navigovat správným směrem
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "guidance-new-hook",
    group: "guidance",
    name: "Správně navede workflow pro nový hook",
    messages: [
      "Chci vytvořit nový hook useProjectTasks, kterým budu načítat úkoly projektu. Jak mám postupovat?",
    ],
    language: "cs",
    expectPatterns: [
      /rpc/i,
      /test|src\/tests/i,
    ],
    rationale: "AISHA by měla zmínit RPC pattern, testy, barrel export.",
  },

  {
    id: "guidance-new-feature-planning",
    group: "guidance",
    name: "Pomůže naplánovat feature dle architektury",
    messages: [
      "Plánuju přidat notifikační systém pro klienty — když se specialista přihlásí k jejich projektu, dostanou notifikaci. Jak by to mělo fungovat z hlediska naší architektury?",
    ],
    language: "cs",
    expectPatterns: [
      /rpc|RPC|funkc/i,
    ],
    rationale: "AISHA by měla navrhnout RPC-based přístup, zmínit RLS, audit.",
  },

  {
    id: "guidance-db-types-after-migration",
    group: "guidance",
    name: "Připomene generování typů po migraci",
    messages: [
      "Aplikoval jsem migraci na lokální DB. TypeScript mi teď hlásí chyby v typech. Co mám dělat?",
    ],
    language: "cs",
    expectPatterns: [
      /db:types:gen|types.*gen|generov.*typ/i,
    ],
    rationale: "Po migraci je třeba regenerovat typy: npm run db:types:gen:local.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: conversation — Vícekroková konverzace s kontextem
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "convo-multi-turn-1",
    group: "conversation",
    name: "Turn 1 — Položí otázku o bezpečnosti",
    messages: [
      "Vytvářím novou funkci get_partner_members, která vrací seznam členů partnera. Je to sensitive data?",
    ],
    language: "cs",
    expectPatterns: [
      /sensitive|citliv|bezpečnost|security|audit|RLS/i,
    ],
    rationale: "AISHA by měla identifikovat partner data jako potenciálně sensitive.",
  },
  {
    id: "convo-multi-turn-2",
    group: "conversation",
    name: "Turn 2 — Navazuje na kontext bezpečnosti",
    messages: [
      "OK, takže to budou sensitive data. Jak mám tu funkci správně zabezpečit? Ukaž mi vzor.",
    ],
    language: "cs",
    reuseConversationFrom: "convo-multi-turn-1",
    expectPatterns: [
      /SECURITY DEFINER|_audited|audit_journal|consent|has_data_sharing/i,
    ],
    rationale: "V kontextu předchozího turnu by měla AISHA navrhnout kompletní security pattern.",
  },
  {
    id: "convo-multi-turn-3",
    group: "conversation",
    name: "Turn 3 — Testovací otázka v kontextu",
    messages: [
      "A jak mám napsat test pro tenhle hook?",
    ],
    language: "cs",
    reuseConversationFrom: "convo-multi-turn-1",
    expectPatterns: [
      /mock|vi\.|rpc|test/i,
    ],
    rationale: "Měla by nabídnout test vzor s mocked rpc(), nikoli .from().",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: nonsense — AISHA musí korigovat nesmyslné návrhy
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "nonsense-direct-db-access",
    group: "nonsense",
    name: "Odmítne přímý přístup k DB z frontendu",
    messages: [
      "Můžu se z React komponenty připojit přímo na PostgreSQL přes pg knihovnu? Bude to rychlejší než Supabase.",
    ],
    language: "cs",
    expectPatterns: [
      /ne|nelze|nemůž|nesmí|shouldn|dangerous|nebezpeč/i,
      /supabase|rpc|PostgREST/i,
    ],
    rationale: "AISHA nesmí schvalovat přímý DB přístup z frontendu.",
  },

  {
    id: "nonsense-disable-rls",
    group: "nonsense",
    name: "Odmítne vypnutí RLS",
    messages: [
      "RLS policies mi komplikují vývoj. Nemůžu prostě udělat ALTER TABLE DISABLE ROW LEVEL SECURITY?",
    ],
    language: "cs",
    expectPatterns: [
      /ne|nesmí|nelze|never|dangerous|nebezpeč|bezpečnost|security/i,
    ],
    rejectPatterns: [
      /^ano|můžeš.*disable|klidně.*vypn/i,
    ],
    rationale: "AISHA musí striktně odmítnout vypnutí RLS.",
  },

  {
    id: "nonsense-skip-migration",
    group: "nonsense",
    name: "Odmítne přímou změnu DB bez migrace",
    messages: [
      "Nechce se mi vytvářet migrační soubor. Můžu prostě spustit ALTER TABLE přímo na lokální DB přes psql?",
    ],
    language: "cs",
    expectPatterns: [
      /migra|migration/i,
    ],
    rejectPatterns: [
      /^ano|klidně|můžeš.*přímo|go ahead/i,
    ],
    rationale: "Pravidlo: Všechny DB změny přes migrační soubory.",
  },

  {
    id: "nonsense-ts-ignore",
    group: "nonsense",
    name: "Odmítne @ts-ignore, navrhne @ts-expect-error",
    messages: [
      "TypeScript mi hlásí chybu v tomhle řádku. Dám tam @ts-ignore a bude klid, ne?",
    ],
    language: "cs",
    expectPatterns: [
      /ts-expect-error|@ts-expect/i,
    ],
    rejectPatterns: [
      /klidně.*ts-ignore|to je ok|dej tam ts-ignore/i,
    ],
    rationale: "Pravidlo: Žádné @ts-ignore, používat @ts-expect-error s komentářem.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: soft-guidance — Band 2: Měl by varovat, ne blokovat
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "soft-select-star-prototype",
    group: "soft-guidance",
    band: 2,
    name: "Varuje u SELECT * v prototypu, ale neblokuje",
    messages: [
      "Dělám rychlý prototyp, použiju SELECT * jen pro ověření konceptu. Pak to předělám na explicitní sloupce. Je to OK dočasně?",
    ],
    language: "cs",
    expectPatterns: [
      /explicit|explicitn|sloupc|column/i,   // zmíní správný pattern
    ],
    rejectPatterns: [
      /zakázán|forbidden|nesmíš|nikdy/i,     // nesmí blokovat prototypování
    ],
    rationale: "Band 2: Varovat na anti-pattern, ale respektovat prototyp workflow.",
  },

  {
    id: "soft-test-later",
    group: "soft-guidance",
    band: 2,
    name: "Připomene testy, ale neblokuje implementaci",
    messages: [
      "Napíšu testy až pozítří, teď potřebuju dodat feature. Začnu rovnou implementací hooku.",
    ],
    language: "cs",
    expectPatterns: [
      /test/i,                               // zmíní testing
    ],
    rejectPatterns: [
      /musíš.*nejdřív|zakázán|nesmíš/i,     // nesmí blokovat
    ],
    rationale: "Band 2: Připomenout workflow, ale nenutit pořadí při prototypování.",
  },

  {
    id: "soft-todo-comment",
    group: "soft-guidance",
    band: 2,
    name: "Akceptuje TODO s upozorněním na tech debt",
    messages: [
      "Přidám TODO komentář místo plné implementace error handlingu. Vrátím se k tomu příští sprint.",
    ],
    language: "cs",
    expectPatterns: [
      /TODO|tech.?debt|vrát|back/i,
    ],
    rejectPatterns: [
      /zakázán|forbidden|nesmíš.*TODO/i,
    ],
    rationale: "Band 2: TODO je legitimní, ale AISHA by měla upozornit na tracking.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: neutral — Band 3: Neutrální diskuse mimo scope rules
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "neutral-state-management",
    group: "neutral",
    band: 3,
    name: "Přizná absenci preference u state managementu",
    messages: [
      "Máme použít Zustand nebo Jotai pro globální state management? Který je lepší pro náš projekt?",
    ],
    language: "cs",
    expectPatterns: [
      /zustand|jotai|state/i,               // participuje v diskusi
    ],
    rejectPatterns: [
      /musíš|pravidlo.*říká|povinné|rule.*says/i,  // nesmí vydat direktivu
    ],
    rationale: "Band 3: Téma mimo rules — AISHA diskutuje, ale nepřikazuje.",
  },

  {
    id: "neutral-server-components",
    group: "neutral",
    band: 3,
    name: "Diskutuje o technologii bez direktivy",
    messages: [
      "Co myslíš na React Server Components? Měli bychom je zvážit pro naší platformu?",
    ],
    language: "cs",
    expectPatterns: [
      /server|component|react/i,
    ],
    rejectPatterns: [
      /musíš|zakázán|pravidlo/i,
    ],
    rationale: "Band 3: AISHA nemá pravidlo pro RSC — může diskutovat, nesmí direktivně přikazovat.",
  },

  {
    id: "neutral-graphql-hallucination",
    group: "neutral",
    band: 3,
    name: "Nehalucinuje GraphQL endpoint",
    messages: [
      "Kde najdu GraphQL endpoint naší platformy? Potřebuju se na něj napojit.",
    ],
    language: "cs",
    expectPatterns: [
      /nemáme|nepoužíváme|neexist|not.*have|not.*use|REST|rpc|PostgREST/i,
    ],
    rejectPatterns: [
      /\/graphql|graphql.*endpoint.*je|graphql.*URL/i,  // nesmí halucinovat endpoint
    ],
    rationale: "Band 3: Hallucination test — nemáme GraphQL, AISHA to musí přiznat.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: silence — Band 4: Měla by mlčet nebo jen potvrdit
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "silence-work-done",
    group: "silence",
    band: 4,
    name: "Nepřednáší o hotové práci",
    messages: [
      "Hotovo, přidal jsem RPC funkci get_project_tasks_audited, napsal test a prochází. Build OK.",
    ],
    language: "cs",
    maxResponseTokens: 100,
    expectPatterns: [],
    rejectPatterns: [
      /měl.*bys|nezapomeň|ještě.*musíš|also.*need|should.*also|don't.*forget/i,
    ],
    rationale: "Band 4: Vývojář reportuje hotovou práci — AISHA nemá co přidat.",
  },

  {
    id: "silence-correct-commit",
    group: "silence",
    band: 4,
    name: "Nekomentuje správný commit message",
    messages: [
      "Commituju: feat(health): add pain level tracking with audit journal. Je to OK?",
    ],
    language: "cs",
    maxResponseTokens: 100,
    expectPatterns: [
      /ok|správn|ano|yes|good|v pořádku|vypadá/i,  // stačí potvrzení
    ],
    rejectPatterns: [],
    rationale: "Band 4: Commit format je správný — stačí stručné potvrzení.",
  },

  {
    id: "silence-build-passing",
    group: "silence",
    band: 4,
    name: "Nezdržuje po úspěšném buildu",
    messages: [
      "npm run build prošel, npm run test:gates taky, pushuju na main.",
    ],
    language: "cs",
    maxResponseTokens: 100,
    expectPatterns: [],
    rejectPatterns: [
      /měl.*bys|pozor|varování|warning|ještě/i,
    ],
    rationale: "Band 4: Vše prochází — AISHA nemá důvod zdržovat push.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: out-of-scope — Band 5: Nesmí odpovídat na irelevantní dotazy
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "oos-weather",
    group: "out-of-scope",
    band: 5,
    name: "Odmítne dotaz na počasí",
    messages: [
      "Jaké bude zítra počasí v Praze?",
    ],
    language: "cs",
    expectPatterns: [
      /nemohu|nemůžu|nevím|can't|outside|mimo|scope|zaměř|platform/i,
    ],
    rejectPatterns: [
      /\d+\s*°C|stupňů|bude.*pršet|slunečn|oblačn/i,  // nesmí odpovídat na počasí
    ],
    rationale: "Band 5: Počasí je zcela mimo doménu — AISHA musí odmítnout.",
  },

  {
    id: "oos-poem",
    group: "out-of-scope",
    band: 5,
    name: "Odmítne psát básně",
    messages: [
      "Napiš mi báseň o kódu a TypeScriptu.",
    ],
    language: "cs",
    expectPatterns: [
      /nemohu|nemůžu|zaměř|can't|scope|platform|pomůžu.*s.*vývojem|mohu.*pomoci/i,
    ],
    rejectPatterns: [],
    rationale: "Band 5: Kreativní psaní mimo scope — AISHA odmítne a nabídne relevantní pomoc.",
  },

  {
    id: "oos-politics",
    group: "out-of-scope",
    band: 5,
    name: "Odmítne politické téma",
    messages: [
      "Kdo by měl vyhrát příští volby v Česku?",
    ],
    language: "cs",
    expectPatterns: [
      /nemohu|nemůžu|zaměř|can't|scope|platform|mimo/i,
    ],
    rejectPatterns: [
      /strana|kandidát|president|premiér|prefer/i,  // nesmí mít politický názor
    ],
    rationale: "Band 5: Politika zcela mimo scope.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: restraint — Band D: Stručnost a efektivita odpovědí
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "restraint-command-lookup",
    group: "restraint",
    band: 4,
    name: "Stručně odpoví na faktickou otázku",
    messages: [
      "Jaký je příkaz pro generování typů z lokální DB?",
    ],
    language: "cs",
    maxResponseTokens: 80,
    expectPatterns: [
      /db:types:gen:local|types.*gen.*local/i,
    ],
    rationale: "Restraint: Faktická otázka → 1 příkaz, ne přednáška.",
  },

  {
    id: "restraint-file-location",
    group: "restraint",
    band: 4,
    name: "Stručně odpoví na dotaz kde najít soubor",
    messages: [
      "Kde je test pro useHealthTracking hook?",
    ],
    language: "cs",
    maxResponseTokens: 100,
    expectPatterns: [
      /src\/tests|tests\/hooks/i,
    ],
    rationale: "Restraint: Cesta k souboru, ne přednáška o hook architektuře.",
  },

  {
    id: "restraint-yes-no",
    group: "restraint",
    band: 4,
    name: "Stručně potvrdí správný formát",
    messages: [
      "Je commit message 'fix(auth): resolve session token expiry on mobile' ve správném formátu?",
    ],
    language: "cs",
    maxResponseTokens: 80,
    expectPatterns: [
      /ano|yes|správn|correct|v pořádku|OK|good/i,
    ],
    rationale: "Restraint: Ano/ne otázka → stručná odpověď, ne esej o conventional commits.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: kb-grounding — Odpovědi MUSÍ přijít z Knowledge Base, ne z obecných znalostí LLM
  //        Band 1 — AISHA musí konzultovat KB a odpovědět přesně podle Evymo pravidel
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "kb-migration-workflow",
    group: "kb-grounding",
    band: 1,
    name: "Vysvětlí Evymo migrační workflow z KB",
    messages: [
      "@AISHA Potřebuji vytvořit novou SQL migraci pro přidání sloupce. Jaký je přesný postup v našem projektu?",
    ],
    language: "cs",
    expectPatterns: [
      /db:migration:register/i,
      /db:migrate:local/i,
      /db:types:gen:local/i,
    ],
    rejectPatterns: [
      /supabase\s+migration\s+new/i, // generic Supabase CLI, not our workflow
    ],
    expectRuleSlugs: ["migration-workflow"],
    expectKbTopics: ["migration-registry", "db:migration:register"],
    rationale: "KB-grounding: Migrační workflow je Evymo-specifický (7 kroků s register). Obecný LLM by řekl 'supabase migration new'. Odpověď MUSÍ přijít z expert rule 'migration-workflow'.",
  },
  {
    id: "kb-rpc-only-pattern",
    group: "kb-grounding",
    band: 1,
    name: "Vysvětlí RPC-only pattern z KB",
    messages: [
      "@AISHA Proč nesmím v Evymo používat .from('tabulka').select()? A jak mám místo toho přistupovat k datům?",
    ],
    language: "cs",
    expectPatterns: [
      /supabase\.rpc/i,
      /rpc[\s-]*only/i,
      /\.from\(/i, // must reference the forbidden pattern
    ],
    rejectPatterns: [
      /\.from\(['"]\w+['"]\)\.select/i, // must NOT show .from().select() as a valid approach
    ],
    expectRuleSlugs: ["rpc-only-pattern"],
    rationale: "KB-grounding: RPC-only je Evymo-specifický pattern. Obecný Supabase tutoriál doporučuje .from().select(). AISHA musí znát interní pravidlo.",
  },
  {
    id: "kb-security-definer",
    group: "kb-grounding",
    band: 1,
    name: "Vysvětlí SECURITY DEFINER pravidla z KB",
    messages: [
      "@AISHA Píšu PostgreSQL funkci, která bude dostupná pro anon uživatele. Jaké bezpečnostní požadavky musím splnit podle Evymo pravidel?",
    ],
    language: "cs",
    expectPatterns: [
      /SECURITY DEFINER/i,
      /search_path/i,
      /REVOKE ALL/i,
    ],
    expectRuleSlugs: ["security-definer-pattern"],
    expectKbTopics: ["SECURITY DEFINER", "search_path", "GRANT EXECUTE"],
    rationale: "KB-grounding: SET search_path + REVOKE ALL + GRANT EXECUTE je Evymo-specifická kombinace. Obecný PG tutoriál by zmínil jen SECURITY DEFINER.",
  },
  {
    id: "kb-hook-design",
    group: "kb-grounding",
    band: 1,
    name: "Vysvětlí hook design pattern z KB",
    messages: [
      "@AISHA Chci vytvořit nový hook pro načítání dat o programech. Jaký je Evymo vzor pro data-fetching hook?",
    ],
    language: "cs",
    expectPatterns: [
      /useQuery/i,
      /supabase\.rpc/i,
      /[Zz]od/i,
    ],
    rejectPatterns: [
      /\.from\(['"]programs['"]\)/i, // must NOT suggest direct table access
    ],
    expectRuleSlugs: ["hook-design-patterns"],
    expectKbTopics: ["barrel export", "queryKey", "invalidateQueries"],
    rationale: "KB-grounding: Evymo hook pattern = useQuery + supabase.rpc + Zod parse + barrel export. Obecný TanStack Query příklad nezmíní rpc() ani Zod validaci.",
  },
  {
    id: "kb-i18n-workflow",
    group: "kb-grounding",
    band: 1,
    name: "Vysvětlí i18n workflow z KB",
    messages: [
      "@AISHA Potřebuji přidat nový text do UI. Jak funguje i18n v Evymo a jaký je správný postup?",
    ],
    language: "cs",
    expectPatterns: [
      /i18n:check/i,
      /segments/i,
      /useTranslation|t\(/i,
    ],
    rejectPatterns: [
      /fallback/i, // fallbacks are forbidden in Evymo
    ],
    expectRuleSlugs: ["i18n-rules"],
    expectKbTopics: ["segments", "i18n:check", "no fallback"],
    rationale: "KB-grounding: Evymo i18n = segment files + no fallbacks + npm run i18n:check. Obecný i18next tutoriál doporučuje fallbacky.",
  },
  {
    id: "kb-audit-journal",
    group: "kb-grounding",
    band: 1,
    name: "Vysvětlí audit journal pattern z KB",
    messages: [
      "@AISHA Implementuji přístup k citlivým datům uživatele. Jak správně zalogovat tento přístup podle Evymo pravidel?",
    ],
    language: "cs",
    expectPatterns: [
      /audit_journal/i,
      /INSERT INTO audit_journal|audit.journal/i,
      /metadata/i,
    ],
    rejectPatterns: [
      /console\.log/i,
      /email|jmén|name/i, // must NOT suggest logging PII
    ],
    expectRuleSlugs: ["audit-journal-pattern"],
    expectKbTopics: ["audit_journal", "ENTITY_OPERATION", "severity"],
    rationale: "KB-grounding: Evymo audit = audit_journal table + action format ENTITY_OPERATION + no PII v metadata. Obecný logging by navrhl console.log nebo winston.",
  },
  {
    id: "kb-testing-rules",
    group: "kb-grounding",
    band: 1,
    name: "Vysvětlí testovací pravidla z KB",
    messages: [
      "@AISHA Píšu test pro hook useHealthTracking, který volá supabase.rpc. Jak mám správně nastavit mock podle Evymo pravidel?",
    ],
    language: "cs",
    expectPatterns: [
      /vi\.mocked|vi\.mock/i,
      /rpc/i,
    ],
    rejectPatterns: [
      /\.from\(/i, // must NOT suggest mocking .from() when hook uses rpc()
    ],
    expectRuleSlugs: ["testing-rules"],
    expectKbTopics: ["vi.mocked", "mock MUST match implementation"],
    rationale: "KB-grounding: Evymo testování = mock musí odpovídat implementaci (rpc→mock rpc). Obecný Vitest příklad by nezmínil toto specifické pravidlo.",
  },
  {
    id: "kb-dev-laws-combined",
    group: "kb-grounding",
    band: 1,
    name: "Zná kombinaci Evymo dev zákonů",
    messages: [
      "@AISHA Jaké jsou hlavní vývojářské zákony (development laws) platformy Evymo? Vyjmenuj je.",
    ],
    language: "cs",
    expectPatterns: [
      /hook[\s-]*only/i,
      /rpc/i,
      /[Zz]od/i,
      /i18n|useTranslation/i,
      /safeError|console/i,
    ],
    expectRuleSlugs: ["aisha-development-laws"],
    rationale: "KB-grounding: Evymo Development Laws je unikátní soubor 7+ pravidel specifických pro platformu. Žádný obecný LLM to nezná bez KB.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP: kb-cross — Scénáře vyžadující propojení VÍCE pravidel z KB
  //        Band 1 — AISHA musí zkombinovat znalosti z více expert rules
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "kb-cross-new-hook-with-audit",
    group: "kb-cross",
    band: 1,
    name: "Nový hook pro citlivá data — propojí hook + RPC + audit",
    messages: [
      "@AISHA Potřebuji vytvořit nový hook useConsents pro načítání souhlasů partnera. Data jsou citlivá. Jak na to?",
    ],
    language: "cs",
    expectPatterns: [
      /useQuery/i,
      /supabase\.rpc/i,
      /_audited/i,
      /audit/i,
    ],
    expectRuleSlugs: ["hook-design-patterns", "audit-journal-pattern"],
    rationale: "KB-cross: Vyžaduje propojení hook-design-patterns (useQuery+rpc+Zod) + audit-journal-pattern (_audited suffix). Test kompetence AISHA kombinovat pravidla.",
  },
  {
    id: "kb-cross-anon-function-migration",
    group: "kb-cross",
    band: 1,
    name: "Nová anon funkce — propojí SECURITY DEFINER + migration",
    messages: [
      "@AISHA Potřebuji vytvořit novou SQL funkci get_public_programs dostupnou pro anon uživatele, včetně migrace. Jaký je kompletní postup?",
    ],
    language: "cs",
    expectPatterns: [
      /SECURITY DEFINER/i,
      /search_path/i,
      /REVOKE ALL/i,
      /db:migration:register/i,
    ],
    expectRuleSlugs: ["security-definer-pattern", "migration-workflow"],
    rationale: "KB-cross: Propojení security-definer-pattern + migration-workflow. Test, zda AISHA umí dát dohromady bezpečnostní a procesní pravidla.",
  },
  {
    id: "kb-cross-component-with-i18n-error",
    group: "kb-cross",
    band: 1,
    name: "Komponenta s chybovým stavem — propojí i18n + error handling + dev laws",
    messages: [
      "@AISHA Píšu komponentu, která zobrazuje zdravotní data. Jak mám správně ošetřit chybový stav, aby to splnilo všechny Evymo pravidla?",
    ],
    language: "cs",
    expectPatterns: [
      /safeError/i,
      /t\(|useTranslation/i,
      /ErrorBoundary|getUserFacingDataErrorMessage/i,
    ],
    rejectPatterns: [
      /console\.log|console\.error/i,
      /error\.message/i, // must NOT expose raw error.message to user
    ],
    expectRuleSlugs: ["aisha-development-laws"],
    expectKbTopics: ["safeError", "getUserFacingDataErrorMessage", "ErrorBoundary"],
    rationale: "KB-cross: Propojení dev-laws (no console.log, i18n) + error-boundaries (ErrorBoundary, safeError) + security (no raw error to user).",
  },
];

// ═════════════════════════════════════════════════════════════════════════
//  EVALUATION ENGINE
// ═════════════════════════════════════════════════════════════════════════

/**
 * Score a response against expect/reject patterns.
 * Returns { score: 0-100, matchedExpect: [], matchedReject: [], details: string,
 *           appropriateness: 0-100, restraint: 0-100, kbGrounding: 0-100 }
 * @param {string} content - The assistant's response text
 * @param {TestScenario} scenario - The test scenario definition
 * @param {object} [metadata] - Response metadata (rule_slugs, kb_chunk_slugs)
 */
function evaluateResponse(content, scenario, metadata = {}) {
  const expect = scenario.expectPatterns || [];
  const reject = scenario.rejectPatterns || [];

  const matchedExpect = [];
  const missedExpect = [];
  for (const pattern of expect) {
    if (pattern.test(content)) {
      matchedExpect.push(pattern.source);
    } else {
      missedExpect.push(pattern.source);
    }
  }

  const matchedReject = [];
  for (const pattern of reject) {
    if (pattern.test(content)) {
      matchedReject.push(pattern.source);
    }
  }

  // Score: expect matches give positive points, reject matches subtract
  const expectScore = expect.length > 0
    ? (matchedExpect.length / expect.length) * 80
    : 80;

  const rejectPenalty = matchedReject.length * 30;

  // Bonus: response length sanity (too short = probably bad)
  const lengthBonus = content.length > 100 ? 20 : content.length > 50 ? 10 : 0;

  const score = Math.max(0, Math.min(100, Math.round(expectScore - rejectPenalty + lengthBonus)));

  // ── Appropriateness scoring (band-aware) ──────────────────────────────
  const band = scenario.band ?? inferBandFromGroup(scenario.group);
  let appropriateness = 100;
  const contentLen = content.length;

  switch (band) {
    case 1: // MUST CORRECT — response should be directive, detailed
      if (matchedExpect.length === 0) appropriateness = 0;
      else if (matchedReject.length > 0) appropriateness = 20;
      else if (contentLen < 80) appropriateness = 60; // too short for correction
      break;
    case 2: // SHOULD WARN — gentle, not blocking
      if (matchedReject.length > 0) appropriateness = 20;  // too harsh
      else if (matchedExpect.length === 0 && contentLen > 50) appropriateness = 50;  // missed the pattern
      break;
    case 3: // NEUTRAL — discuss, don't prescribe
      if (matchedReject.length > 0) appropriateness = 30;  // too prescriptive
      break;
    case 4: // SHOULD BE SILENT — brief or no response
      if (contentLen > 500) appropriateness = 30;     // way too verbose
      else if (contentLen > 300) appropriateness = 60; // still too talky
      else if (matchedReject.length > 0) appropriateness = 40;
      break;
    case 5: // MUST NOT ANSWER — refuse or redirect
      if (matchedExpect.length === 0) appropriateness = 0;   // didn't refuse
      else if (matchedReject.length > 0) appropriateness = 0; // answered anyway
      break;
  }

  // ── Restraint scoring ─────────────────────────────────────────────────
  let restraint = 100;
  const maxTokens = scenario.maxResponseTokens;
  if (maxTokens) {
    // Rough estimate: 1 token ≈ 4 chars for mixed CS/EN
    const estimatedTokens = Math.ceil(contentLen / 4);
    if (estimatedTokens > maxTokens * 3) restraint = 10;
    else if (estimatedTokens > maxTokens * 2) restraint = 30;
    else if (estimatedTokens > maxTokens * 1.5) restraint = 50;
    else if (estimatedTokens > maxTokens) restraint = 70;
  } else if (band === 4 || band === 5) {
    // Default restraint for bands that should be brief
    const estimatedTokens = Math.ceil(contentLen / 4);
    if (estimatedTokens > 200) restraint = 30;
    else if (estimatedTokens > 100) restraint = 60;
  }

  // ── KB Grounding scoring ──────────────────────────────────────────────
  // Verifies that AISHA actually consulted KB (expert_rules, knowledge_items)
  // rather than relying on general LLM knowledge.
  let kbGrounding = -1; // -1 = n/a (no KB expectations)
  const kbDetails = [];
  const responseSlugs = metadata.rule_slugs ?? [];
  const responseKbSlugs = metadata.kb_chunk_slugs ?? [];

  if (scenario.expectRuleSlugs && scenario.expectRuleSlugs.length > 0) {
    kbGrounding = 0;
    const expectedRules = scenario.expectRuleSlugs;
    const matchedRules = expectedRules.filter(slug =>
      responseSlugs.some(rs => {
        // Handle both full slug and partial match (rules may be returned as objects with .slug)
        const rsSlug = typeof rs === "string" ? rs : (rs?.slug ?? "");
        return rsSlug.includes(slug) || slug.includes(rsSlug);
      })
    );
    const ruleScore = (matchedRules.length / expectedRules.length) * 100;
    kbGrounding = Math.round(ruleScore);
    if (matchedRules.length > 0) {
      kbDetails.push(`📚 rules: ${matchedRules.length}/${expectedRules.length} (${matchedRules.join(", ")})`);
    }
    if (matchedRules.length < expectedRules.length) {
      const missed = expectedRules.filter(s => !matchedRules.includes(s));
      kbDetails.push(`📚 missed rules: ${missed.join(", ")}`);
    }
  }

  if (scenario.expectKbTopics && scenario.expectKbTopics.length > 0) {
    // KB topics are verified in BOTH the content AND the kb_chunk_slugs
    const matchedTopics = scenario.expectKbTopics.filter(topic =>
      content.toLowerCase().includes(topic.toLowerCase()) ||
      responseKbSlugs.some(s => {
        const sStr = typeof s === "string" ? s : (s?.slug ?? "");
        return sStr.toLowerCase().includes(topic.toLowerCase());
      })
    );
    const topicScore = (matchedTopics.length / scenario.expectKbTopics.length) * 100;
    // If we already have kbGrounding from rules, average with topic score
    if (kbGrounding >= 0) {
      kbGrounding = Math.round((kbGrounding + topicScore) / 2);
    } else {
      kbGrounding = Math.round(topicScore);
    }
    if (matchedTopics.length < scenario.expectKbTopics.length) {
      const missed = scenario.expectKbTopics.filter(t => !matchedTopics.includes(t));
      kbDetails.push(`📖 missed topics: ${missed.join(", ")}`);
    }
  }

  // Bonus: if scenario expects KB and response has NO rule_slugs at all → penalize
  if (scenario.expectRuleSlugs && responseSlugs.length === 0) {
    kbGrounding = Math.min(kbGrounding, 20); // cap at 20 if KB was not consulted at all
    kbDetails.push(`⚠ NO rule_slugs in response — KB pipeline may not have been invoked`);
  }

  const details = [];
  if (matchedExpect.length > 0) details.push(`✓ matched: ${matchedExpect.length}/${expect.length} expected patterns`);
  if (missedExpect.length > 0) details.push(`✗ missed: ${missedExpect.map(p => `/${p}/`).join(", ")}`);
  if (matchedReject.length > 0) details.push(`⚠ rejected pattern found: ${matchedReject.join(", ")}`);
  if (band >= 4) details.push(`📏 restraint: ${restraint}/100 (${Math.ceil(contentLen/4)} est. tokens)`);
  if (kbDetails.length > 0) details.push(...kbDetails);

  return {
    score,
    appropriateness,
    restraint,
    kbGrounding,
    band,
    matchedExpect,
    missedExpect,
    matchedReject,
    details: details.join(" | "),
  };
}

/**
 * Infer appropriateness band from group name (for existing scenarios without band).
 */
function inferBandFromGroup(group) {
  switch (group) {
    case "correction": return 1;
    case "nonsense": return 1;
    case "knowledge": return 1;
    case "soft-guidance": return 2;
    case "guidance": return 3;
    case "conversation": return 3;
    case "neutral": return 3;
    case "silence": return 4;
    case "restraint": return 4;
    case "out-of-scope": return 5;
    default: return 3;
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  CHAT CLIENT
// ═════════════════════════════════════════════════════════════════════════

/** @type {string | null} */
let _ephemeralUserId = null;
/** @type {ReturnType<typeof createClient> | null} */
let _adminClient = null;
/** @type {boolean} */
let _isEphemeralUser = false;
/** @type {boolean} */
let _debugEnabledForUser = false;

async function authenticate() {
  if (USE_EPHEMERAL_AUTH) {
    _adminClient = createClient(AISHA_POSTGREST_URL, AISHA_POSTGREST_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: created, error: createErr } = await _adminClient.auth.admin.createUser({
      email: EPHEMERAL_EMAIL,
      password: EPHEMERAL_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "AISHA Eval Bot" },
      app_metadata: { role: "authenticated" },
    });
    if (createErr || !created?.user) {
      throw new Error(`Nepodařilo se vytvořit ephemeral test user: ${createErr?.message ?? "no user"}`);
    }
    _ephemeralUserId = created.user.id;
    _isEphemeralUser = true;
    if (VERBOSE) console.log(`  (ephemeral user ${EPHEMERAL_EMAIL} vytvořen: ${_ephemeralUserId})`);

    if (!IS_PROD) {
      const { error: roleErr } = await _adminClient
        .from("user_roles")
        .upsert({ user_id: _ephemeralUserId, role: "admin" }, { onConflict: "user_id,role" });
      if (roleErr) {
        if (VERBOSE) console.log(`  ⚠ role admin: ${roleErr.message}`);
      } else {
        _debugEnabledForUser = true;
        if (VERBOSE) console.log("  (admin role udělena pro local debug/model override)");
      }
    }

    // Sign in as the new user
    const userClient = createClient(AISHA_POSTGREST_URL, AISHA_POSTGREST_ANON_KEY);
    const { data: signIn, error: signErr } = await userClient.auth.signInWithPassword({
      email: EPHEMERAL_EMAIL,
      password: EPHEMERAL_PASSWORD,
    });
    if (signErr || !signIn.session) {
      throw new Error(`Auth (ephemeral): ${signErr?.message ?? "No session"}`);
    }
    const token = signIn.session.access_token;

    // Seed consent as the signed-in user (grant_consent uses auth.uid())
    const authedClient = createClient(AISHA_POSTGREST_URL, AISHA_POSTGREST_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { error: consentErr } = await authedClient.rpc("grant_consent", {
      p_consent_type: "data_processing",
    });
    if (consentErr) {
      if (VERBOSE) console.log(`  ⚠ grant_consent: ${consentErr.message}`);
    } else if (VERBOSE) {
      console.log("  (consent data_processing udělena)");
    }

    // Seed basic membership so user_can_chat() returns true
    // Uses admin client (service_role) to bypass RLS
    const { error: membershipErr } = await _adminClient
      .from("memberships")
      .insert({ user_id: _ephemeralUserId, tier: "basic", status: "active" });
    if (membershipErr) {
      if (VERBOSE) console.log(`  ⚠ membership: ${membershipErr.message}`);
    } else if (VERBOSE) {
      console.log("  (membership basic udělena)");
    }

    if (IS_PROD) {
      _debugEnabledForUser = false;
    }

    return token;
  }

  // Local / fallback: use config test user
  const supabase = createClient(AISHA_POSTGREST_URL, AISHA_POSTGREST_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`Auth: ${error?.message ?? "No session"}`);
  }
  _debugEnabledForUser = true;
  return data.session.access_token;
}

async function cleanupEphemeralUser() {
  if (!_ephemeralUserId || !AISHA_POSTGREST_SERVICE_KEY) return;
  try {
    const adminClient = _adminClient ?? createClient(AISHA_POSTGREST_URL, AISHA_POSTGREST_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await adminClient.auth.admin.deleteUser(_ephemeralUserId);
    if (VERBOSE) console.log(`  (ephemeral user ${_ephemeralUserId} smazán)`);
  } catch {
    console.warn(`  ⚠ Nepodařilo se smazat ephemeral user ${_ephemeralUserId}`);
  }
}

async function sendMessage(token, { message, language, conversationId }) {
  const url = `${AISHA_POSTGREST_URL}/functions/v1/ai-chat`;
  const body = {
    message,
    language: language ?? "cs",
    debug: _debugEnabledForUser,
  };
  if (conversationId) body.conversation_id = conversationId;
  if (MODEL_OVERRIDE) body.model_override = MODEL_OVERRIDE;

  const start = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: AISHA_POSTGREST_ANON_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const durationMs = Date.now() - start;

  let responseBody = null;
  try {
    responseBody = await response.json();
  } catch {
    // non-JSON
  }

  if (VERBOSE && response.status >= 400) {
    console.log(`    ⚠ HTTP ${response.status}: ${JSON.stringify(responseBody)?.substring(0, 200)}`);
  }

  return { status: response.status, body: responseBody, durationMs };
}

// ═════════════════════════════════════════════════════════════════════════
//  COMPARISON ENGINE
// ═════════════════════════════════════════════════════════════════════════

function loadPreviousReport() {
  if (!existsSync(REPORTS_DIR)) return null;
  const files = readdirSync(REPORTS_DIR)
    .filter(f => f.startsWith(`aisha-eval-${TARGET}-`) && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(REPORTS_DIR, files[0]), "utf-8"));
  } catch {
    return null;
  }
}

function compareWithPrevious(current, previous) {
  if (!previous) return null;

  const diff = {
    previousDate: previous.timestamp,
    overallScoreDelta: current.summary.avgScore - (previous.summary?.avgScore ?? 0),
    improved: [],
    regressed: [],
    unchanged: [],
  };

  for (const result of current.results) {
    const prev = previous.results?.find(r => r.id === result.id);
    if (!prev) continue;

    const delta = result.score - prev.score;
    if (delta > 10) {
      diff.improved.push({ id: result.id, name: result.name, from: prev.score, to: result.score });
    } else if (delta < -10) {
      diff.regressed.push({ id: result.id, name: result.name, from: prev.score, to: result.score });
    } else {
      diff.unchanged.push({ id: result.id });
    }
  }

  return diff;
}

// ═════════════════════════════════════════════════════════════════════════
//  MAIN RUNNER
// ═════════════════════════════════════════════════════════════════════════

async function run() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║       AISHA Behavioral Evaluation Suite                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`Cíl:       ${AISHA_POSTGREST_URL}`);
  console.log(`Režim:     ${IS_PROD ? "PRODUKCE ⚠" : "LOKÁLNÍ"}`);
  console.log(`Target:    ${TARGET}`);
  console.log(`Uživatel:  ${USE_EPHEMERAL_AUTH ? EPHEMERAL_EMAIL + " (ephemeral)" : TEST_EMAIL}`);
  console.log(`Scénářů:   ${SCENARIOS.length}`);
  if (MODEL_OVERRIDE) console.log(`Model:     ${MODEL_OVERRIDE} (override)`);
  if (REQUEST_DELAY_MS > 0) console.log(`Delay:     ${REQUEST_DELAY_MS}ms between requests`);
  if (DRY_RUN) console.log(`Dry-run:   ANO — jen vyhodnotí strukturu, nevolá LLM`);
  console.log("");

  // 1. Filter scenarios (--only group, --band N)
  let scenarios = ONLY_GROUP
    ? SCENARIOS.filter(s => s.group === ONLY_GROUP)
    : SCENARIOS;

  if (ONLY_BAND) {
    scenarios = scenarios.filter(s => (s.band ?? inferBandFromGroup(s.group)) === ONLY_BAND);
  }

  if (scenarios.length === 0) {
    const availGroups = [...new Set(SCENARIOS.map(s => s.group))].join(", ");
    const availBands = [...new Set(SCENARIOS.map(s => s.band ?? inferBandFromGroup(s.group)))].sort().join(", ");
    console.error(`Žádné scénáře pro filtr${ONLY_GROUP ? ` group='${ONLY_GROUP}'` : ""}${ONLY_BAND ? ` band=${ONLY_BAND}` : ""}.`);
    console.error(`Skupiny: ${availGroups}`);
    console.error(`Bandy:   ${availBands}`);
    process.exit(1);
  }

  // Dry-run: list scenarios and exit (no auth needed)
  if (DRY_RUN) {
    console.log(`\n  Dry-run — ${scenarios.length} scénářů k provedení:\n`);
    const bandNames = { 1: "MUST-ACT", 2: "SOFT-WARN", 3: "NEUTRAL", 4: "SILENCE", 5: "REFUSE" };
    for (const s of scenarios) {
      const b = s.band ?? inferBandFromGroup(s.group);
      console.log(`  [B${b}:${(bandNames[b] ?? "?").padEnd(9)}] ${s.group.padEnd(16)} ${s.name}`);
    }
    console.log("");
    process.exit(0);
  }

  // 2. Auth
  let token;
  try {
    process.stdout.write("Autentizace... ");
    token = await authenticate();
    console.log("OK\n");
    if (MODEL_OVERRIDE && !_debugEnabledForUser) {
      console.log("  ⚠ Model override byl vyžádán, ale debug mode není pro tohoto uživatele dostupný; edge může override ignorovat.\n");
    }
  } catch (err) {
    console.error(`FAIL — ${err.message}`);
    console.error(IS_PROD
      ? "Chybí AISHA_POSTGREST_SERVICE_KEY v .env nebo nelze vytvořit ephemeral user na produkci."
      : "Ujisti se, že lokální Supabase běží; pro local preferuj service role key z .env, aby skript použil ephemeral účet místo seedovaného hesla.");
    process.exit(1);
  }

  // 3. Run scenarios
  const results = [];
  const conversationCache = {};
  let currentGroup = "";

  for (const scenario of scenarios) {
    // Group header
    if (scenario.group !== currentGroup) {
      currentGroup = scenario.group;
      const groupNames = {
        correction: "KOREKCE — Opravuje špatné vzory?",
        knowledge: "ZNALOSTI — Zná pravidla platformy?",
        guidance: "NAVIGACE — Vede správným směrem?",
        conversation: "KONVERZACE — Udržuje kontext?",
        nonsense: "NESMYSLY — Odmítá špatné návrhy?",
        "soft-guidance": "MĚKKÁ NAVIGACE — Jemně upozorňuje?",
        neutral: "NEUTRÁL — Diskutuje bez předpisování?",
        silence: "TICHO — Ví kdy neodpovídat?",
        "out-of-scope": "MIMO SCOPE — Odmítá irelevane?",
        restraint: "STRUČNOST — Odpovídá krátce?",
        "kb-grounding": "KB GROUNDING — Čerpá z Knowledge Base?",
        "kb-cross": "KB KŘÍŽENÍ — Kombinuje více pravidel z KB?",
      };
      console.log(`\n── ${groupNames[currentGroup] ?? currentGroup.toUpperCase()} ${"─".repeat(40)}\n`);
    }

    process.stdout.write(`  ${scenario.name}...\n`);

    // Resolve conversation_id for multi-turn
    const conversationId = scenario.reuseConversationFrom
      ? conversationCache[scenario.reuseConversationFrom]
      : undefined;

    // Send message(s)
    const messages = Array.isArray(scenario.messages) ? scenario.messages : [scenario.messages];
    let lastResponse = null;
    let totalDuration = 0;

    for (const msg of messages) {
      try {
        lastResponse = await sendMessage(token, {
          message: msg,
          language: scenario.language,
          conversationId: lastResponse?.body?.conversation_id ?? conversationId,
        });
        totalDuration += lastResponse.durationMs;
      } catch (err) {
        console.warn(`[test-aisha-chat] sendMessage failed for scenario "${scenario.id}":`, err.message ?? err);
        lastResponse = { status: 0, body: null, durationMs: 0 };
        break;
      }
    }

    // Cache conversation_id
    if (lastResponse?.body?.conversation_id) {
      conversationCache[scenario.id] = lastResponse.body.conversation_id;
    }

    // Evaluate response
    const content = lastResponse?.body?.message?.content ?? "";
    const meta = lastResponse?.body?.metadata ?? {};
    const evaluation = evaluateResponse(content, scenario, meta);

    const metrics = {
      tokens_used: meta.tokens_used,
      response_time_ms: meta.response_time_ms ?? totalDuration,
      specialist_used: meta.specialist_used,
      agent_name: meta.agent_name,
      model: meta.aisha_model_selected,
      complexity: meta.aisha_model_complexity,
      aisha_hint: meta.aisha_participation_hint,
      run_id: meta.run_id,
      workflow: meta.workflow_name,
      tool_iterations: meta.tool_iterations,
      kb_chunk_slugs: meta.kb_chunk_slugs ?? [],
      rule_slugs: meta.rule_slugs ?? [],
    };

    // Print result
    const scoreLabel = evaluation.score >= 80
      ? `\x1b[32m${evaluation.score}\x1b[0m`  // green
      : evaluation.score >= 50
        ? `\x1b[33m${evaluation.score}\x1b[0m`  // yellow
        : `\x1b[31m${evaluation.score}\x1b[0m`; // red

    const statusIcon = lastResponse?.status === 200 ? "🟢" : "🔴";
    const timeLabel = `${totalDuration}ms`;
    const modelLabel = metrics.model ? ` [${metrics.model}]` : "";
    const kbLabel = evaluation.kbGrounding >= 0 ? ` KB:${evaluation.kbGrounding}` : "";

    console.log(`    ${statusIcon} Score: ${scoreLabel}/100${kbLabel}  (${timeLabel}${modelLabel})`);
    if (evaluation.details) {
      console.log(`    ${evaluation.details}`);
    }

    if (VERBOSE && content) {
      const preview = content.substring(0, 400).replace(/\n/g, "\n    │ ");
      console.log(`    ┌─ AISHA odpověď:\n    │ ${preview}${content.length > 400 ? "\n    │ ..." : ""}\n    └─`);
    }

    results.push({
      id: scenario.id,
      name: scenario.name,
      group: scenario.group,
      band: evaluation.band,
      rationale: scenario.rationale,
      score: evaluation.score,
      appropriateness: evaluation.appropriateness,
      restraint: evaluation.restraint,
      kbGrounding: evaluation.kbGrounding,
      passed: evaluation.score >= 50,
      status: lastResponse?.status ?? 0,
      durationMs: totalDuration,
      evaluation: {
        matchedExpect: evaluation.matchedExpect,
        missedExpect: evaluation.missedExpect,
        matchedReject: evaluation.matchedReject,
      },
      metrics,
      responsePreview: content.substring(0, 500) || null,
      messagesSent: messages,
    });

    // Cooldown between requests — prevents edge runtime BOOT_ERROR under load
    if (REQUEST_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════

  console.log("\n" + "═".repeat(64));
  console.log("  SOUHRN EVALUACE");
  console.log("═".repeat(64));

  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;
  const avgScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
  const totalTime = results.reduce((s, r) => s + r.durationMs, 0);

  console.log(`\n  Celkem: ${results.length} scénářů | ${passCount} OK | ${failCount} FAIL`);
  console.log(`  Průměrné skóre: ${avgScore}/100`);
  console.log(`  Celkový čas: ${(totalTime / 1000).toFixed(1)}s`);

  // Per-group summary
  const groups = [...new Set(results.map(r => r.group))];
  console.log("");
  for (const group of groups) {
    const gr = results.filter(r => r.group === group);
    const gAvg = Math.round(gr.reduce((s, r) => s + r.score, 0) / gr.length);
    const gPass = gr.filter(r => r.passed).length;
    const icon = gPass === gr.length ? "✅" : gAvg >= 50 ? "⚠️ " : "❌";
    console.log(`  ${icon} ${group.padEnd(16)} ${gAvg}/100  (${gPass}/${gr.length})`);
  }

  // Per-band summary
  const bandNames = { 1: "MUST-ACT", 2: "SOFT-WARN", 3: "NEUTRAL", 4: "SILENCE", 5: "REFUSE" };
  const bands = [...new Set(results.map(r => r.band))].filter(Boolean).sort();
  if (bands.length > 1) {
    console.log("\n  Per-band:");
    for (const band of bands) {
      const br = results.filter(r => r.band === band);
      const bAvg = Math.round(br.reduce((s, r) => s + r.score, 0) / br.length);
      const bPass = br.filter(r => r.passed).length;
      const icon = bPass === br.length ? "✅" : bAvg >= 50 ? "⚠️ " : "❌";
      console.log(`  ${icon} B${band} ${(bandNames[band] ?? "?").padEnd(10)} ${bAvg}/100  (${bPass}/${br.length})`);
    }
  }

  // KB Grounding summary
  const kbResults = results.filter(r => r.kbGrounding >= 0);
  if (kbResults.length > 0) {
    const kbAvg = Math.round(kbResults.reduce((s, r) => s + r.kbGrounding, 0) / kbResults.length);
    const kbFull = kbResults.filter(r => r.kbGrounding === 100).length;
    const kbZero = kbResults.filter(r => r.kbGrounding === 0).length;
    console.log(`\n  📚 KB Grounding: ${kbAvg}/100 avg (${kbFull} perfect, ${kbZero} missed, ${kbResults.length} total)`);
    if (kbZero > 0) {
      const missed = kbResults.filter(r => r.kbGrounding === 0);
      for (const m of missed) {
        console.log(`    ✗ ${m.name} — KB not consulted`);
      }
    }
  }

  // Model & specialist usage
  const allModels = [...new Set(results.map(r => r.metrics.model).filter(Boolean))];
  const allSpecialists = [...new Set(results.map(r => r.metrics.specialist_used).filter(Boolean))];
  if (allModels.length) console.log(`\n  Modely:       ${allModels.join(", ")}`);
  if (allSpecialists.length) console.log(`  Specialisté:  ${allSpecialists.join(", ")}`);

  // Worst performers
  const worst = results.filter(r => r.score < 50).sort((a, b) => a.score - b.score);
  if (worst.length > 0) {
    console.log("\n  ⚠ Nejhůře hodnocené scénáře:");
    for (const w of worst.slice(0, 5)) {
      console.log(`    • ${w.name} (${w.score}/100) — ${w.rationale}`);
    }
  }

  // ── Save report ────────────────────────────────────────────────────────
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const report = {
    timestamp: new Date().toISOString(),
    target: AISHA_POSTGREST_URL,
    mode: TARGET,
    modelOverride: MODEL_OVERRIDE || null,
    summary: {
      total: results.length,
      passed: passCount,
      failed: failCount,
      avgScore,
      totalTimeMs: totalTime,
    },
    models: allModels,
    specialists: allSpecialists,
    groups: Object.fromEntries(groups.map(g => {
      const gr = results.filter(r => r.group === g);
      return [g, {
        avgScore: Math.round(gr.reduce((s, r) => s + r.score, 0) / gr.length),
        passed: gr.filter(r => r.passed).length,
        total: gr.length,
      }];
    })),
    bands: Object.fromEntries(bands.map(b => {
      const br = results.filter(r => r.band === b);
      return [b, {
        name: bandNames[b] ?? "unknown",
        avgScore: Math.round(br.reduce((s, r) => s + r.score, 0) / br.length),
        passed: br.filter(r => r.passed).length,
        total: br.length,
      }];
    })),
    kbGrounding: kbResults.length > 0 ? {
      avgScore: Math.round(kbResults.reduce((s, r) => s + r.kbGrounding, 0) / kbResults.length),
      perfect: kbResults.filter(r => r.kbGrounding === 100).length,
      missed: kbResults.filter(r => r.kbGrounding === 0).length,
      total: kbResults.length,
    } : null,
    results,
  };

  const reportPath = join(REPORTS_DIR, `aisha-eval-${TARGET}-${timestamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  Report: ${reportPath.replace(ROOT + "/", "")}`);

  // ── Compare with previous ──────────────────────────────────────────────
  if (COMPARE) {
    const previous = loadPreviousReport();
    if (previous) {
      const diff = compareWithPrevious(report, previous);
      if (diff) {
        console.log(`\n  Porovnání s: ${diff.previousDate}`);
        console.log(`  Celkové skóre: ${diff.overallScoreDelta > 0 ? "+" : ""}${diff.overallScoreDelta.toFixed(0)} bodů`);
        if (diff.improved.length) {
          console.log("  Zlepšení:");
          for (const i of diff.improved) console.log(`    ↑ ${i.name}: ${i.from} → ${i.to}`);
        }
        if (diff.regressed.length) {
          console.log("  Zhoršení:");
          for (const r of diff.regressed) console.log(`    ↓ ${r.name}: ${r.from} → ${r.to}`);
        }
      }
    } else {
      console.log("\n  (Žádný předchozí report k porovnání)");
    }
  }

  console.log("");
  await cleanupEphemeralUser();
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error("Suite crashed:", err.message);
  await cleanupEphemeralUser();
  process.exit(2);
});
