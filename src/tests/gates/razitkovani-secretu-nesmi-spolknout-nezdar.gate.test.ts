/**
 * Brána: krok, který RAZÍTKUJE secrety důvěrných klientů, nesmí spolknout nezdar.
 *
 * TŘÍDA VADY: „exit 0 po chybě". Krok se vykoná, selže, a volající to převede
 * na varování nebo rovnou na `|| true`. Běh pokračuje, stack naskočí zeleně —
 * a teprve člověk u přihlašovací stránky zjistí, že dovnitř nikdo neprojde.
 *
 * ⛔ NAMĚŘENO 2026-08-20 na riqi. `provision-sso.sh` zapisuje do Keycloaku
 * secrety důvěrných klientů (oauth2-proxy před extranetem, n8n, nocodb, studio,
 * appsmith, langfuse, openclaw). Volalo se na TŘECH místech a na všech byl
 * nezdar spolknutý:
 *
 *   aisha-cold-start.sh   … || warn "provision-sso.sh non-zero — verify"
 *   warmup.sh             … || true
 *
 * Následek: Keycloak si u klientů vygeneroval VLASTNÍ secrety, konzumenti drželi
 * jiné, a přihlášení do extranetu končilo na
 *   `token exchange failed: "unauthorized_client" "Invalid client credentials"`.
 * Rozešlo se 11 kopií napříč 7 aplikacemi. Mobilní appka to nepocítila — je to
 * VEŘEJNÝ klient, nemá secret, takže se nemá co rozejít; rozcházejí se právě jen
 * důvěrní klienti za proxy.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis): každé volání `provision-sso.sh` v režimu
 * APPLY (tedy bez `--check`) ve sledovaných skriptech nesmí mít na témže příkazu
 * `|| true` ani `|| warn`. Kontrolní režim `--check` je informativní a shovívavý
 * být smí.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const NASTROJ = "provision-sso.sh";

/**
 * Funkce UVNITŘ provision-sso.sh, jejíž nezdar je nosný. Sama umí selhat
 * s přesnou hláškou („never report success over a secret that did not persist"),
 * ale `fail()` jen VYPISUJE a končí se `return 1` — takže `|| true` u volajícího
 * tu hlášku pošle do prázdna. Přesně tak stálo 2026-08-20 všech DESET volání.
 */
const NOSNA_FUNKCE = "set_client_secret";

