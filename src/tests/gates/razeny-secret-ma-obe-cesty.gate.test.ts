/**
 * Brána: secret, který se RAZÍ, musí mít obě cesty a jednu implementaci.
 *
 * TŘÍDA VADY: tajemství s expirací, o kterou se nikdo nestará. Apple stropuje
 * client secret pro Sign in with Apple na ES256 JWT s platností 6 měsíců.
 * Statická hodnota v prostředí tedy VŽDYCKY jednou vyprší — a projeví se to
 * tím, že přihlášení Applem přestane fungovat, aniž by kdekoli vznikla chyba.
 * Vada se nastěhuje v den nasazení a vyleze až za půl roku.
 *
 * Řešení je, že se secret NEDEKLARUJE, ale ODVOZUJE: razí se znovu při každém
 * startu Keycloaku i při každém rolloutu. Tím ale vznikají DVĚ cesty k témuž
 * tajemství — a tahle brána hlídá, že se nerozejdou a že ani jedna tiše nevypadne.
 *
 * CO SE MĚŘÍ (vlastnosti, ne pravopis):
 *   1. univerzum není prázdné — jinak brána neměří nic;
 *   2. každá raznice je v obrazu Keycloaku (bez COPY se ražba při startu
 *      NEPROVEDE a spadne se na prázdnou statickou hodnotu — tiše);
 *   3. obě cesty raznici volají (konvence jména, ne konkrétní alias);
 *   4. raznice umí odpovědět NE — bez materiálu nesmí vrátit prázdno s exit 0;
 *   5. podepisovací primitivum existuje v repu JEDNOU — druhá kopie převodu
 *      DER → JOSE by se časem rozešla a poznalo by se to až tím, že Apple
 *      secret odmítne.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Cesty, kudy se k témuž raženému tajemství dá dojít. Obě musí raznici volat. */
const KONZUMENTI = [
  "keycloak/configure-realms.sh", // uvnitř kontejneru při startu
  "scripts/instance-rollout.sh", // zvenčí proti admin API
];

const DOCKERFILE = "Dockerfile.keycloak";

