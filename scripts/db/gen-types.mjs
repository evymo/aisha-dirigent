#!/usr/bin/env node
/**
 * TypeScript Type Generator
 *
 * Generates TypeScript types from the AISHA Postgres schema and writes to
 * src/integrations/db/types.ts
 *
 * Usage:
 *   node scripts/db/gen-types.mjs           # Remote DB (uses AISHA_DB_URL)
 *   node scripts/db/gen-types.mjs --local    # Local AISHA stack (AISHA_LOCAL_DB_URL or default 57422)
 *   node scripts/db/gen-types.mjs --preview  # Print to stdout only
 *
 * Requires: supabase CLI (npx, verze připnutá v TYPEGEN_CLI níž) or globally installed
 * No local Supabase project needed — uses --db-url directly.
 *
 * @module
 */
import { execFileSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { localDbUrl } from "./lib/local-db.mjs";
import { adresaProGeneratorTypu } from "./lib/typegen-db-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUTPUT_PATH = path.join(
  ROOT,
  "src",
  "integrations",
  "db",
  "types.ts"
);
// Mobile shares the same single DB-generated source of truth — one gen step
// emits both surfaces' types. Web consumes types.ts; mobile-app consumes
// database.ts (which types its @aisha/api-core client).
const MOBILE_OUTPUT_PATH = path.join(ROOT, "mobile-app", "src", "types", "database.ts");
const MOBILE_HEADER =
  "// AUTO-GENERATED from the AISHA DB by `npm run db:types:gen` — DO NOT EDIT.\n" +
  "// Mirror of src/integrations/db/types.ts (web); same single DB source of truth.\n\n";

/**
 * Neutralize the upstream type-gen CLI's vendor-named internal key so the emitted
 * types carry no third-party vendor brand (enforced by the AISHA branding gate —
 * which is also why this matcher avoids embedding the vendor literal itself). The
 * CLI emits a boilerplate `Omit<Database, "__Internal…">` helper key (a no-op
 * Omit — the key is not a real Database property; and the same token on the
 * property if a future CLI version adds it). Renaming the whole `__Internal…`
 * family to one brand-neutral, descriptive name keeps every occurrence consistent
 * (so the Omit still matches the property if it ever appears). Applied identically
 * to both surfaces so web + mobile stay byte-consistent.
 */
function sanitizeGeneratedTypes(src) {
  return src.replace(/__Internal[A-Za-z]+/g, "__InternalSchema");
}

const isLocal = process.argv.includes("--local");
const isPreview = process.argv.includes("--preview");

// Determine DB URL.
// In --local mode: use AISHA_LOCAL_DB_URL (default: e2e stack at 57422).
// Set AISHA_LOCAL_DB_URL to target the warmup stack at 54322 instead.
const dbUrl = isLocal
  ? localDbUrl
  : (process.env.AISHA_DB_URL || process.env.DATABASE_URL);

if (!dbUrl && !isLocal) {
  console.error("❌ AISHA_DB_URL or DATABASE_URL required (or use --local)");
  process.exit(2);
}

console.log(
  `\n🔧 Generating types from ${isLocal ? `local AISHA stack (${dbUrl.replace(/:[^:@]*@/, ":***@")})` : "remote DB"}...`
);

/**
 * ⛔ PŘIPNUTÁ VERZE, NE `@latest` (2026-09-26). `@latest` stáhl 25. 9.
 * ve 13:25Z verzi 2.118.0 a od té chvíle generace typů nad zahazovací DB padá
 * („Is the DB accessible?") — sync kola 6 i schválení pluginů. Nepinovaná
 * verze nástroje, který ZAPISUJE soubor v repu, dělá z cizího vydání náš
 * rozbitý build. 2.118 navíc mění výstupní formát (neformátovaný TS) a brána
 * db-types-cover-exposed-rpcs v něm nic nepozná (fork 29. 9.: 681 „chybějících“
 * RPC). Zvednout = vědomý PR s přegenerovanými typy.
 */
const TYPEGEN_CLI = "supabase@2.117.0";

try {
  // execFileSync (no shell) — the db-url is passed as a literal argv entry, so
  // passwords/URLs with shell metacharacters can't be misinterpreted.
  //
  // maxBuffer: the generated types for the full AISHA schema exceed Node's
  // default 1 MB capture buffer (1600+ public functions → ~1.3 MB of emitted
  // TS). Without raising it, gen types fails with ENOBUFS once the schema grows
  // past the default. Mirrors MAX_BUFFER in scripts/db/migrate.mjs.
  const rawOutput = execFileSync(
    "npx",
    // Loopback bez SSL → sslmode=disable (CLI ≥ 2.118 jinak zkouší TLS a padá), viz lib.
    ["--yes", TYPEGEN_CLI, "gen", "types", "typescript", "--db-url", adresaProGeneratorTypu(dbUrl)],
    {
      encoding: "utf-8",
      cwd: ROOT,
      maxBuffer: 100 * 1024 * 1024, // 100 MB
    }
  );
  const output = sanitizeGeneratedTypes(rawOutput);

  if (isPreview) {
    console.log(output);
    console.log("--- Preview mode: file NOT written ---");
  } else {
    mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, output);
    const lineCount = output.split("\n").length;
    console.log(`✅ Types written to src/integrations/db/types.ts (${lineCount} lines)`);

    // One step → both surfaces. Mobile gets the same generated Database type.
    mkdirSync(path.dirname(MOBILE_OUTPUT_PATH), { recursive: true });
    writeFileSync(MOBILE_OUTPUT_PATH, MOBILE_HEADER + output);
    console.log(`✅ Types written to mobile-app/src/types/database.ts (${lineCount} lines)\n`);
  }
} catch (error) {
  const stderr = String(error.stderr || error.message || "");
  console.error("❌ Type generation failed:", error.message);
  if (/password authentication failed/i.test(stderr)) {
    console.error(
      "   Auth rejected. If the local DB is the cold-start stack (generated\n" +
        "   password), use: npm run db:types:refresh:throwaway"
    );
  } else if (/connection refused|could not connect|no route to host|timeout/i.test(stderr)) {
    console.error("   DB neodpovídá — běží? Check AISHA_DB_URL or use --local");
  } else {
    // ⛔ Nehádat (2026-09-29): „Is the DB accessible?“ se tiskl i u TLS chyby CLI, kdy DB
    // běžela. Příčinu říká stderr CLI níž — ten je rozhodující.
    console.error("   Příčina je ve výpisu CLI níž (DB může běžet — chyba může být v CLI/spojení).");
  }
  // Skutečná příčina je ve stderr CLI — bez ní „není dostupná" hádá (filtr výstupu
  // nesmí schovat chybu). Heslo z db-url se do výpisu nedostane: CLI ho netiskne
  // a pro jistotu se maskuje.
  const konec = stderr.trim().split("\n").slice(-15).join("\n").replace(/:\/\/([^:@\s]+):[^@\s]*@/g, "://$1:***@");
  if (konec) console.error(`   stderr CLI (${TYPEGEN_CLI}):\n${konec}`);
  process.exit(1);
}