/** Řádky, kde se NOSNÁ FUNKCE volá a její nezdar se spolkne. */
export function spolknutaFunkce(cesta: string, text: string): string[] {
  if (cesta.endsWith("razitkovani-secretu-nesmi-spolknout-nezdar.gate.test.ts")) return [];
  const nalezy: string[] = [];
  text.split("\n").forEach((radek, i) => {
    if (!new RegExp(`\\b${NOSNA_FUNKCE}\\s+"`).test(radek)) return; // volání, ne definice
    if (/^\s*#/.test(radek)) return;
    if (/\|\|\s*(true|warn\b)/.test(radek)) nalezy.push(`${cesta}:${i + 1}`);
  });
  return nalezy;
}

/** Řádky, kde se nástroj volá v režimu APPLY a nezdar se spolkne. */
export function spolknuteNezdary(cesta: string, text: string): string[] {
  if (cesta.endsWith("razitkovani-secretu-nesmi-spolknout-nezdar.gate.test.ts")) return [];
  const nalezy: string[] = [];
  text.split("\n").forEach((radek, i) => {
    if (!radek.includes(NASTROJ)) return;
    if (/^\s*#/.test(radek)) return;              // komentář popisuje, nevykonává
    if (radek.includes("--check")) return;        // kontrolní režim smí být shovívavý
    if (/\|\|\s*(true|warn\b)/.test(radek)) nalezy.push(`${cesta}:${i + 1}`);
  });
  return nalezy;
}

describe("razítkování secretů nesmí spolknout nezdar", () => {
  test("detektor pozná tvar, kvůli kterému brána vznikla", () => {
    // Přesně oba tvary, které tam 2026-08-20 stály.
    expect(spolknuteNezdary("a.sh", "bash scripts/provision-sso.sh || true")).toEqual(["a.sh:1"]);
    expect(spolknuteNezdary("b.sh", '  ... provision-sso.sh ... || warn "non-zero"')).toEqual(["b.sh:1"]);
    // Kontrolní režim smí.
    expect(spolknuteNezdary("c.sh", "bash scripts/provision-sso.sh --check || true")).toEqual([]);
    // Komentář, který ten tvar POPISUJE, není jeho výskytem.
    expect(spolknuteNezdary("d.sh", "# dřív tu bylo provision-sso.sh || true")).toEqual([]);
    // Poctivé volání projde.
    expect(spolknuteNezdary("e.sh", "bash scripts/provision-sso.sh || exit 1")).toEqual([]);

    // A totéž pro nosnou funkci uvnitř skriptu.
    expect(spolknutaFunkce("f.sh", '  set_client_secret "n8n-proxy" "$X" || true')).toEqual(["f.sh:1"]);
    expect(spolknutaFunkce("g.sh", '  _try_secret "n8n-proxy" "$X"')).toEqual([]);
    expect(spolknutaFunkce("h.sh", '  # set_client_secret "x" "$Y" || true')).toEqual([]);
  });

  test("nosná funkce uvnitř skriptu taky nespolkne nezdar", () => {
    const nalezy = execFileSync("git", ["ls-files", "scripts"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n").filter(Boolean)
      .flatMap((c) => spolknutaFunkce(c, readFileSync(join(ROOT, c), "utf-8")));
    expect(
      nalezy,
      `\`${NOSNA_FUNKCE}\` tu selhává do prázdna. Ta funkce umí ohlásit PŘESNĚ, co se\n` +
        "nepovedlo — má to i ve svém komentáři — ale `fail()` jen vypisuje a končí se\n" +
        "`return 1`, takže `|| true` tu hlášku zahodí. Naměřeno 2026-08-20: takhle bylo\n" +
        "zneškodněno VŠECH DESET volání a rozešlo se 11 secretů napříč 7 aplikacemi.\n\n" +
        "CO S TÍM: posbírej nezdary (ať jeden vadný klient neschová ostatní) a na konci\n" +
        "skonči `exit 1` se jmenným výčtem.\n" +
        "NEDĚLEJ: neměň `|| true` na `|| warn` — je to totéž, jen tišší.\n\n" +
        "SPOLKNUTO:\n  " + nalezy.join("\n  "),
    ).toEqual([]);
  });

  test("univerzum není prázdné — jinak brána neměří nic", () => {
    const soubory = execFileSync("git", ["ls-files", "scripts"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n").filter(Boolean)
      .filter((c) => readFileSync(join(ROOT, c), "utf-8").includes(NASTROJ));
    expect(
      soubory.length,
      `žádný sledovaný skript nezmiňuje ${NASTROJ} — buď se přejmenoval, nebo se rozbilo\n` +
        "čtení `git ls-files`; brána by tiše prošla nad prázdnem",
    ).toBeGreaterThan(0);
  });

  test("žádné volání razítkování nespolkne nezdar", () => {
    const nalezy = execFileSync("git", ["ls-files", "scripts"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n").filter(Boolean)
      .flatMap((c) => spolknuteNezdary(c, readFileSync(join(ROOT, c), "utf-8")));
    expect(
      nalezy,
      "tady se razítkování secretů volá a jeho nezdar se převádí na varování nebo `true`.\n" +
        "Bez tohohle kroku nefunguje ŽÁDNÉ přihlášení přes proxy — a protože běh pokračuje,\n" +
        "stack naskočí zeleně a vadu najde až člověk, kterého to nepustí dovnitř.\n\n" +
        "CO S TÍM: ukonči běh (`exit 1` / `die`) a řekni nahlas, co tím padá.\n" +
        "NEDĚLEJ: nenahrazuj `|| true` za `|| warn` — obojí je totéž, jen tišší.\n" +
        "Shovívavý smí být jen `--check`.\n\n" +
        "SPOLKNUTÝ NEZDAR:\n  " + nalezy.join("\n  "),
    ).toEqual([]);
  });
});
