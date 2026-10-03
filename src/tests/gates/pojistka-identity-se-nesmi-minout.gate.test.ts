/**
 * Brána: pojistka identity se nesmí minout s hodnotou, kterou má hlídat.
 *
 * TŘÍDA VADY: stráž zapsaná UVNITŘ výchozí větve. Tvar
 *
 *     VAR="${VAR:-…${APP_NAME_PREFIX:?identita se NEHÁDÁ}-db}"
 *
 * vypadá jako pojistka identity, ale `:?` se vyhodnotí jen tehdy, když `VAR`
 * CHYBÍ — tedy právě tehdy, kdy není co hlídat. Existující hodnota jmenující
 * CIZÍ instanci projde beze slova. Pojistka je nedosažitelná přesně ve chvíli,
 * kdy je potřeba.
 *
 * ⛔ NAMĚŘENO 2026-08-20: `N8N_DB_HOST=aisha-db` leželo v SoT a n8n na něm
 * viselo hodinu na „waiting for DB…" — to jméno se v síti instance NEROZLOŽÍ
 * (ověřeno `getent` z kontejneru). Generátor byl přitom správně opravený;
 * jen se ke slovu nedostal, protože `${VAR:-…}` dává přednost existující
 * hodnotě. Táž vada seděla i v `AISHA_DB_URL`.
 *
 * CO BRÁNA TVRDÍ: každé přiřazení, jehož VÝCHOZÍ hodnota staví na
 * `APP_NAME_PREFIX` (tedy nese identitu instance), musí být následováno
 * `vyzaduj_identitu` nad VÝSLEDKEM. Univerzum si brána HLEDÁ v souboru,
 * nevypisuje — nový takový klíč se pod ni dostane bez zásahu.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SKRIPT = "scripts/coolify-deploy-init.sh";

/** `KLIC="${KLIC:-…APP_NAME_PREFIX…}"` — přiřazení, jehož default nese identitu. */
const IDENTITNI_PRIRAZENI = /^([A-Z0-9_]+)="\$\{\1:-[^\n]*APP_NAME_PREFIX/;
/** `vyzaduj_identitu KLIC "$KLIC"` */
const OVERENI = /^\s*vyzaduj_identitu\s+([A-Z0-9_]+)\b/;

/** Klíče, které si default staví z identity, ale výsledek si nikdo neověří. */
export function neoverene(zdroj: string): string[] {
  const radky = zdroj.split("\n");
  const overene = new Set<string>();
  for (const r of radky) {
    const m = OVERENI.exec(r);
    if (m) overene.add(m[1]);
  }
  const chybi: string[] = [];
  for (let i = 0; i < radky.length; i++) {
    const m = IDENTITNI_PRIRAZENI.exec(radky[i]);
    if (m && !overene.has(m[1])) chybi.push(`${m[1]} (řádek ${i + 1})`);
  }
  return chybi;
}

describe("pojistka identity se nesmí minout", () => {
  test("detektor pozná tvar, kvůli kterému brána vznikla", () => {
    // Přesně ten tvar, který 2026-08-20 položil n8n: default nese identitu,
    // výsledek nikdo neověří.
    const vadny = 'N8N_DB_HOST="${N8N_DB_HOST:-${APP_NAME_PREFIX:?identita}-db}"';
    expect(neoverene(vadny)).toEqual(["N8N_DB_HOST (řádek 1)"]);

    // Se stráží nad VÝSLEDKEM je to v pořádku.
    const spravny = [
      'N8N_DB_HOST="${N8N_DB_HOST:-${APP_NAME_PREFIX:?identita}-db}"',
      'vyzaduj_identitu N8N_DB_HOST "$N8N_DB_HOST"',
    ].join("\n");
    expect(neoverene(spravny)).toEqual([]);

    // Přiřazení, které identitu nenese, brána neřeší — jinak by nutila lidi
    // ověřovat hodnoty, o kterých netvrdí nic.
    const bezIdentity = 'N8N_DB_PORT="${N8N_DB_PORT:-5432}"';
    expect(neoverene(bezIdentity)).toEqual([]);
  });

  test("pomocník `vyzaduj_identitu` v tom skriptu vůbec existuje", () => {
    // Bez něj by se brána stala no-opem: `overene` by zůstala prázdná jen
    // proto, že se nemá čím naplnit.
    const sh = readFileSync(join(ROOT, SKRIPT), "utf-8");
    expect(sh, `${SKRIPT}: chybí definice vyzaduj_identitu()`).toMatch(
      /^vyzaduj_identitu\(\)\s*\{/m,
    );
    // A musí ZASTAVIT, ne jen zalogovat.
    const telo = /^vyzaduj_identitu\(\)\s*\{[\s\S]*?^\}/m.exec(sh);
    expect(telo, `${SKRIPT}: tělo vyzaduj_identitu() se nedá přečíst`).not.toBeNull();
    expect(telo![0], `${SKRIPT}: vyzaduj_identitu nezastaví běh`).toMatch(/exit 1/);
  });

  test("žádný identitní klíč nezůstal bez ověření výsledku", () => {
    const sh = readFileSync(join(ROOT, SKRIPT), "utf-8");
    expect(
      neoverene(sh),
      "přiřazení staví výchozí hodnotu z APP_NAME_PREFIX, ale VÝSLEDEK nikdo neověří.\n" +
        "`${VAR:-…${APP_NAME_PREFIX:?…}}` NENÍ pojistka: `:?` se vyhodnotí jen když VAR\n" +
        "chybí — tedy právě tehdy, kdy není co hlídat. Zastaralá hodnota jmenující cizí\n" +
        "instanci projde beze slova (2026-08-20: n8n hodinu na „waiting for DB…\").\n\n" +
        "CO S TÍM: hned za přiřazení přidej\n" +
        "  vyzaduj_identitu <KLIC> \"$<KLIC>\"\n" +
        "NEDĚLEJ: nespoléhej na `:?` uvnitř defaultu a nedělej z toho varování —\n" +
        "tichý průchod je celá ta vada.\n\n" +
        "BEZ OVĚŘENÍ:\n  " + neoverene(sh).join("\n  "),
    ).toEqual([]);
  });
});