/** Univerzum se HLEDÁ: každá raznice pojmenovaná podle konvence. */
export function raznice(): string[] {
  return execFileSync("git", ["ls-files", "keycloak/mint-*-secret.py"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter(Boolean);
}

/** Volá ten soubor raznici? Konvenci jména, ne konkrétní alias — volající ji
 *  smí skládat z proměnné (`mint-${ALIAS}-secret.py`), a to je správně. */
export function volaRaznici(text: string): boolean {
  return /mint-[$A-Za-z{}_-]*-?secret\.py/.test(text);
}

/** Kopíruje Dockerfile ten soubor do obrazu? */
export function jeVObrazu(dockerfile: string, cesta: string): boolean {
  return new RegExp(`^COPY[^\\n]*\\b${cesta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "m").test(dockerfile);
}

describe("ražený secret má obě cesty a jednu implementaci", () => {
  test("detektory poznají tvar, kvůli kterému brána vznikla", () => {
    // Volání raznice — literálem i přes proměnnou.
    expect(volaRaznici('python3 "$X/mint-apple-secret.py"')).toBe(true);
    expect(volaRaznici('"${REPO_ROOT}/keycloak/mint-${ALIAS}-secret.py"')).toBe(true);
    // A umí říct NE: soubor, který raznici nevolá.
    expect(volaRaznici('OAUTH_APPLE_CLIENT_SECRET="${OAUTH_APPLE_CLIENT_SECRET:-}"')).toBe(false);

    // COPY se pozná jen na začátku řádku — zmínka v komentáři nestačí.
    expect(jeVObrazu("COPY --chmod=0755 keycloak/mint-x-secret.py /opt/k/", "keycloak/mint-x-secret.py")).toBe(true);
    expect(jeVObrazu("# COPY keycloak/mint-x-secret.py sem někdy dát", "keycloak/mint-x-secret.py")).toBe(false);
    expect(jeVObrazu("COPY keycloak/jine.py /opt/k/", "keycloak/mint-x-secret.py")).toBe(false);
  });

  test("univerzum není prázdné — jinak brána neměří nic", () => {
    expect(
      raznice().length,
      "žádná `keycloak/mint-*-secret.py` — buď se změnila konvence jmen, nebo se rozbilo\n" +
        "čtení `git ls-files`; brána by tiše prošla nad prázdnem",
    ).toBeGreaterThan(0);
  });

  test("každá raznice je v obrazu Keycloaku", () => {
    const df = readFileSync(join(ROOT, DOCKERFILE), "utf-8");
    const chybi = raznice().filter((r) => !jeVObrazu(df, r));
    expect(
      chybi,
      `${DOCKERFILE} tuhle raznici nekopíruje do obrazu. Uvnitř kontejneru pak neexistuje,\n` +
        "ražba se PŘESKOČÍ a spadne se na statickou hodnotu — u nás prázdnou. Přihlášení\n" +
        "tím poskytovatelem přestane fungovat a nikde nevznikne chyba.\n\n" +
        `CO S TÍM: přidej vedle ostatních \`COPY --chmod=0755 <cesta> /opt/keycloak/<jméno>\`.\n` +
        "NEDĚLEJ: nespoléhej, že se soubor dostane do obrazu přes nadřazený COPY adresáře —\n" +
        "`keycloak/` se do obrazu nekopíruje celý, jde tam soubor po souboru.\n\n" +
        "NENÍ V OBRAZU:\n  " + chybi.join("\n  "),
    ).toEqual([]);
  });

  test("obě cesty k tajemství raznici volají", () => {
    const nevolaji = KONZUMENTI.filter((c) => !volaRaznici(readFileSync(join(ROOT, c), "utf-8")));
    expect(
      nevolaji,
      "tenhle konzument si secret bere jinak než ražbou. Dokud to dělá jen jeden z nich,\n" +
        "vypadá všechno zeleně: start Keycloaku secret orazí, rollout ho vzápětí přepíše\n" +
        "statickou (prázdnou) hodnotou — nebo naopak. Rozdíl se pozná až tím, že Apple\n" +
        "secret odmítne.\n\n" +
        "CO S TÍM: volej `keycloak/mint-<alias>-secret.py` i odsud.\n" +
        "NEDĚLEJ: nekopíruj ražbu do druhého skriptu — od toho je ta raznice jedna.\n\n" +
        "NEVOLAJÍ:\n  " + nevolaji.join("\n  "),
    ).toEqual([]);
  });

  test("raznice umí odpovědět NE", () => {
    for (const r of raznice()) {
      const cista = { ...process.env };
      for (const k of execFileSync("python3", [join(ROOT, r), "--required-env"], { encoding: "utf-8" })
        .split("\n").filter(Boolean)) delete cista[k];
      const beh = spawnSync("python3", [join(ROOT, r)], { env: cista, encoding: "utf-8" });
      expect(
        { raznice: r, exit: beh.status, stdout: beh.stdout },
        `${r} bez materiálu klíče NESMÍ skončit úspěchem ani vrátit prázdný stdout s exit 0.\n` +
          "Tichý nezdar by se propsal jako prázdný secret a přihlášení by umřelo bez chyby.\n\n" +
          "CO S TÍM: chybějící vstup vypiš na stderr a skonči nenulově.",
      ).toEqual({ raznice: r, exit: expect.any(Number), stdout: "" });
      expect(beh.status, `${r}: exit musí být nenulový`).not.toBe(0);
      expect(beh.stderr.trim().length, `${r}: nezdar musí říct DŮVOD na stderr`).toBeGreaterThan(0);
    }
  });

  test("podepisovací primitivum je v repu jednou", () => {
    // Druhá implementace převodu DER → JOSE je přesně to, čemu se raznice vyhýbá.
    //
    // ⛔ Vzor musí chytit OBA zápisy: shellové `openssl dgst -sha256 -sign`
    // i seznam argumentů v Pythonu `["openssl", "dgst", "-sha256", "-sign"]`.
    // Doslovný řetězec s mezerami chytá jen ten první — a protože sama raznice
    // je v Pythonu, měřila by brána nad PRÁZDNEM a tiše procházela.
    const kdo = execFileSync("git", ["grep", "-lE", "--", "dgst[^\\n]{0,40}-sign"], {
      cwd: ROOT, encoding: "utf-8",
    }).split("\n").filter(Boolean);
    // Brána sama sebe za implementaci nepovažuje — jinak by se obvinila tím,
    // že ten vzor vůbec vyslovila.
    const bezSebe = kdo.filter((f) => !f.endsWith("razeny-secret-ma-obe-cesty.gate.test.ts"));
    expect(
      bezSebe.length,
      "vzor nechytil ANI JEDNU raznici — detektor měří nad prázdnem a prošel by,\n" +
        "i kdyby se ražba do repa nikdy nedostala. Ověř vzor proti `keycloak/mint-*-secret.py`.",
    ).toBeGreaterThan(0);
    const navic = bezSebe.filter((f) => !/^keycloak\/mint-.*-secret\.py$/.test(f));
    expect(
      navic,
      "tenhle soubor si podepisuje ES256 sám, mimo raznici. Převod podpisu DER → raw JOSE\n" +
        "je na pár bajtů přesná operace (ořez vodicích nul, doplnění na 32 B) a dvě kopie\n" +
        "se časem rozejdou — projeví se to až tím, že poskytovatel secret odmítne.\n\n" +
        "CO S TÍM: volej `keycloak/mint-<alias>-secret.py`.\n\n" +
        "PODEPISUJE MIMO RAZNICI:\n  " + navic.join("\n  "),
    ).toEqual([]);
  });
});
