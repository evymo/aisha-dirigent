/**
 * Brána: platformní klient deklarovaný v realmu DORAZÍ i do realmu, který už běží.
 *
 * ── PROČ ──────────────────────────────────────────────────────────────────────
 * `keycloak/aisha-realm.json` se importuje jen do PRÁZDNÉHO realmu. Klient přidaný do
 * deklarace později (2026-10-04: `aisha-mcp-client`, veřejný klient pro přihlášení klientů
 * MCP) se do běžícího Keycloaku dostane jedinou cestou: blokem „Platform clients: doplnit
 * CHYBĚJÍCÍ“ v `keycloak/configure-realms.sh` (volá ho fáze B cold-startu — to drží brána
 * faze-b-keycloak-dostane-co-ma).
 *
 * Smír po startu (`reconcile-realm-clients.sh`) klienty NEZAKLÁDÁ — srovnává jen tajemství
 * a servisní účty klientů, které v realmu už jsou. Veřejný klient bez tajemství není
 * v žádném jeho univerzu.
 *
 * Ten blok tedy nesmí dostat výčet jmen ani filtr, který by veřejného klienta vyřadil:
 * klient by v deklaraci byl, v realmu ne, a přihlášení by končilo chybou Keycloaku
 * („klient neexistuje“) bez souvislosti s příčinou.
 *
 * ── CO SE MĚŘÍ (staticky, nad textem skriptu a deklarací realmu) ───────────────
 *   1. blok existuje a univerzum klientů není prázdné;
 *   2. klienty bere z deklarace realmu — jediná podmínka je neprázdné `clientId`;
 *   3. v kódu bloku není jméno ŽÁDNÉHO deklarovaného klienta (tedy žádný výčet ani výjimka);
 *   4. každý veřejný klient realmu tou podmínkou projde (a přežije dělení slov v shellu);
 *   5. chybějící klient se ZAKLÁDÁ, existující se nepřepisuje;
 *   6. zdrojem je i soubor vedle skriptu — z hostitele (cold-start) cesta do kontejneru není.
 *
 * Chování proti skutečnému Keycloaku tahle brána NEMĚŘÍ.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verejniKlientiRealmu } from "../../../scripts/lib/povoleni-klienti.mjs";

const ROOT = process.cwd();
const SKRIPT = readFileSync(join(ROOT, "keycloak/configure-realms.sh"), "utf8");
const REALM = JSON.parse(readFileSync(join(ROOT, "keycloak/aisha-realm.json"), "utf8")) as {
  clients?: Array<{ clientId?: unknown }>;
};

const ZACATEK = "# ── Platform clients: doplnit CHYBĚJÍCÍ do živého realmu";
const KONEC = "# ── Instance clients (private overlay)";

/** Blok platformních klientů; prázdný řetězec = značky se ve skriptu nenašly. */
function blok(skript: string): string {
  const od = skript.indexOf(ZACATEK);
  const po = skript.indexOf(KONEC);
  return od >= 0 && po > od ? skript.slice(od, po) : "";
}

