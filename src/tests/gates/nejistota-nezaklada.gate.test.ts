/**
 * Brána: NEJISTOTA NEZAKLÁDÁ (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-08-22: v projektu vznikly DVĚ aplikace jménem `<prefix>-ledger`.
 * Ta původní přitom celou dobu běžela (`running:healthy` od 08-17). Cold-start
 * o ní nezjistil, že existuje — a z toho "nezjistil" udělal "neexistuje":
 *
 *     verify_status=$(coolify_api GET "/applications/$uuid" 2>/dev/null \
 *       | jq -r '.uuid // empty' 2>/dev/null || echo "")
 *     if [ -n "$verify_status" ]; then ...reconcile... else ...CREATE... fi
 *
 * `2>/dev/null`, `// empty` i `|| echo ""` sesypou 404, HTTP 500, uťatou odpověď
 * i chybu jq do JEDNÉ prázdné hodnoty — a prázdná hodnota znamenala ZALOŽIT.
 * Sonda, která neumí odpovědět "NEVÍM", tu postavila konkurenta živé aplikaci:
 * dvě appky téhož jména se perou o aliasy i o jména kontejnerů.
 *
 * ⭐ Druhý výskyt o pár řádků výš byl opřený o VYVRÁCENÝ předpoklad: když se
 * nepodařilo načíst seznam aplikací, kód nastavil `apps_json="[]"` a zakládal
 * naslepo s odůvodněním "Coolify odmítne, když jméno už existuje". Neodmítlo —
 * duplicitní ledger je toho důkaz.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis): na cestě k založení aplikace musí být
 * rozdíl mezi "ověřeně neexistuje" (HTTP 404) a "nevím" (cokoli jiného), a
 * větev "nevím" musí BĚH ZASTAVIT, ne pokračovat.
 *
 * CO SE NEMĚŘÍ (přiznaná hranice): brána nečte běhové chování API, jen tvar
 * rozhodování v provisioningu Coolify. Obecné "každá sonda umí říct nevím"
 * staticky měřit neumím; tady jde o KONKRÉTNÍ cestu, která tu vadu vyrobila.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SKRIPT = "scripts/coolify-story-init.sh";

/** Řádky bez komentářů — brána nesmí měřit vlastní vysvětlující text. */
export function kodBezKomentaru(src: string): string[] {
  return src.split("\n").filter((l) => !l.trim().startsWith("#"));
}

describe("nejistota nezakláda aplikaci", () => {
  const src = readFileSync(join(ROOT, SKRIPT), "utf-8");
  const kod = kodBezKomentaru(src);

  test("prázdný seznam se NESYNTETIZUJE ze selhání", () => {
    // `apps_json="[]"` po neúspěšném GETu tvrdí "nic neexistuje" o něčem,
    // co se nepodařilo přečíst. Při výpadku API by to postavilo duplikát
    // ke KAŽDÉ živé aplikaci najednou.
    const hrichy = kod.filter((l) => /apps_json\s*=\s*["']\[\]["']/.test(l));
    expect(
      hrichy,
      "Selhání čtení se tu převléká za prázdný výsledek. Prázdný seznam neznamená\n" +
        "'nic neexistuje', znamená 'nezjistil jsem to'.",
    ).toEqual([]);
  });

  test("existence se rozhoduje podle HTTP KÓDU, ne podle prázdné hodnoty", () => {
    expect(
      src,
      "Chybí sonda, která vrací HTTP kód. Bez něj volající neodliší 404 od 500\n" +
        "ani od uťaté odpovědi — a všechny tři skončí jako 'neexistuje'.",
    ).toMatch(/coolify_api_status\s*\(\)/);

    const rozhoduje = kod.some((l) => /verify_code/.test(l) && /"404"/.test(l));
    expect(
      rozhoduje,
      "Na cestě k založení není vidět explicitní 404. Jen ověřené 404 smí znamenat\n" +
        "'zakládej'; cokoli jiného je 'nevím'.",
    ).toBe(true);
  });

  test("větev NEVÍM zastaví běh, nepokračuje k založení", () => {
    // Struktura: mezi kontrolou `verify_code` a koncem toho if/elif/else
    // musí být ukončení běhu. Bez něj by se z 'nevím' zase stalo 'zakládej'.
    const i = kod.findIndex((l) => /verify_code=/.test(l));
    expect(i, `${SKRIPT}: rozhodování o existenci nenalezeno — brána měří neexistující tvar`).toBeGreaterThan(-1);
    const blok = kod.slice(i, i + 40).join("\n");
    expect(
      blok,
      "Za neověřitelným stavem musí následovat zastavení (exit). Pokračovat znamená\n" +
        "založit druhou aplikaci téhož jména k té, která možná běží.",
    ).toMatch(/exit\s+1/);
  });

  test("přeověření po vytvoření: když selže i ono, běh končí", () => {
    // POST mohl projít a odpověď se uťala. Přeověření seznamu je jediné, co
    // brání druhému POSTu. Když selže i ono, další pokus je sázka na duplikát.
    const i = kod.findIndex((l) => /apps_recheck=/.test(l));
    expect(i, "přeověření po vytvoření nenalezeno").toBeGreaterThan(-1);
    expect(
      kod.slice(i, i + 22).join("\n"),
      "Selhané přeověření musí zastavit, ne spadnout do dalšího POSTu.",
    ).toMatch(/exit\s+1/);
  });

  // ── Záporný test: detektor musí vidět to, kvůli čemu vznikl ───────────────
  test("detektor komentáře nepočítá jako kód", () => {
    const vzorek = ['# apps_json="[]" bylo tady', 'apps_json="[]"', "  # verify_code"].join("\n");
    const k = kodBezKomentaru(vzorek);
    expect(k.filter((l) => /apps_json\s*=\s*["']\[\]["']/.test(l))).toHaveLength(1);
  });
});
