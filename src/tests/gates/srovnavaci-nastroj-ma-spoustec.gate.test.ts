/**
 * Brána: srovnávací (léčicí) nástroj musí mít SPOUŠTĚČ.
 *
 * TŘÍDA VADY: hotová automatika, kterou nikdo nevolá. Vypadá to jako vyřešený
 * problém — nástroj v repu je, má dokumentaci, dá se spustit ručně — ale žádná
 * dráha ho nespouští, takže se drift nikdy sám nesrovná.
 *
 * ⛔ NAMĚŘENO 2026-08-20 na riqi. Přihlášení do extranetu končilo hláškou
 * `token exchange failed: "unauthorized_client" "Invalid client credentials"`.
 * Přihlášení samo proběhlo — Keycloak vydal kód — ale oauth2-proxy ho nesměnil,
 * protože držel jiný client secret (43 vs 32 znaků). `reconcile-oidc-secrets.mjs`
 * ten rozdíl umí najít i vyléčit a v repu ležel celou dobu; volal ho ale jen
 * jeho vlastní test. Rozešlo se 11 kopií napříč 7 aplikacemi.
 *
 * Majitel to pojmenoval přesně: „nechci sync ručně, mělo by to být automatické."
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis): univerzum = `scripts/reconcile-*.mjs`
 * (konvence jména, hledá se přes `git ls-files`). Pro každý musí existovat jiný
 * SLEDOVANÝ soubor v `scripts/`, který ho spouští — jeho vlastní test se
 * nepočítá, protože test dokazuje, že nástroj funguje, ne že se používá.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Univerzum se HLEDÁ podle konvence jména, nevypisuje se. */
export function srovnavaciNastroje(): string[] {
  return execFileSync("git", ["ls-files", "scripts/reconcile-*.mjs"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter(Boolean);
}

/** Je ten soubor spouštěčem daného nástroje? Test nástroje se NEPOČÍTÁ. */
export function jeSpoustec(cesta: string, text: string, nastroj: string): boolean {
  const jmeno = basename(nastroj);
  if (cesta === nastroj) return false; // sám sebe nespouští
  if (/\.test\.mjs$|\.spec\.mjs$/.test(cesta)) return false; // test měří funkci, ne užití
  return text.includes(jmeno);
}

describe("srovnávací nástroj má spouštěč", () => {
  test("detektor pozná tvar, kvůli kterému brána vznikla", () => {
    const N = "scripts/reconcile-oidc-secrets.mjs";
    // Přesně stav do 2026-08-20: volal ho JEN jeho vlastní test.
    expect(jeSpoustec("scripts/reconcile-oidc-secrets.test.mjs", "reconcile-oidc-secrets.mjs", N)).toBe(false);
    // A sám sebe taky ne.
    expect(jeSpoustec(N, "reconcile-oidc-secrets.mjs", N)).toBe(false);
    // Skutečný spouštěč se pozná.
    expect(jeSpoustec("scripts/instance-rollout.sh", 'node "$_recon"  # reconcile-oidc-secrets.mjs', N)).toBe(true);
    // Soubor, který o něm nic neví, spouštěč není.
    expect(jeSpoustec("scripts/neco-jineho.sh", "echo ahoj", N)).toBe(false);
  });

  test("univerzum není prázdné — jinak brána neměří nic", () => {
    expect(
      srovnavaciNastroje().length,
      "žádný `scripts/reconcile-*.mjs` — buď se změnila konvence jmen, nebo se rozbilo\n" +
        "čtení `git ls-files`; brána by tiše prošla nad prázdnem",
    ).toBeGreaterThan(0);
  });

  test("každý srovnávací nástroj někdo spouští", () => {
    const soubory = execFileSync("git", ["ls-files", "scripts"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n").filter(Boolean)
      .map((c) => ({ cesta: c, text: readFileSync(join(ROOT, c), "utf-8") }));

    const bezSpoustece = srovnavaciNastroje().filter(
      (n) => !soubory.some((s) => jeSpoustec(s.cesta, s.text, n)),
    );
    expect(
      bezSpoustece,
      "tenhle nástroj umí drift najít i vyléčit, ale žádná dráha ho nespouští. To je horší\n" +
        "než kdyby neexistoval: jeho přítomnost tvrdí, že je problém vyřešený, a přitom se\n" +
        "stav rozchází dál. Přesně tak 2026-08-20 přestalo fungovat přihlášení do extranetu\n" +
        "— a nejen tam, rozešlo se 11 kopií secretů napříč 7 aplikacemi.\n\n" +
        "CO S TÍM: zavolej ho z dráhy, která běží sama (fáze v `scripts/instance-rollout.sh`,\n" +
        "krok cold-startu, nebo kontrola doktora).\n" +
        "NEDĚLEJ: nespoléhej na to, že ho někdo spustí ručně, a nepiš do dokumentace „stačí\n" +
        "spustit …\" — právě dokumentace tenhle dojem vyrobila.\n\n" +
        "BEZ SPOUŠTĚČE:\n  " + bezSpoustece.join("\n  "),
    ).toEqual([]);
  });
});