/** Kód bez řádkových komentářů shellu — próza klienty jmenovat smí, kód ne. */
const bezKomentaru = (text: string): string =>
  text
    .split("\n")
    .filter((radek) => !/^\s*#/.test(radek))
    .join("\n");

/** Výčet klientů v bloku: všechna `clientId` ze zdroje, jediná podmínka je neprázdná hodnota. */
const VYCET_Z_DEKLARACE =
  /for c in d\.get\('clients',\s*\[\]\):\s*\n\s*cid\s*=\s*c\.get\('clientId'\)\s*\n\s*if cid:\s*print\(cid\)\s*\n/;

/** Jména deklarovaných klientů, která se v kódu bloku vyskytují doslova. */
function jmenovaniKlienti(kod: string): string[] {
  return (REALM.clients ?? [])
    .map((k) => k.clientId)
    .filter((id): id is string => typeof id === "string" && id !== "")
    .filter((id) => new RegExp(`(^|[^A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`).test(kod));
}

const KOD = bezKomentaru(blok(SKRIPT));
const VEREJNI: string[] = verejniKlientiRealmu(REALM);

describe("platformní klient z deklarace dorazí do živého realmu", () => {
  test("blok existuje a univerzum není prázdné — jinak brána mlčí místo měření", () => {
    expect(blok(SKRIPT), "blok „Platform clients: doplnit CHYBĚJÍCÍ“ v configure-realms.sh není").not.toBe("");
    expect(VEREJNI.length, "realm nedeklaruje žádného veřejného klienta").toBeGreaterThan(1);
    expect(VEREJNI, "klient pro přihlášení klientů MCP v deklaraci chybí").toContain("aisha-mcp-client");
  });

  test("klienty bere z deklarace realmu — jediná podmínka je neprázdné clientId", () => {
    expect(
      KOD,
      "výčet klientů už nečte všechna `clientId` ze zdroje — nový filtr může klienta z deklarace vyřadit",
    ).toMatch(VYCET_Z_DEKLARACE);
  });

  test("v kódu bloku není jméno žádného deklarovaného klienta — žádný výčet, žádná výjimka", () => {
    expect(
      jmenovaniKlienti(KOD),
      "blok jmenuje klienta doslova; univerzum má vzniknout z deklarace, ne z ručního seznamu",
    ).toEqual([]);
  });

  test("každý veřejný klient realmu podmínkou projde a přežije dělení slov v shellu", () => {
    // `for CID in $PC_IDS` dělí na bílých znacích: jméno s mezerou by se rozpadlo na dvě.
    const neprojde = VEREJNI.filter((id) => !/^\S+$/.test(id));
    expect(neprojde, "klient s prázdným jménem nebo bílým znakem ve jménu se nezaloží").toEqual([]);
  });

  test("chybějící klient se zakládá, existující se přeskočí — nic se nepřepisuje", () => {
    expect(KOD, "blok klienta nezakládá (POST na clients)").toMatch(
      /-X POST\s*\\?\s*\n?\s*"\$\{KC_URL\}\/admin\/realms\/\$\{APP_REALM\}\/clients"/,
    );
    expect(KOD, "existující klient se nepřeskakuje").toMatch(/if \[ -n "\$CUUID" \]; then\s*\n\s*PC_SKIPPED=/);
    expect(KOD, "blok existující klienty přepisuje (PUT) — zahodil by heslo i ruční doladění").not.toMatch(/-X PUT/);
  });

  test("zdrojem deklarace je i soubor vedle skriptu (běh z hostitele při cold-startu)", () => {
    expect(KOD).toContain('"$(dirname "$0")/aisha-realm.json"');
  });

  // Kotvy: detektory musí chytit to, před čím brána chrání.
  describe("kotvy — měřidlo vidí, co má vidět", () => {
    const S_FILTREM = KOD.replace("if cid: print(cid)", "if cid and c.get('secret'): print(cid)");
    const S_VYCTEM = KOD.replace("if cid: print(cid)", "if cid in ('aisha-app', 'extranet-proxy'): print(cid)");

    test("mutace se opravdu provedla (jinak kotvy netvrdí nic)", () => {
      expect(S_FILTREM).not.toBe(KOD);
      expect(S_VYCTEM).not.toBe(KOD);
    });

    test("filtr na tajemství (vyřadil by veřejného klienta) se pozná", () => {
      expect(S_FILTREM).not.toMatch(VYCET_Z_DEKLARACE);
    });

    test("ruční výčet jmen se pozná", () => {
      expect(S_VYCTEM).not.toMatch(VYCET_Z_DEKLARACE);
      expect(jmenovaniKlienti(S_VYCTEM)).toEqual(["aisha-app", "extranet-proxy"]);
    });

    test("jméno klienta jen v komentáři nálezem není", () => {
      expect(jmenovaniKlienti(bezKomentaru("# Naměřeno při zavádění `extranet-proxy`\nPC_CREATED=0\n"))).toEqual([]);
    });
  });
});
