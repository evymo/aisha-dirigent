/**
 * Brána: TVAR NASAZENÍ se deklaruje, nedosazuje (CLASS gate)
 *
 * ⛔ TŘÍDA VADY (naměřeno 2026-08-22): jedna veličina, DVĚ různé vymyšlené
 * odpovědi. Na otázku „jaký tvar nasazení stavíme" si dosazoval
 *
 *     scripts/aisha-cold-start.sh      →  ${AISHA_PROFILE:-cloud-multi}
 *     scripts/lib/derive-domains.mjs   →  ?? "cloud-single"
 *
 * takže podle toho, koho ses zeptal, byla instance jiného tvaru. Profil přitom
 * rozhoduje o KAŽDÉ co-location větvi (PKI_BRIDGE_URL, AUTH_UPSTREAM_*,
 * KEYCLOAK_INTERNAL_URL) — split fleet versus jeden uzel.
 *
 * ⭐ A doprovodný příznak: komentář v `aisha-env-doctor.mjs` tvrdil, že resolver
 * dosazuje `cloud-multi`, zatímco dosazoval `cloud-single`. Vymyšlenou hodnotu
 * nikdo nečte, tak si ji každý pamatuje jinak.
 *
 * ⛔ NEJHORŠÍ NA TOM: `.forgejo/workflows/ci.yml` tvar NEDEKLAROVALA vůbec, takže
 * CI celou dobu ověřovala JINÝ tvar, než jaký se nasazuje — a obojí bylo zelené.
 * Zelená nad nezvoleným tvarem netvrdí „je to v pořádku", tvrdí „nic jsme
 * o tomhle tvaru nezjistili".
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis):
 *   1. ani jedno z těch dvou míst nedosazuje literál,
 *   2. bez deklarace resolver ZASTAVÍ (sonda umí odpovědět „ne"),
 *   3. CI i brány měřený tvar DEKLARUJÍ.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { buildTopology } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

/** Kód bez komentářů — brána nesmí hlásit vlastní vysvětlující text. */
/**
 * Dosazuje tenhle řádek TVAR NASAZENÍ literálem?
 *
 * Vytažené ven schválně: brána, kterou nejde ZČERVENAT, neměří — jen mlčí.
 * Záporné testy níž drží, že detektor pořád vidí to, kvůli čemu vznikl.
 */
export function dosazujeProfil(radek: string): boolean {
  const orez = radek.trim();
  if (orez.startsWith("#") || orez.startsWith("//") || orez.startsWith("*")) return false;
  return /AISHA_PROFILE:-[^}<]/.test(radek) || /AISHA_PROFILE\s*\?\?\s*"[^"]+"/.test(radek);
}

function kod(src: string, znak: "#" | "//"): string {
  return src
    .split("\n")
    .filter((l) => !l.trim().startsWith(znak) && !l.trim().startsWith("*"))
    .join("\n");
}

describe("tvar nasazení se deklaruje, nedosazuje", () => {
  test("NIKDE ve stromu se profil nedosazuje literálem", () => {
    // ⭐ Brána si univerzum HLEDÁ, nepíše. První verze téhle brány jmenovala dva
    // soubory — a hned nato se našel TŘETÍ domov téže odpovědi
    // (`verify-topology-deployed.mjs`, tedy MĚŘIDLO). Jmenovaný seznam dědí své
    // vlastní díry: co v něm není, o tom brána mlčí a mlčení vypadá jako čisto.
    const soubory = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n")
      .filter((f) => /\.(sh|mjs|js|cjs|ts|tsx|yml|yaml)$/.test(f))
      .filter((f) => !f.includes("node_modules/"))
      // Brány samy nesou ukázky vzoru ve vysvětlujícím textu — hlídá se PROVOZNÍ kód.
      .filter((f) => !/\.(test|spec)\.[a-z]+$/.test(f));

    const nalezy: string[] = [];
    for (const f of soubory) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, f), "utf-8");
      } catch {
        // Nečitelný SLEDOVANÝ soubor není „nula nálezů", je to díra v pokrytí.
        throw new Error(`nelze přečíst sledovaný soubor ${f} — brána by tvrdila čisto o nepřečteném`);
      }
      text.split("\n").forEach((radek, i) => {
        if (dosazujeProfil(radek)) nalezy.push(`${f}:${i + 1}  ${radek.trim().slice(0, 90)}`);
      });
    }

    expect(
      nalezy.sort(),
      "Dosazený TVAR NASAZENÍ odvodí celou topologii z cizího profilu — jiné domény,\n" +
        "jiné servery, jiná organizace — a NIC přitom nespadne. U měřidel je to horší:\n" +
        "zelená pak netvrdi nasazeni souhlasi, ale souhlasi s necim jinym.\n" +
        "Deklaruj profil, nebo při chybění zastav.",
    ).toEqual([]);
  });

  test("bez deklarace resolver ZASTAVI - sonda umi odpovedet ne", () => {
    const puvodni = process.env.AISHA_PROFILE;
    try {
      delete process.env.AISHA_PROFILE;
      expect(
        () => buildTopology({}),
        "Resolver bez deklarovaného profilu mlčky odvodil topologii — to je ta vada.",
      ).toThrow(/AISHA_PROFILE/);
    } finally {
      if (puvodni === undefined) delete process.env.AISHA_PROFILE;
      else process.env.AISHA_PROFILE = puvodni;
    }
  });

  // ── Záporné testy: detektor musí pořád vidět to, kvůli čemu vznikl ─────────
  test("detektor chytí obě podoby dosazení", () => {
    expect(dosazujeProfil('AISHA_PROFILE="${AISHA_PROFILE:-cloud-multi}"')).toBe(true);
    expect(dosazujeProfil('const P = process.env.AISHA_PROFILE ?? "cloud-single";')).toBe(true);
  });

  test("detektor nehlásí deklaraci ani stráž ani komentář", () => {
    expect(dosazujeProfil('AISHA_PROFILE: "cloud-multi"'), "deklarace není dosazení").toBe(false);
    expect(dosazujeProfil('${AISHA_PROFILE:-<NEDEKLAROVÁN>}'), "přiznané „nevím\" není dosazení").toBe(false);
    expect(dosazujeProfil('const P = (process.env.AISHA_PROFILE ?? "").trim();'), "normalizace").toBe(false);
    expect(dosazujeProfil('# AISHA_PROFILE:-cloud-multi bylo tady'), "komentář není kód").toBe(false);
  });

  test("CI a brány DEKLARUJÍ, jaký tvar měří", () => {
    expect(
      read(".forgejo/workflows/ci.yml"),
      "CI nedeklaruje AISHA_PROFILE — pak měří tvar, který nikdo nezvolil,\n" +
        "a její zelená o nasazovaném tvaru netvrdí nic.",
    ).toMatch(/^\s*AISHA_PROFILE:/m);

    expect(
      read("vitest.gates.config.ts"),
      "Sada bran nedeklaruje měřený tvar — viz výše, týž důvod.",
    ).toMatch(/AISHA_PROFILE/);
  });
});
