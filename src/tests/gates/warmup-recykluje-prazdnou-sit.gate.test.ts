/**
 * Warmup recykluje PRÁZDNOU síť s neshodným rozsahem — obsazenou nikdy
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Vlna 0 zakládá sítě instance. Když síť existuje s JINÝM rozsahem, než jaký se
 * odvodil z identity, jsou jen dvě poctivé možnosti:
 *   - je PRÁZDNÁ  → smaž a založ znovu (nikoho to neodpojí),
 *   - je OBSAZENÁ → odmítni nahlas (překreslení by odpojilo běžící kontejnery).
 *
 * ── PROČ (naměřeno 2026-08-13 při --wipe) ─────────────────────────────────────
 * Rozsah se přestal dědit z vaultu a začal odvozovat z identity — jenže SÍŤ na
 * hostiteli zůstala se starým rozsahem. `--wipe` maže aplikace a volumes, sítě
 * ne (ty zakládá warmup sám). Vlna 0 proto spadla na dvou ze tří hostů a jediná
 * náprava byl RUČNÍ ZÁSAH na serveru — v jinak autonomním cold-startu.
 *
 * Hláška přitom slibovala „wipe ji vytvoří znovu". Nikdo to nedělal: klasická
 * deklarace, kterou nemá kdo naplnit.
 *
 * ── CO SE MĚŘÍ ────────────────────────────────────────────────────────────────
 * Brána nečte text, ale SPOUŠTÍ shellovou funkci `zaloz` proti atrapě dockeru
 * ve čtyřech stavech. Text by tuhle vadu neuhlídal: původní kód „vypadal
 * správně" a chybělo mu jen rozlišení prázdné a obsazené sítě.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const COMPOSE = path.join(ROOT, "docker-compose.coolify-netinit.yml");

const DEKLAROVANY = "10.185.167.0/24";
const ZDEDENY = "10.99.0.0/24";

/** Vytáhne definici `zaloz()` z compose (s Compose escapingem `$$` → `$`). */
function zalozFunkce(): string {
  const doc = parse(readFileSync(COMPOSE, "utf8")) as {
    services: { netinit: { command: string[] } };
  };
  const kod = doc.services.netinit.command[doc.services.netinit.command.length - 1].replace(/\$\$/g, "$");
  const radky = kod.split("\n");
  const start = radky.findIndex((l) => l.startsWith("zaloz()"));
  expect(start, "funkce zaloz() se v netinit compose nenašla — brána neměří").toBeGreaterThan(-1);
  let hloubka = 0;
  for (let i = start; i < radky.length; i += 1) {
    hloubka += (radky[i].match(/\{/g) ?? []).length - (radky[i].match(/\}/g) ?? []).length;
    if (i > start && hloubka <= 0) return radky.slice(start, i + 1).join("\n");
  }
  throw new Error("konec funkce zaloz() se nenašel");
}

/**
 * Spustí `zaloz` proti atrapě dockeru.
 *
 * Stav sítě = "" (neexistuje) nebo "<subnet>|<počet připojených>".
 * Vrací návratový kód a výsledný stav — obojí je podstatné: „uspělo to" nad
 * smazanou a nezaloženou sítí by byl úspěch nad prázdnem.
 */
