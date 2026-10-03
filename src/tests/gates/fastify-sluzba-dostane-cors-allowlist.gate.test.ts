/**
 * Každá Fastify služba musí v compose DOSTAT `CORS_ALLOWLIST` (ROHATKA)
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Služba, jejíž kód volá `applySecurity()`, musí mít v compose
 * `CORS_ALLOWLIST: ${CORS_ALLOWLIST:-}`. Bez toho dostane PRÁZDNÝ seznam a
 * fail-closed odmítne KAŽDÝ původ z prohlížeče.
 *
 * ── PROČ (naměřeno 2026-09-20 na produkci) ────────────────────────────────────
 * Majitel se nedostal do administrace. Autorizace byla přitom v pořádku po celé
 * délce — Apple → Keycloak (`admin`+`staff`) → `user_roles` (`admin`+`staff`) →
 * `is_admin_or_staff()` = true → publikum sekce `{"roles":["admin","staff"]}`.
 *
 * Vada byla o vrstvu níž: `svc-knock` neměl v compose `CORS_ALLOWLIST`, takže
 * při startu hlásil
 *
 *     warn cors:svc-knock  "cors.empty_allowlist"
 *
 * a pak za 24 h odmítl 183× původ webu té instance a 62× původ jejího
 * extranetu. Prohlížeč tím nemohl ZAKLEPAT, dveře zůstaly zavřené a aplikace
 * to ukázala jako „access denied".
 *
 * ⛔ Konkrétní adresy sem NEPATŘÍ — stack je agnostický vůči instancím a brána
 * `legacy-domains` je tu přistihla. Patří do `config/domains.env` instance.
 *
 * ⭐ TÁŽ VADA UŽ JEDNOU BYLA. `config/domains.env` ji popisuje u `svc-ai-chat`
 * (2026-07-30): „Nothing ever ASSIGNED that variable, so the default won."
 * Tehdy se opravila strana HODNOTY (`CORS_ALLOWLIST=${ALLOWED_ORIGINS}`) a
 * konvence „every Fastify service declares CORS_ALLOWLIST" se zapsala do
 * KOMENTÁŘE. Konvence v komentáři není pravidlo, je to přání — a při měření
 * 2026-09-20 ji nesplňovalo 10 z 25 služeb.
 *
 * ── PROČ ROHATKA A NE NULA ────────────────────────────────────────────────────
 * Tři z nich žijí v `docker-compose.coolify.yml`, který je 7 B pod stropem
 * `ARG_MAX` (34 993 / 35 000). Přidat tam řádky by shodilo nasazení jádra, a
 * zvednout strop je vzorec „brána červená → změním bránu → zelená", který si
 * ta brána sama zakazuje. Dluh proto smí jen KLESAT; zbytek se opravil hned.
 *
 * ── UNIVERZUM ────────────────────────────────────────────────────────────────
 * Hledá se, nepíše: služby se čtou z volání `applySecurity` ve zdrojácích,
 * compose z `git ls-files`. Nová Fastify služba tím spadne do brány sama.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "src/tests/gates/fastify-sluzba-dostane-cors-allowlist.baseline.json");

function gitSoubory(vzor: string): string[] {
  return execFileSync("git", ["ls-files", vzor], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/**
 * Služby, jejichž KÓD volá applySecurity() — tedy ty, které CORS opravdu řeší.
 *
 * ⛔ UNIVERZUM JE PREFIX, NE GLOB. Pathspec tvaru
 *     services / {hvezdicka} / src / {dve hvezdicky} / {hvezdicka}.ts
 * vrací 477 souborů, kdežto prefix `services/` jich má 650: `**` v git pathspec
 * vyžaduje ASPOŇ JEDNU úroveň pod `src/`, takže tiše vynechá soubory ležící
 * přímo v `src/` — mezi nimi `svc-knock/src/server.ts`, tedy právě ten, kvůli
 * kterému brána vzniká. Naměřeno 2026-09-20: s `**` vyšel dluh 0 a stráž
 * „univerzum není prázdné" to zachytila.
 */
