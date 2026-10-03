/**
 * Brána: zkamenělá hodnota v trezoru nesmí přebíjet živou.
 *
 * ── PROČ ──────────────────────────────────────────────────────────────────────
 * Kanonický řetěz (lib/config-env-files.mjs) dává `.env-prod-backup` VYŠŠÍ
 * přednost než `.env.coolify`. U klíče, který dodal operátor, je to záměr.
 * Jenže do trezoru se zpětnou synchronizací dostanou jen SPRAVOVANÁ tajemství —
 * tedy hodnoty, které si vyrábí platforma. Ty tam pak ZKAMENÍ: generátor je
 * přerazí do `.env.coolify`, trezor si drží starou a přebíjí ji.
 *
 * ⛔ NAMĚŘENO 2026-08-25 (stálo to několik hodin):
 *   · `netbird-bootstrap.sh` přerazil čtyři setup klíče; trezor si nechal mrtvé
 *     a agenti hlásili `setup key is invalid`, ač validace „podle ID" procházela
 *   · `AISHA_BOOTSTRAP_CLIENT_SECRET` → 401 unauthorized_client, ač secret
 *     v `.env.coolify` s Keycloakem SEDĚL (ověřeno otiskem proti admin API)
 *   · `NETBIRD_DNS_IP=127.0.0.11` (vestavěný resolver Dockeru) přebíjel odvozený
 *     mesh resolver — týž incident jako MESH_DNS_SUBNET 2026-08-13, jiný klíč
 *
 * Do té doby `coolify-pull-envs.mjs` doplňoval jen CHYBĚJÍCÍ klíče, takže vadu
 * nemohl vyléčit — a filtr odvozených bránil jen ZÁPISU, ne tomu, co už uvnitř
 * leželo.
 *
 * Měří se CHOVÁNÍ rozhodovací funkce, ne text zdrojáku.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const { klasifikujTrezor } = await import(
  /* @vite-ignore */ join(ROOT, "scripts/coolify-pull-envs.mjs")
);
const { DERIVED_NETWORK_KEYS } = await import(
  /* @vite-ignore */ join(ROOT, "scripts/lib/derive-subnets.mjs")
);

const trezor = (dvojice: [string, string][]) => ({
  values: new Map(dvojice),
  keys: new Set(dvojice.map(([k]) => k)),
});

