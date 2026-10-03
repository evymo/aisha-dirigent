/**
 * Explicitní `name:` ve compose nese identitu instance, ne implementaci (CLASS gate)
 *
 * TŘÍDA VADY: volume/network `name:` v docker-compose je NATVRDO nebo nese
 * IMPLEMENTAČNÍ prefix (`aisha`, `SERVICE_ALIAS_PREFIX` — stejný pro každou
 * instanci). Coolify per-app prefix takové explicitní `name:` OBCHÁZÍ, takže
 * dvě instance na jednom hostu dostanou TÝŽ volume → sdílejí data.
 *
 * Naměřeno 2026-08-09: jeden Coolify, 164 aplikací, 6+ nájemníků, PĚT Keycloaků
 * hlásících se týmž aliasem. 65 explicitních `name:` napříč 24 compose neslo
 * `aisha` / `SERVICE_ALIAS_PREFIX`. Přeprefixováno na `${APP_NAME_PREFIX}` (=
 * identita zákazníka, jediné jednoznačné jméno na sdílené síti); generační
 * přípony v2/v3 zahozeny (wipe-clean, rozhodnutí uživatele).
 *
 * ── DVA PREFIXY (nezaměňovat) ─────────────────────────────────────────────
 *   serviceAliasPrefix = jméno IMPLEMENTACE (`aisha` pro každou instanci) —
 *     legitimní jen pro aliasy UVNITŘ stacku, nikdy pro jméno na sdíleném hostu.
 *   deployPrefix / APP_NAME_PREFIX = identita ZÁKAZNÍKA — vše na sdíleném
 *     hostiteli (volumes, sítě) musí nést tohle.
 *
 * INVARIANT: každé explicitní `name:` v docker-compose je BUĎ `coolify` (sdílená
 * ingress síť, záměr), NEBO obsahuje `${` a odkaz na identitu/instanční
 * proměnnou — nikdy literál a nikdy `SERVICE_ALIAS_PREFIX` (ten je pro všechny
 * stejný, tedy kolizní).
 *
 * Ověřeno i chováním: render všech compose s prefixem `aisha` vs `testfork` →
 * průnik plně rozvinutých jmen = ∅.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();

/** `coolify` je záměrně sdílená ingress síť — jediná legitimní literální výjimka. */
const SHARED_LITERAL = new Set(["coolify"]);
/** Prefix, který je pro KAŽDOU instanci stejný → v `name:` je kolizní. */
const IMPL_ALIAS = "SERVICE_ALIAS_PREFIX";

interface Violation { file: string; line: number; name: string; why: string }

function composeFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "docker-compose*.yml", "docker-compose*.yaml"], {
    cwd: ROOT, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

export function findNonInstanceNames(file: string, content: string): Violation[] {
  const out: Violation[] = [];
  content.split("\n").forEach((raw, i) => {
    const m = raw.match(/^\s+name:\s*(\S.*?)\s*$/);
    if (!m) return;
    const name = m[1];
    if (SHARED_LITERAL.has(name)) return;
    if (!name.includes("${")) {
      out.push({ file, line: i + 1, name, why: "literál — dvě instance dostanou týž objekt" });
      return;
    }
    // IMPL_ALIAS hledej jen ve JMÉNECH proměnných, ne v `:?`/`:-` chybovém textu:
    // `${X:?...SERVICE_ALIAS_PREFIX...}` je komentář o dodání, ne kolizní jméno.
    const varNames = [...name.matchAll(/\$\{([A-Z0-9_]+)(?=[:}])/g)].map((mm) => mm[1]);
    if (varNames.includes(IMPL_ALIAS)) {
      out.push({ file, line: i + 1, name, why: `${IMPL_ALIAS} je pro každou instanci stejný → kolizní` });
    }
  });
  return out;
}

describe("explicitní name: ve compose nese identitu instance", () => {
  test("žádné name: není literál ani nese implementační alias", () => {
    const violations: Violation[] = [];
    for (const f of composeFiles()) {
      violations.push(...findNonInstanceNames(f, readFileSync(join(ROOT, f), "utf-8")));
    }
    if (violations.length) {
      const msg = violations.map((v) => `  ${v.file}:${v.line}  name: ${v.name}\n    → ${v.why}`).join("\n");
      throw new Error(
        `Nalezeno ${violations.length} name: bez identity instance.\n` +
          `Coolify per-app prefix explicitní name: obchází → dvě instance na hostu sdílejí objekt.\n` +
          `Použij \${APP_NAME_PREFIX:?…} (identita), ne literál a ne \${SERVICE_ALIAS_PREFIX} (stejný pro všechny).\n\n${msg}`,
      );
    }
    expect(violations).toEqual([]);
  });

  test("regrese: PKI DB volume a shared-net nesou APP_NAME_PREFIX", () => {
    const pki = readFileSync(join(ROOT, "docker-compose.coolify-pki.yml"), "utf-8");
    expect(/name:\s*\$\{APP_NAME_PREFIX[^}]*\}_pki-db-data/.test(pki), "pki-db-data musí být instanční").toBe(true);
    // ⛔ Tohle tvrzení stálo na `docker-compose.coolify-shared.yml`, který byl
    // 2026-08-26 ODSTRANĚN (MinIO se přestěhoval do jádra). Síť `shared-net`
    // je ale pořád instanční a deklaruje ji každý compose, který ji používá —
    // měří se tedy na jádru, které nikam nezmizí.
    const core = readFileSync(join(ROOT, "docker-compose.coolify.yml"), "utf-8");
    expect(/name:\s*\$\{APP_NAME_PREFIX[^}]*\}-shared-net/.test(core), "shared-net musí být instanční").toBe(true);
  });

  // Negativní testy — brána, která nemůže padnout, není brána.
  test("literál (mimo coolify) je nález", () => {
    const s = "    name: aisha_pki-db-data";
    expect(findNonInstanceNames("x.yml", s).map((v) => v.name)).toEqual(["aisha_pki-db-data"]);
  });

  test("SERVICE_ALIAS_PREFIX v name: je nález (stejný pro všechny instance)", () => {
    const s = "    name: ${SERVICE_ALIAS_PREFIX}_local-ingest-out";
    expect(findNonInstanceNames("x.yml", s).length).toBe(1);
  });

  test("SERVICE_ALIAS_PREFIX jen v :? chybovém textu není nález", () => {
    const s = "    name: ${APP_NAME_PREFIX:?dřív to bylo SERVICE_ALIAS_PREFIX}_local-ingest-out";
    expect(findNonInstanceNames("x.yml", s)).toEqual([]);
  });

  test("coolify je povolený sdílený literál", () => {
    expect(findNonInstanceNames("x.yml", "    name: coolify")).toEqual([]);
  });

  test("APP_NAME_PREFIX identita je v pořádku", () => {
    const s = "    name: ${APP_NAME_PREFIX:?identita}_pki-db-data";
    expect(findNonInstanceNames("x.yml", s)).toEqual([]);
  });

  test("NETSEG_*_NET (instanční, z generate-secrets) je v pořádku", () => {
    const s = "    name: ${NETSEG_BACKEND_NET:?dodává generate-secrets}";
    expect(findNonInstanceNames("x.yml", s)).toEqual([]);
  });
});