function fastifySluzby(): Set<string> {
  const out = new Set<string>();
  for (const f of gitSoubory("services/")) {
    if (!f.endsWith(".ts")) continue;
    const src = readFileSync(path.join(ROOT, f), "utf8");
    if (src.includes("applySecurity")) out.add(f.split("/")[1]);
  }
  return out;
}

/** Služby, které klíč v nějakém compose DOSTÁVAJÍ. */
function maKlic(): Set<string> {
  const out = new Set<string>();
  for (const f of gitSoubory("docker-compose*.yml")) {
    let doc: { services?: Record<string, unknown> } | null;
    try {
      doc = parse(readFileSync(path.join(ROOT, f), "utf8"));
    } catch {
      continue; // nevalidní YAML řeší jiná brána; tady by to jen zašumělo
    }
    for (const [jmeno, telo] of Object.entries(doc?.services ?? {})) {
      if (!telo || typeof telo !== "object") continue;
      const env = (telo as Record<string, unknown>).environment;
      const klice = Array.isArray(env)
        ? env.map((x) => String(x).split("=")[0].trim())
        : Object.keys((env as Record<string, unknown>) ?? {});
      if (klice.includes("CORS_ALLOWLIST")) out.add(jmeno);
    }
  }
  return out;
}

function bezKlice(): string[] {
  const ma = maKlic();
  return [...fastifySluzby()].filter((s) => !ma.has(s)).sort();
}

describe("každá Fastify služba dostane CORS_ALLOWLIST", () => {
  it("univerzum není prázdné — jinak by brána mlčela z neznalosti", () => {
    // ⛔ Bez téhle meze by brána prošla i tehdy, kdyby `applySecurity` nikdo
    // nevolal nebo kdyby `git ls-files` vrátil nic — tedy mlčela by z neznalosti.
    expect(fastifySluzby().size).toBeGreaterThan(10);
    expect(maKlic().size).toBeGreaterThan(5);
  });

  it("svc-knock klíč MÁ — bez něj se nedá zaklepat", () => {
    // Dveřník je zvláštní případ: jeho odmítnutí zavře CELÝ vstup, ne jednu
    // službu. Proto má vlastní tvrzení, ne jen místo v rohatce.
    expect(maKlic().has("svc-knock")).toBe(true);
  });

  it("dluh smí jen KLESAT", () => {
    const zaklad: { dluh: number; sluzby: string[] } = JSON.parse(readFileSync(BASELINE, "utf8"));
    const ted = bezKlice();

    if (process.env.AISHA_UPDATE_BASELINE === "1") {
      writeFileSync(BASELINE, `${JSON.stringify({ dluh: ted.length, sluzby: ted }, null, 2)}\n`);
      return;
    }

    const nove = ted.filter((s) => !zaklad.sluzby.includes(s));
    expect(
      nove,
      `Fastify služba bez CORS_ALLOWLIST v compose:\n${nove.join("\n")}\n` +
        "Přidej `CORS_ALLOWLIST: ${CORS_ALLOWLIST:-}` do jejího environment bloku.",
    ).toEqual([]);

    expect(
      ted.length,
      `Dluh vzrostl z ${zaklad.dluh} na ${ted.length} — rohatka smí jen klesat.`,
    ).toBeLessThanOrEqual(zaklad.dluh);
  });

  it("baseline existuje a jmenuje zbývající dluh", () => {
    expect(existsSync(BASELINE), "chybí baseline rohatky").toBe(true);
    const zaklad = JSON.parse(readFileSync(BASELINE, "utf8"));
    expect(Array.isArray(zaklad.sluzby)).toBe(true);
    expect(zaklad.dluh).toBe(zaklad.sluzby.length);
  });
});