describe("trezor nepřebíjí živou hodnotu", () => {
  test("spravovaný klíč s JINOU živou hodnotou se PŘERAZÍ (jádro vady)", () => {
    const { values, keys } = trezor([["NETBIRD_STACK_KEY_BACKEND", "mrtvy-klic"]]);
    const v = klasifikujTrezor(
      new Map([["NETBIRD_STACK_KEY_BACKEND", "zivy-klic"]]),
      values, keys, new Set(),
    );
    expect(v.refreshed).toEqual([["NETBIRD_STACK_KEY_BACKEND", "zivy-klic"]]);
    expect(v.unchanged, "shodná hodnota se nepočítá jako přeražení").toBe(0);
    expect(v.toAdd, "klíč v trezoru JE — nemá se přidávat podruhé").toHaveLength(0);
  });

  test("shodná hodnota se NEPŘEPISUJE (žádný šum, žádný zbytečný zápis)", () => {
    const { values, keys } = trezor([["JWT_SECRET", "stejne"]]);
    const v = klasifikujTrezor(new Map([["JWT_SECRET", "stejne"]]), values, keys, new Set());
    expect(v.refreshed).toHaveLength(0);
    expect(v.unchanged).toBe(1);
  });

  test("chybějící klíč se doplní", () => {
    const { values, keys } = trezor([]);
    const v = klasifikujTrezor(new Map([["POSTGRES_PASSWORD", "nova"]]), values, keys, new Set());
    expect(v.toAdd).toEqual([["POSTGRES_PASSWORD", "nova"]]);
  });

  test("ODVOZENÝ klíč se z trezoru VYHODÍ, ne přerazí — odvození si ho spočítá samo", () => {
    const { values, keys } = trezor([["NETBIRD_DNS_IP", "127.0.0.11"]]);
    const v = klasifikujTrezor(new Map(), values, keys, new Set(DERIVED_NETWORK_KEYS));
    expect(v.toRemove).toContain("NETBIRD_DNS_IP");
    expect(v.refreshed, "odvozené se NEPŘERAZÍ — nesmí v trezoru zůstat vůbec").toHaveLength(0);
  });

  test("odvozený klíč, který v trezoru NENÍ, se nevyhazuje (nic k dělání)", () => {
    const { values, keys } = trezor([["JWT_SECRET", "x"]]);
    const v = klasifikujTrezor(new Map(), values, keys, new Set(DERIVED_NETWORK_KEYS));
    expect(v.toRemove).toHaveLength(0);
  });

  test("celá rodina odvozených klíčů se hlídá — ne vzorek jmen", () => {
    expect(DERIVED_NETWORK_KEYS.length, "seznam je prázdný — nic se neměří").toBeGreaterThan(0);
    const dvojice = DERIVED_NETWORK_KEYS.map((k: string) => [k, "fosil"] as [string, string]);
    const { values, keys } = trezor(dvojice);
    const v = klasifikujTrezor(new Map(), values, keys, new Set(DERIVED_NETWORK_KEYS));
    expect(v.toRemove.sort()).toEqual([...DERIVED_NETWORK_KEYS].sort());
  });

  test("nástroj je knihovna i CLI — import ho NESMÍ spustit", () => {
    // Bez téhle stráže by tenhle test sám provedl zpětnou synchronizaci proti
    // živému Coolify a přepsal operátorův trezor.
    const js = readFileSync(join(ROOT, "scripts/coolify-pull-envs.mjs"), "utf-8");
    expect(js).toMatch(/isDirectRun\(import\.meta\.url\)/);
    expect(
      /if \(isDirectRun\(import\.meta\.url\)\) \{\s*\n\s*main\(\)/.test(js),
      "main() musí být UVNITŘ stráže vstupního bodu",
    ).toBe(true);
  });

  test("modul se dá IMPORTOVAT bez pověření — knihovna nesmí při importu skončit", () => {
    // ⛔ NAMĚŘENO 2026-08-25: rozlišení pověření stálo v MODULOVÉM ROZSAHU, takže
    // `import` volal `fatal()` → `process.exit(1)` a tahle brána padala celá jako
    // suite („process.exit unexpectedly called with 1"). LOKÁLNĚ TO PROŠLO, protože
    // `.env.coolify` na disku je — jenže je gitignorovaný, takže v CI NENÍ.
    // `isDirectRun` hlídá `main()`, tohle ne. Stálo to 27minutový běh CI.
    const js = readFileSync(join(ROOT, "scripts/coolify-pull-envs.mjs"), "utf-8");
    const naNulteUrovni = js
      .split("\n")
      .filter((l) => /^(fatal\(|process\.exit\(|if \s*\(.*\)\s*fatal\()/.test(l));
    expect(
      naNulteUrovni,
      "volání fatal()/process.exit() v modulovém rozsahu — import modulu by ukončil " +
        "proces volajícího; patří dovnitř funkce",
    ).toEqual([]);
  });

  test("cold-start nesmí nezdar zpětné synchronizace umlčet", () => {
    // Krok je to JEDINÉ, co srovná trezor se živým stackem před zničením.
    // `>/dev/null 2>&1` z jeho nezdaru dělalo jeden žlutý řádek.
    const sh = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8");
    // ⛔ Univerzum se musí vybrat na ŘÁDEK, KTERÝ TO SPOUŠTÍ. První výskyt
    // jména je KOMENTÁŘ o 130 řádků výš — brána na něm procházela i s
    // obnoveným `>/dev/null 2>&1` (chyceno mutací 2026-08-25).
    const radky = sh.split("\n").filter(
      (l) => l.includes("coolify-pull-envs.mjs") && /\bnode\b/.test(l) && !/^\s*#/.test(l),
    );
    expect(radky, "volání coolify-pull-envs.mjs se v cold-startu nenašlo — brána nic neměří").toHaveLength(1);
    const radek = radky[0];
    expect(radek, "výstup reverse-syncu se zahazuje do /dev/null").not.toMatch(/>\s*\/dev\/null/);
    expect(
      /\| *tee/.test(radek),
      "roura by testovala exit kód tee, ne nodu — větev nezdaru by se nikdy nevykonala",
    ).toBe(false);
  });
});
