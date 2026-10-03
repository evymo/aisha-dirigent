/**
 * Resolver Env Inputs Completeness Gate
 *
 * OWNS: the invariant that `RESOLVER_ENV_INPUTS` in scripts/lib/derive-domains.mjs
 * lists EVERY environment variable that file actually reads.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 * Gates that exercise the topology resolver must invoke it with those inputs
 * STRIPPED. Otherwise an ambient deployment value steers the run and the gate
 * reports the caller's environment rather than the code — green on a clean
 * machine, red for anyone who sourced an env file, and never actually testing
 * the reference topology it claims to test.
 *
 * Measured 2026-07-19: a pre-push shell had sourced .env-prod-backup (for
 * OPENXPKI_OPERATOR_PASSWORD) and 5 gate files / 11 tests failed while the
 * code was fine.
 *
 * The first fix gave two gates their own hand-copied list. By 2026-08-01 both
 * copies had drifted to 8 of the resolver's 14 inputs — AISHA_SUBDOMAIN_PREFIX,
 * APP_NAME_PREFIX, AISHA_INSTANCE, AISHA_INSTANCE_CONFIG_DIR,
 * AISHA_SERVICE_ALIAS_PREFIX and LOCAL_INGEST_DROP_HOST_DIR could all still
 * contaminate a verdict. A copied list is a list that rots.
 *
 * So the list now lives once, is exported, and THIS gate keeps it honest: it
 * greps the env reads the resolver executes and demands an exact match. Adding
 * a new input to the resolver fails here until the list learns it — the one
 * place where forgetting is otherwise invisible.
 *
 * ── WHY IT FOLLOWS THE OVERLAY DOOR ───────────────────────────────────────
 * `AISHA_INSTANCE_CONFIG_DIR` may be read by exactly one file
 * (scripts/lib/instance-overlay.mjs) — the sibling gate
 * overlay-jde-jen-jednemi-dvermi.gate.test.ts enforces that. The resolver
 * therefore delegates instead of reading it, and a scan of the resolver's own
 * lines concludes the declaration is dead. It is not: the variable still steers
 * the result, just through the mandated door.
 *
 * Two gates measuring one variable from two angles must agree, so this one
 * reads through the door as well. That also surfaced a genuinely undeclared
 * input: instance-overlay.mjs reads AISHA_OVERLAY_REQUIRED via
 * `process.env[CONST]`, which no `process.env.X` pattern can see.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const RESOLVER = join(ROOT, "scripts/lib/derive-domains.mjs");

/**
 * Comments stripped first. Without that, prose describing the mechanism —
 * including this gate's own explanation, which cites `process.env.X` as an
 * example — is scanned as code and reported as an undeclared input. Caught the
 * first time this gate ran: it flagged a variable literally named "X".
 *
 * ⛔ POŘADÍ: NEJDŘÍV ŘÁDKOVÉ, PAK BLOKOVÉ (naměřeno 2026-09-13).
 * Do té doby šly blokové první — a derive-domains.mjs má na ř. ~1807 řádkový
 * komentář `// … /* to svc-ai-chat:3011.` Samotné `/*` v něm vzal blokový
 * vzor za začátek bloku a sežral všechno až k nejbližšímu `*\/` o 800 řádků
 * níž. Čtení prostředí v tom úseku byla pro bránu NEVIDITELNÁ: přidané
 * `process.env.KEYCLOAK_REALM` se hlásilo jako „declared but never read".
 * Na HEAD 5d00abe11 v tom úseku žádné čtení nebylo, takže díra nic neskrývala
 * — jen čekala. Prohozené pořadí dává na HEAD TOTOŽNOU množinu (změřeno) a
 * řádek `//… /*` se odstraní dřív, než může otevřít blok.
 */
function stripComments(src: string): string {
  return src
    .replace(/(^|[^:])\/\/.*$/gm, "$1") // line comments (not the // in a URL)
    .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
}

/**
 * Env reads in ONE file: `process.env.NAME` plus `process.env[CONST]` resolved
 * against the string constants that file declares. A bracket read names the
 * variable holding the key, never the key, so without the second half the read
 * is invisible — which is how AISHA_OVERLAY_REQUIRED stayed undeclared.
 */
function envReadsIn(file: string): string[] {
  return envReadsInText(readFileSync(file, "utf-8"));
}

function envReadsInText(text: string): string[] {
  const src = stripComments(text);
  const names = new Set<string>();
  for (const m of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) names.add(m[1]);

  const consts = new Map<string, string>();
  const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([A-Z_][A-Z0-9_]*)['"]/g;
  for (const m of src.matchAll(decl)) consts.set(m[1], m[2]);
  for (const m of src.matchAll(/process\.env\[\s*([A-Za-z_$][\w$]*)\s*\]/g)) {
    const resolved = consts.get(m[1]);
    if (resolved) names.add(resolved);
  }
  return [...names];
}

/**
 * Every env var the resolver EXECUTES a read of — its own lines plus the reads
 * the local modules it imports perform on its behalf. Delegating a read does
 * not stop an ambient value from steering the verdict, so it must not stop the
 * variable from being declared and stripped.
 */
function envReadsInSource(): string[] {
  const names = new Set<string>(envReadsIn(RESOLVER));
  const src = stripComments(readFileSync(RESOLVER, "utf-8"));
  for (const m of src.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)) {
    const dep = join(dirname(RESOLVER), m[1]);
    if (existsSync(dep)) for (const name of envReadsIn(dep)) names.add(name);
  }
  for (const name of envReadsFromCatalog()) names.add(name);
  return [...names].sort();
}

