/**
 * Brána: tajemství, které čte startovací skript, má pojistku U SPOTŘEBY
 *
 * PROČ TAHLE BRÁNA VZNIKLA. Compose má na prázdnou hodnotu pojistku
 * `${SECRET:?}` — jenže ta se ptá při PARSOVÁNÍ, a Coolify parsuje celý soubor
 * dvakrát: jednou při buildu (jen s `build-time.env`) a podruhé při spuštění.
 * Aby build neumřel, musí takové tajemství dostat `is_buildtime=true` — a to
 * znamená `--build-arg` a `ARG <KEY>` za každým `FROM`, tedy zápis do
 * `docker history`, odkud ho vydá komukoli, kdo na obraz dosáhne, napořád.
 *
 * Pojistka na prázdno se tedy platila trvale vystaveným tajemstvím.
 *
 * OTÁZKA, na kterou se `${VAR:?}` ptal, byla „dorazila hodnota?". Tu dnes
 * zodpovídá `coolify-sync-envs.sh` přímo tam, kde se doručuje (zpětné čtení po
 * zápisu). Zbývá druhé riziko: kontejner může prázdnou hodnotu dostat i jinak
 * (ruční zásah v Coolify UI, jiný zdroj env) — a když ji startovací skript
 * zapíše do ACL, do `CREATE USER … WITH PASSWORD` nebo do konfigurace, vznikne
 * účet bez použitelného hesla. To NENÍ hlasité selhání; to je tichá díra.
 *
 * INVARIANT: čte-li startovací skript služby (`command:` / `entrypoint:` blok)
 * hodnotu, která vypadá jako tajemství, musí týž skript umět skončit nenulově,
 * když je prázdná.
 *
 * ⛔ ROZPOZNÁVÁ SE SYNTAKTICKY, a tedy FAIL-CLOSED: co brána nerozpozná jako
 * pojistku, počítá jako NEHLÍDANÉ. Radši falešný poplach než tichá díra.
 * Uznávané tvary (všechny tři se v repu opravdu vyskytují):
 *   a) přímý test        `[ -z "$${JMENO}" ]`
 *   b) přes proměnnou    `X="$${JMENO-}"` … `[ -z "$$X" ]`
 *   c) smyčkou           `for J in JMENO …` + `printenv` + test prázdnoty
 *
 * ⛔ NAMĚŘENO 2026-08-16: 7 → 0. Pojistka u spotřeby je ve VŠECH startovacích
 * skriptech, které tajemství čtou. Tím je splněná podmínka pro další krok:
 * `${SECRET:?}` se z `environment:` smí odebírat, protože fail-closed
 * vlastnost už drží nižší patro. Rohatka na nule to udrží — a druhý test
 * hlídá, aby nikdo `:?` neodebral DŘÍV, než pojistku přidá.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();

/** ⛔ NAMĚŘENO 2026-08-16. Smí jen KLESAT — je to dluh, ne strop. */
const ROHATKA_NEHLIDANYCH = 0;

const TAJEMSTVI = /(TOKEN|SECRET|PASSWORD|PASSWD|_PWD|APIKEY|API_KEY|_KEY$|_KEY_|PRIVATE|CREDENTIAL|SALT)/i;
const NENI_TAJEMSTVI = /(ANON_KEY|PUBLISHABLE|PUBLIC_KEY|_KEY_ID$|KEYCLOAK_REALM|_KEYS_DIR|KEY_ALGORITHM)/i;
const jeTajemstvi = (k: string) => TAJEMSTVI.test(k) && !NENI_TAJEMSTVI.test(k);

interface Skript {
  soubor: string;
  radek: number;
  text: string;
}

/**
 * Startovací skripty = blokové skaláry pod `command:` / `entrypoint:`.
 * Blok končí prvním řádkem s menším nebo stejným odsazením než klíč sám.
 */
function startovaciSkripty(soubor: string): Skript[] {
  const radky = readFileSync(path.join(ROOT, soubor), "utf8").split("\n");
  const out: Skript[] = [];
  let i = 0;
  while (i < radky.length) {
    const m = radky[i].match(/^(\s*)-?\s*(?:command|entrypoint):/);
    if (!m) { i++; continue; }
    const odsaz = m[1].length;
    const telo: string[] = [];
    let j = i + 1;
    while (j < radky.length && (radky[j].trim() === "" || radky[j].match(/^\s*/)![0].length > odsaz)) {
      telo.push(radky[j]);
      j++;
    }
    if (telo.length) out.push({ soubor, radek: i + 1, text: telo.join("\n") });
    i = j;
  }
  return out;
}

