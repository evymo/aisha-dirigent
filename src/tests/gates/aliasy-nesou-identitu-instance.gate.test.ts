/**
 * Aliasy na sdílené síti nesou identitu INSTANCE (CLASS gate)
 *
 * TŘÍDA VADY: compose ke každé službě automaticky přidá síťový alias rovný
 * jménu služby a Coolify připojí každý kontejner na SDÍLENOU síť `coolify`.
 * Dva nájemníci se stejně pojmenovanou službou si tak nárokují TÝŽ alias a
 * Docker DNS mezi nimi STŘÍDÁ (round-robin). Půlka spojení jde k cizímu.
 *
 * NAMĚŘENO 2026-08-10 na produkci: alias `pki-db` odpovídaly DVA kontejnery —
 * náš a cizího nájemníka. OpenXPKI se proto zhruba v půlce pokusů přihlašoval
 * do cizí databáze, byl odmítnut, realm CA se nikdy nezaložila, `pki-init` po
 * 600 s fail-closed a `aisha-core` nenaběhl. Kolidovalo 16 aliasů.
 *
 * DVĚ ROVINY ZÁVAŽNOSTI:
 *   - `redis`, `pki-db` mají heslo → cizí spojení skončí odmítnutím. Data
 *     nepřetečou, ALE naše přihlašovací údaje se cizí službě odešlou.
 *   - `clamd` autentizaci NEMÁ (protokol žádnou nezná) → `INSTREAM` pošle
 *     OBSAH skenovaného souboru tomu, kdo zrovna odpoví. To je únik dat.
 *
 * A JÁDRO VĚCI: deklarované aliasy braly `${SERVICE_ALIAS_PREFIX}` — jméno
 * IMPLEMENTACE, které je `aisha` u KAŽDÉ instance i forku. `aisha-db`,
 * `aisha-redis`, `aisha-shared-redis` tedy nebyly instanční vůbec; proto si
 * `aisha-shared-redis` nárokoval i cizí stack. Táž záměna dvou prefixů, kterou
 * řeší [[compose-name-je-instancni]] u `name:` — jen o patro níž.
 *
 * ── DVA PREFIXY ───────────────────────────────────────────────────────────
 *   SERVICE_ALIAS_PREFIX = jméno implementace (`aisha` u všech) → kolizní
 *   APP_NAME_PREFIX      = identita zákazníka → jediné jednoznačné jméno
 *
 * INVARIANT: alias deklarovaný ve compose obsahuje `${` a neodkazuje na
 * `SERVICE_ALIAS_PREFIX`. Datová služba, kterou nikdo nekonzumuje cross-stack,
 * na sdílené síti být nemá vůbec.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
/** Prefix, který je pro KAŽDOU instanci stejný → v aliasu je kolizní. */
const IMPL_ALIAS = "SERVICE_ALIAS_PREFIX";

interface Violation { file: string; line: number; alias: string; why: string }

function composeFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "docker-compose*.yml", "docker-compose*.yaml"], {
    cwd: ROOT, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

export function findNonInstanceAliases(file: string, content: string): Violation[] {
  const out: Violation[] = [];
  let inAliases = false;
  let aliasIndent = 0;
  content.split("\n").forEach((raw, i) => {
    const hdr = raw.match(/^(\s*)aliases:\s*$/);
    if (hdr) { inAliases = true; aliasIndent = hdr[1].length; return; }
    if (!inAliases) return;
    if (raw.trim() === "" || /^\s*#/.test(raw)) return; // komentář/prázdno blok neukončuje
    const item = raw.match(/^(\s*)-\s+(\S.*?)\s*$/);
    if (!item || item[1].length <= aliasIndent) { inAliases = false; return; }
    const alias = item[2];
    if (!alias.includes("${")) {
      out.push({ file, line: i + 1, alias, why: "holý alias — na sdílené síti si ho nárokuje i cizí nájemník" });
      return;
    }
    // `SERVICE_ALIAS_PREFIX` jen v `:?` chybovém textu je komentář, ne jméno.
    const vars = [...alias.matchAll(/\$\{([A-Z0-9_]+)(?=[:}])/g)].map((m) => m[1]);
    if (vars.includes(IMPL_ALIAS)) {
      out.push({ file, line: i + 1, alias, why: `${IMPL_ALIAS} je jméno implementace — stejné pro každou instanci i fork` });
    }
  });
  return out;
}

describe("aliasy na sdílené síti nesou identitu instance", () => {
  test("compose soubory se našly (brána má co měřit)", () => {
    expect(composeFiles().length).toBeGreaterThan(0);
  });

  test("žádný alias nenese SERVICE_ALIAS_PREFIX (jméno implementace)", () => {
    // Tohle je půlka, kterou lze vynutit BEZ migrace volajících: hodnota se
    // renderuje stejně (APP_NAME_PREFIX == SERVICE_ALIAS_PREFIX == „aisha"
    // u téhle instalace), takže jde o čistě dopřednou opravu pro forky.
    const violations: Violation[] = [];
    for (const f of composeFiles()) {
      violations.push(
        ...findNonInstanceAliases(f, readFileSync(join(ROOT, f), "utf-8"))
          .filter((v) => v.why.includes(IMPL_ALIAS)),
      );
    }
    if (violations.length) {
      const msg = violations.map((v) => `  ${v.file}:${v.line}  - ${v.alias}`).join("\n");
      throw new Error(
        `${violations.length} aliasů nese ${IMPL_ALIAS} — jméno IMPLEMENTACE, které je stejné\n` +
          `pro každou instanci i fork, takže na sdílené síti koliduje.\n` +
          `Použij \${APP_NAME_PREFIX:?…} (identita zákazníka).\n\n${msg}`,
      );
    }
    expect(violations).toEqual([]);
  });

  test("INVENTURA: holé aliasy aplikačních služeb — nelze opravit bez migrace volajících", () => {
    // NENÍ to allow-list a NENÍ to zelená přes výjimku: test hlásí SKUTEČNÝ
    // počet a padne, jakmile jich PŘIBUDE. Existující jsou zdokumentovaný dluh.
    //
    // Proč nejsou opravené hned: volající je adresují HOLÝM jménem přímo v URL
    // — `docker-compose.coolify.yml:381 SVC_AI_CHAT_URL: http://svc-ai-chat:3011`
    // (literál, ne fallback) a `services/gateway/src/config.ts:67,70,73`
    // (`?? 'http://ws-gateway:3002'`). Přejmenovat alias bez migrace všech
    // volajících = rozbité gateway routování. Patří to do vlastní změny, kde se
    // ty URL nejdřív začnou DORUČOVAT místo dosazovat.
    const bare: Violation[] = [];
    for (const f of composeFiles()) {
      bare.push(
        ...findNonInstanceAliases(f, readFileSync(join(ROOT, f), "utf-8"))
          .filter((v) => !v.why.includes(IMPL_ALIAS)),
      );
    }
    const KNOWN = 6; // změřeno 2026-08-10; viz úkol o kolizi aliasů
    expect(
      bare.length,
      `Holých aliasů je ${bare.length}, očekáváno ${KNOWN}.\n` +
        `PŘIBYL-LI nový, oprav ho rovnou — na sdílené síti si ho nárokuje i cizí nájemník.\n` +
        bare.map((v) => `  ${v.file}:${v.line}  - ${v.alias}`).join("\n"),
    ).toBeLessThanOrEqual(KNOWN);
  });

  test("pki-db NENÍ na sdílené síti (vnitrostackový — nemá tam co dělat)", () => {
    const pki = readFileSync(join(ROOT, "docker-compose.coolify-pki.yml"), "utf-8");
    const start = pki.indexOf("\n  pki-db:");
    expect(start, "služba pki-db nenalezena — změnil se tvar compose?").toBeGreaterThanOrEqual(0);
    const rest = pki.slice(start + 1);
    const end = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
    const block = end > 0 ? rest.slice(0, end) : rest;
    const code = block.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(
      /^\s+-\s+internal\s*$/m.test(code),
      "pki-db se připojuje na sdílenou 'internal' (= coolify); je vnitrostackový, patří jen na per-app síť",
    ).toBe(false);
  });

  test("clamd se adresuje instančně (nemá autentizaci — kolize = únik obsahu souborů)", () => {
    // CLAMD_HOST se DORUČUJE (env-doctor CONTRACT), nesmí mít dosazený default:
    // `${CLAMD_HOST:-clamd}` by kolizi tiše vrátil. A nesmí to být vnořená
    // interpolace `${A:-${B}}` — tu Coolify neumí (vyrenderuje „?-clamd}").
    const ds = readFileSync(join(ROOT, "docker-compose.coolify-domain-services.yml"), "utf-8");
    const line = ds.split("\n").find((l) => /^\s*CLAMD_HOST:/.test(l)) ?? "";
    expect(line, "CLAMD_HOST nenalezen").not.toBe("");
    expect(line, "CLAMD_HOST má dosazený default — kolize se vrátí").not.toMatch(/:-/);
    expect(line, "CLAMD_HOST musí být povinný (`:?`), aby chybějící doručení bylo vidět").toMatch(/\$\{CLAMD_HOST:\?/);

    // …a env-doctor ho musí skutečně doručovat, instančně.
    const doc = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf-8");
    expect(doc, "env-doctor nedoručuje CLAMD_HOST").toMatch(
      // ⛔ 2026-08-24: jméno je `clamav`, ne `clamd`. Tahle brána PŘIPÍNALA
      // `-clamd` literálem, zatímco katalog deklaruje službu `clamav`,
      // derivace vydává `CLAMAV_MESH_TCP_ROUTES=3310|<prefix>-clamav:3310`
      // a sidecar `clamav-mesh-tcp` na to jméno volá. Dvě jména pro jednu
      // věc; při wipu padal sidecar na `host not found in upstream`.
      // ZÁMĚR brány se nemění — clamd autentizaci nemá, takže kolize jména
      // znamená únik obsahu souborů. Mění se jen KTERÉ jméno je kanonické.
      /\["CLAMD_HOST",\s*"template",\s*"\$\{APP_NAME_PREFIX\}-clamav"\]/,
    );
  });

  test("vnitřní URL služeb se doručují instančně, ne holým jménem", () => {
    const doc = readFileSync(join(ROOT, "scripts/aisha-env-doctor.mjs"), "utf-8");
    for (const [key, svc] of [["AI_CHAT_SERVICE_URL", "svc-ai-chat"], ["AITG_PROBES_SERVICE_URL", "svc-aitg-probes"]]) {
      expect(doc, `${key} se nedoručuje instančně`).toMatch(
        new RegExp(`\\["${key}",\\s*"template",\\s*"http://\\$\\{APP_NAME_PREFIX\\}-${svc}:`),
      );
    }
  });

  // ── Negativní testy — brána, která nemůže padnout, není brána ─────────────
  test("holý alias je nález", () => {
    expect(findNonInstanceAliases("x.yml", "        aliases:\n          - clamd").length).toBe(1);
  });

  test("alias se SERVICE_ALIAS_PREFIX je nález", () => {
    expect(findNonInstanceAliases("x.yml", "        aliases:\n          - ${SERVICE_ALIAS_PREFIX:?x}-db").length).toBe(1);
  });

  test("alias s APP_NAME_PREFIX je v pořádku", () => {
    expect(findNonInstanceAliases("x.yml", "        aliases:\n          - ${APP_NAME_PREFIX:?x}-db")).toEqual([]);
  });

  test("SERVICE_ALIAS_PREFIX jen v :? textu není nález", () => {
    expect(findNonInstanceAliases("x.yml", "        aliases:\n          - ${APP_NAME_PREFIX:?dřív SERVICE_ALIAS_PREFIX}-db")).toEqual([]);
  });

  test("položka mimo aliases blok se nepočítá", () => {
    expect(findNonInstanceAliases("x.yml", "    networks:\n      - internal")).toEqual([]);
  });
});