function spustZaloz(stav: string, dryRun = false): { ok: boolean; vysledek: string; vystup: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "aisha-netinit-"));
  try {
    const stavSoubor = path.join(dir, "stav");
    writeFileSync(stavSoubor, stav ? `aisha-mesh-dns|${stav}\n` : "");
    const skript = `
set -eu
DRY_RUN=${dryRun ? "1" : "0"}
STAV=${JSON.stringify(stavSoubor)}
docker() {
  case "$1 $2" in
    "network inspect")
      grep -q "^$3|" "$STAV" 2>/dev/null || return 1
      radek=$(grep "^$3|" "$STAV")
      case "\${4:-}" in
        --format) case "$5" in
          *IPAM*) echo "$radek" | cut -d'|' -f2 ;;
          *len*)  echo "$radek" | cut -d'|' -f3 ;;
        esac ;;
      esac
      return 0 ;;
    "network rm")
      radek=$(grep "^$3|" "$STAV" 2>/dev/null || true)
      [ -z "$radek" ] && { echo "No such network"; return 1; }
      [ "$(echo "$radek" | cut -d'|' -f3)" != "0" ] && { echo "error: network has active endpoints"; return 1; }
      grep -v "^$3|" "$STAV" > "$STAV.t" 2>/dev/null || true; mv "$STAV.t" "$STAV"
      return 0 ;;
    "network create")
      shift; sub=""; jmeno=""; next=""
      for a in "$@"; do
        case "$a" in
          network|create) ;;
          --subnet) next=sub ;;
          *) if [ "$next" = "sub" ]; then sub=$a; next=""; else jmeno=$a; fi ;;
        esac
      done
      echo "$jmeno|$sub|0" >> "$STAV"; return 0 ;;
  esac
}
${zalozFunkce()}
zaloz "aisha-mesh-dns" ${JSON.stringify(DEKLAROVANY)}
`;
    let ok = true;
    let vystup = "";
    try {
      vystup = execFileSync("bash", ["-c", skript], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      ok = false;
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      vystup = `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`;
    }
    return { ok, vysledek: readFileSync(stavSoubor, "utf8").trim(), vystup };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("warmup recykluje prázdnou síť, obsazenou nikdy", () => {
  it("síť neexistuje → založí ji s deklarovaným rozsahem", () => {
    const r = spustZaloz("");
    expect(r.ok, `zaloz selhal: ${r.vystup}`).toBe(true);
    expect(r.vysledek).toContain(DEKLAROVANY);
  });

  it("síť existuje se SPRÁVNÝM rozsahem → nechá ji být (i s kontejnery)", () => {
    const r = spustZaloz(`${DEKLAROVANY}|3`);
    expect(r.ok, `zaloz selhal: ${r.vystup}`).toBe(true);
    expect(r.vysledek, "shodnou síť nesmí sáhnout").toBe(`aisha-mesh-dns|${DEKLAROVANY}|3`);
  });

  it("špatný rozsah + PRÁZDNÁ → smaže a založí znovu", () => {
    const r = spustZaloz(`${ZDEDENY}|0`);
    expect(
      r.ok,
      "Prázdná síť se zděděným rozsahem musí jít recyklovat — jinak zůstává\n" +
        "jedinou nápravou ruční zásah na serveru a cold-start není autonomní:\n" +
        r.vystup,
    ).toBe(true);
    expect(
      r.vysledek,
      "síť se buď nesmazala, nebo (horší) smazala a NEZALOŽILA — úspěch nad prázdnem",
    ).toBe(`aisha-mesh-dns|${DEKLAROVANY}|0`);
  });

  it("DRY_RUN → na síť nesáhne, jen řekne, co by udělal", () => {
    // Náhled nasazení nesmí mutovat hostitele. Zároveň je tohle ta ochrana,
    // kterou vyžaduje kontrakt destruktivních operací (destructive-ops-survey):
    // žádný nový `docker network rm` nesmí běžet bezpodmínečně.
    const r = spustZaloz(`${ZDEDENY}|0`, true);
    expect(r.ok, `dry-run nemá selhat: ${r.vystup}`).toBe(true);
    expect(r.vysledek, "DRY_RUN sáhl na síť — náhled musí být bez následku").toBe(
      `aisha-mesh-dns|${ZDEDENY}|0`,
    );
    expect(r.vystup, "dry-run musí říct, co by udělal").toMatch(/DRY_RUN/);
  });

  it("špatný rozsah + OBSAZENÁ → odmítne nahlas a nic nesmaže", () => {
    const r = spustZaloz(`${ZDEDENY}|2`);
    expect(r.ok, "obsazenou síť NESMÍ překreslit — odpojilo by to běžící kontejnery").toBe(false);
    expect(r.vysledek, "obsazená síť musí zůstat nedotčená").toBe(`aisha-mesh-dns|${ZDEDENY}|2`);
    expect(r.vystup, "hláška musí říct, kolik kontejnerů brání nápravě").toMatch(/Připojených kontejnerů: 2/);
  });
});