/**
 * Vstupy, které resolver čte NEPŘÍMO — hodnotou z katalogu.
 *
 * ⛔ NAMĚŘENO 2026-08-21, slepé místo téhle brány. `AISHA_WEB_PUBLIC_ALIASES`
 * v `derive-domains.mjs` nikde nestojí jako `process.env.…` — do resolveru
 * vstupuje jako HODNOTA katalogového pole (`web.public_aliases_env`) a
 * rozvine ho `substitute()`. Brána ho tedy viděla jako „deklarováno, ale
 * nikdy nečteno" a tlačila na jeho odstranění ze seznamu.
 *
 * Důsledek toho, že v seznamu chyběl: `aisha-env-doctor` spuštěný v holém
 * shellu spočítal `WEB_ALIAS_ORIGINS` bez aliasu `corp` a tou zkrácenou
 * hodnotou PŘEPSAL SoT. Ztráta veřejného jména se tvářila jako oprava driftu.
 *
 * Univerzum se HLEDÁ v katalogu, nevypisuje: `*_env` pole (hodnota je jméno
 * proměnné) a `${VAR}` odkazy uvnitř hodnot. Zdroj je týž soubor, ze kterého
 * čte i resolver — jedna otázka, jedna odpověď.
 */
function envReadsFromCatalog(): string[] {
  const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf-8"));
  const names = new Set<string>();
  const projdi = (uzel: unknown): void => {
    if (Array.isArray(uzel)) return uzel.forEach(projdi);
    if (!uzel || typeof uzel !== "object") return;
    for (const [k, v] of Object.entries(uzel as Record<string, unknown>)) {
      if (k.endsWith("_env") && typeof v === "string" && /^[A-Z][A-Z0-9_]*$/.test(v)) names.add(v);
      if (typeof v === "string") {
        for (const m of v.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}/g)) names.add(m[1]);
      } else projdi(v);
    }
  };
  projdi(katalog.services ?? {});
  return [...names];
}

describe("Resolver env inputs — the declared list matches what the code reads", () => {
  test("negativní sonda: `/*` uvnitř řádkového komentáře nespolkne čtení za ním", () => {
    // Přesně tvar, který 2026-09-13 schoval KEYCLOAK_REALM: řádkový komentář
    // s `/*`, čtení, a skutečný blokový komentář až o kus dál.
    const zdroj = [
      "// proxy /* to svc-ai-chat:3011.",
      "const a = process.env.SONDA_ZA_KOMENTAREM;",
      "/* skutečný blok s process.env.SONDA_V_BLOKU */",
      'const u = "https://example.invalid/x"; const b = process.env.SONDA_ZA_URL;',
      "// process.env.SONDA_V_RADKOVEM",
    ].join("\n");
    const cteni = envReadsInText(zdroj).sort();
    expect(cteni, "čtení za `// … /*` zmizelo — brána by nový vstup neviděla").toEqual([
      "SONDA_ZA_KOMENTAREM",
      "SONDA_ZA_URL",
    ]);
  });

  test("RESOLVER_ENV_INPUTS is exported and non-trivial", () => {
    expect(Array.isArray(RESOLVER_ENV_INPUTS), "must be an exported array").toBe(true);
    expect(RESOLVER_ENV_INPUTS.length, "a near-empty list would silently neutralize nothing")
      .toBeGreaterThan(5);
  });

  test("every env var the resolver reads is declared", () => {
    const actual = envReadsInSource();
    const declared = new Set(RESOLVER_ENV_INPUTS);
    const missing = actual.filter((k) => !declared.has(k));
    expect(
      missing,
      "these are read by derive-domains.mjs but absent from RESOLVER_ENV_INPUTS, so gates " +
        "cannot strip them and an ambient value will steer their verdict:\n" + missing.join("\n"),
    ).toEqual([]);
  });

  test("nothing is declared that the resolver does not read", () => {
    const actual = new Set(envReadsInSource());
    const stale = RESOLVER_ENV_INPUTS.filter((k) => !actual.has(k));
    expect(
      stale,
      "declared but never read — either the resolver dropped the input (remove it here) " +
        "or it was a typo that has been neutralizing nothing:\n" + stale.join("\n"),
    ).toEqual([]);
  });

  test("gates that exercise the resolver import the list rather than copying it", () => {
    // A local copy is what rotted last time. Pin the import so the next author
    // cannot quietly reintroduce a second source of truth.
    const consumers = [
      "src/tests/gates/traefik-host-coverage.gate.test.ts",
      "src/tests/gates/instance-subdomain-namespace.gate.test.ts",
      // Izolace derivace v procesu (2026-09-13) — brány povrchu ji importují.
      "src/tests/gates/lib/izolovana-derivace.ts",
    ];
    const offenders: string[] = [];
    for (const file of consumers) {
      const src = readFileSync(join(ROOT, file), "utf-8");
      if (!src.includes("RESOLVER_ENV_INPUTS")) continue;
      const imports = /import\s*\{[^}]*RESOLVER_ENV_INPUTS[^}]*\}\s*from/.test(src);
      const declares = /const\s+RESOLVER_ENV_INPUTS\s*=/.test(src);
      if (declares || !imports) offenders.push(file);
    }
    expect(
      offenders,
      "these gates keep their own copy of the resolver input list — import it from " +
        "scripts/lib/derive-domains.mjs instead:\n" + offenders.join("\n"),
    ).toEqual([]);
  });
});