/** Jména, na jejichž prázdnost se skript umí zeptat. */
function hlidana(text: string): Set<string> {
  const set = new Set<string>();

  // (a) přímý test na `$${JMENO}` uvnitř [ -z / -n ]
  for (const m of text.matchAll(/\[\s*-[zn]\s+"?\$\$\{?([A-Z][A-Z0-9_]*)/g)) set.add(m[1]);

  // (b) přes proměnnou: `X="$${JMENO…}"` a někde dál `[ -z "$$X" ]`
  const testovaneProm = new Set(
    [...text.matchAll(/\[\s*-[zn]\s+"?\$\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  );
  for (const m of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=\s*"?\$\$\{?([A-Z][A-Z0-9_]*)/g)) {
    if (testovaneProm.has(m[1])) set.add(m[2]);
  }

  // (c) smyčka přes jména + printenv + test prázdnoty
  if (/printenv/.test(text) && /-[zn]\s/.test(text)) {
    for (const m of text.matchAll(/for\s+\w+\s+in\s+([^\n;]+)/g)) {
      for (const slovo of m[1].split(/\s+/)) {
        if (/^[A-Z][A-Z0-9_]*$/.test(slovo)) set.add(slovo);
      }
    }
  }
  return set;
}

const skripty = readdirSync(ROOT)
  .filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f))
  .sort()
  .flatMap(startovaciSkripty);

const nalezy = skripty.flatMap((s) => {
  const jmena = [...new Set([...s.text.matchAll(/\$\$\{?([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))]
    .filter(jeTajemstvi);
  const kryta = hlidana(s.text);
  return jmena.filter((k) => !kryta.has(k)).map((k) => ({ ...s, klic: k }));
});

describe("brána: tajemství má pojistku u spotřeby", () => {
  it("startovací skripty se vůbec našly — prázdno by bylo NEZMĚŘENO, ne čisto", () => {
    expect(
      skripty.length,
      "nenašel se ani jeden blok `command:`/`entrypoint:` — brána by měřila prázdno " +
        "a tvářila se přitom zeleně",
    ).toBeGreaterThan(10);
    const sTajemstvim = skripty.filter((s) =>
      [...s.text.matchAll(/\$\$\{?([A-Z][A-Z0-9_]*)/g)].some((m) => jeTajemstvi(m[1])),
    );
    expect(
      sTajemstvim.length,
      "žádný startovací skript nečte tajemství — to je proti měření z 2026-08-16, " +
        "kdy jich bylo 14. Nejspíš se rozbila detekce bloků.",
    ).toBeGreaterThan(5);
  });

  it("rohatka: nehlídaná tajemství ve startovacích skriptech smí jen KLESAT", () => {
    const vypis = nalezy.map((n) => `  ${n.soubor}:${n.radek}  ${n.klic}`).join("\n");
    expect(
      nalezy.length,
      `Nehlídaných tajemství: ${nalezy.length} (rohatka ${ROHATKA_NEHLIDANYCH}).\n` +
        "Startovací skript tuhle hodnotu ČTE a zapisuje ji do konfigurace (ACL,\n" +
        "CREATE USER …), ale neumí skončit nenulově, když je prázdná. Prázdné heslo\n" +
        "tak nevytvoří hlasité selhání, ale účet bez použitelného hesla.\n" +
        "Uznávané tvary pojistky: `[ -z \"$${JMENO}\" ]`, test přes proměnnou,\n" +
        "nebo smyčka s `printenv`. Viz docker-compose.coolify-shared-redis.yml.\n" +
        vypis,
    ).toBeLessThanOrEqual(ROHATKA_NEHLIDANYCH);

    expect(
      nalezy.length,
      `Kleslo na ${nalezy.length} — utáhni ROHATKA_NEHLIDANYCH na tuhle hodnotu,\n` +
        "jinak brána dovolí regresi zpátky na starou.",
    ).toBeGreaterThanOrEqual(ROHATKA_NEHLIDANYCH);
  });

  it("kdo POJISTKU V COMPOSE už nemá, musí ji mít v skriptu", () => {
    // Tohle je ta strana, kde se dá udělat REGRESE: odebrat `${SECRET:?}` z
    // compose (a tím tajemství dostat z buildu) a zapomenout přidat pojistku
    // u spotřeby. Výsledek by vypadal jako zlepšení — rohatka build-time
    // množiny by klesla — a přitom by to byla tichá díra.
    const chybne: string[] = [];
    for (const s of skripty) {
      const obsah = readFileSync(path.join(ROOT, s.soubor), "utf8");
      const kryta = hlidana(s.text);
      const jmena = [...new Set([...s.text.matchAll(/\$\$\{?([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))]
        .filter(jeTajemstvi);
      for (const k of jmena) {
        const maFailClosed = new RegExp(`\\$\\{${k}:\\?`).test(obsah);
        if (!maFailClosed && !kryta.has(k)) chybne.push(`${s.soubor}:${s.radek}  ${k}`);
      }
    }
    expect(
      chybne,
      "Tyhle klíče nemají pojistku ANI v compose (`${VAR:?}`), ANI ve skriptu, který\n" +
        "je čte. Prázdná hodnota tudy projde tiše až do konfigurace služby:\n  " +
        chybne.join("\n  "),
    ).toEqual([]);
  });
});
