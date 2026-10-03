/**
 * Brána: trezor musí přežít `source` a nesmí nést hlášku místo hodnoty (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-09-16 na DVOU instancích při studeném startu.
 *
 * A. HODNOTA, KTERÁ NEPŘEŽIJE `source`. Půl nasazovací cesty čte `.env.coolify`
 *    shellem (`scripts/_env-loader.sh`, cold-start, doktor, deploy-init).
 *    Víceslovná hodnota bez uvozovek se rozpadne:
 *      · instance A — `COSMOS_SIGNER_MNEMONIC=churn dish wagon …` → `dish: command
 *        not found`, o 77 řádků níž syntaktická chyba a `source` SKONČIL. Všechno
 *        za tím řádkem (mj. UUID serverů) bylo pro skripty neviditelné a
 *        `coolify-story-init.sh` odmítl založit aplikaci „protože neznal server";
 *      · instance B — `source` vrátil NULU a hodnoty uřízl na první slovo.
 *    Loader chybu polykal (`2>/dev/null || true`), takže obojí vypadalo jako úspěch.
 *
 * B. HLÁŠKA MÍSTO HODNOTY. Tři klíče nesly doslovně text z `${KLIC:?…}` v compose
 *    (mj. ID a tajemství admin klienta Keycloaku). Generátor je `preservedValue`,
 *    takže se přenášely přes každý běh včetně wipe — konfigurace realmu, zakládání
 *    operátorů i JWKS sync padaly a vypadalo to na výpadek Keycloaku.
 *
 * INVARIANT: 1) co doktor zapíše, to `source` přečte doslova; 2) hláška o chybějící
 * hodnotě není hodnota; 3) neúplné načtení se NEZAMLČUJE.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { srovnejUvozovani, potrebujeUvozovky } from "../../../scripts/lib/env-hodnota.mjs";
import { hlaskyPovinnychKlicu, jeHlaskaMistoHodnoty } from "../../../scripts/lib/hlasky-z-compose.mjs";

const ROOT = process.cwd();

/** Načte soubor skutečným bashem a vrátí hodnoty klíčů + co bash řekl na stderr. */
function nactiBashem(obsah: string, klice: string[]): { hodnoty: Record<string, string>; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "trezor-"));
  const soubor = join(dir, "env");
  writeFileSync(soubor, obsah);
  const skript = `set -a; . "${soubor}"; set +a; ${klice.map((k) => `printf '%s\\t%s\\n' "${k}" "\${${k}-}"`).join("; ")}`;
  const r = spawnSync("bash", ["-c", skript], { encoding: "utf8" });
  const hodnoty: Record<string, string> = {};
  for (const radek of (r.stdout ?? "").split("\n")) {
    const [k, ...zbytek] = radek.split("\t");
    if (k) hodnoty[k] = zbytek.join("\t");
  }
  return { hodnoty, stderr: r.stderr ?? "" };
}

describe("trezor přežije source", () => {
  const kruty = {
    MNEMONIC: "churn dish wagon genre seat escape enlist mountain",
    VETA: "Potvrzení e-mailu — AISHA",
    APOSTROF: "it's a value",
    DOLAR: "cena $HOME a `date`",
    PROSTE: "bez-mezer_123",
  };

  test("negativní sonda: BEZ uvozovek se hodnoty rozpadnou nebo uříznou", () => {
    const obsah = Object.entries(kruty).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    const { hodnoty, stderr } = nactiBashem(obsah, Object.keys(kruty));
    expect(stderr, "právě tenhle šum loader polykal").not.toBe("");
    // Poškození má dvě podoby a obě se tu vidí: buď se hodnota UŘÍZNE na první
    // slovo (instance B), nebo neuzavřený apostrof `source` ABORTUJE a zbytek
    // souboru je nedostupný (instance A) — pak je hodnota rovnou prázdná.
    const poskozene = Object.entries(kruty).filter(([k, v]) => hodnoty[k] !== v).map(([k]) => k);
    expect(poskozene, "bez uvozovek se aspoň jedna hodnota nepřečte doslova").not.toEqual([]);
    expect(hodnoty.MNEMONIC === "churn" || hodnoty.MNEMONIC === "", "mnemonic se uřízne, nebo je pryč").toBe(true);
  });

  test("po srovnání uvozování přečte bash KAŽDOU hodnotu doslova", () => {
    const vstup = Object.entries(kruty).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    const { text, srovnane } = srovnejUvozovani(vstup);
    expect(srovnane.sort(), "srovnat je potřeba všechno kromě prosté hodnoty").toEqual(
      ["APOSTROF", "DOLAR", "MNEMONIC", "VETA"],
    );
    const { hodnoty, stderr } = nactiBashem(text, Object.keys(kruty));
    expect(stderr, "zdravý trezor nemá co říkat").toBe("");
    for (const [k, v] of Object.entries(kruty)) expect(hodnoty[k], `${k} se musí přečíst doslova`).toBe(v);
  });

  test("srovnání je idempotentní — druhý průchod už nic nemění", () => {
    const jednou = srovnejUvozovani(Object.entries(kruty).map(([k, v]) => `${k}=${v}`).join("\n"));
    const dvakrat = srovnejUvozovani(jednou.text);
    expect(dvakrat.srovnane).toEqual([]);
    expect(dvakrat.text).toBe(jednou.text);
  });

  test("env-doktor uvozování srovnává PŘED zápisem a hlásí, co potřebuje", () => {
    const d = readFileSync(join(ROOT, "scripts", "aisha-env-doctor.mjs"), "utf-8");
    expect(d, "apply musí srovnat uvozování").toContain("srovnejUvozovani(sesbirany)");
    expect(d, "zapisuje se srovnaný obsah").toContain("appendKeysToText(uvozeny, additions)");
    expect(d, "report musí neuvozenou hodnotu jmenovat").toContain("potrebujeUvozovky(val)");
  });

  test("loader neúplné načtení NEZAMLČÍ (chování)", () => {
    const dir = mkdtempSync(join(tmpdir(), "loader-"));
    writeFileSync(join(dir, ".env.coolify"), "A=jedno\nB=dve slova bez uvozovek\nC=po\n");
    spawnSync("mkdir", ["-p", join(dir, "scripts")]);
    writeFileSync(join(dir, "scripts", "_env-loader.sh"), readFileSync(join(ROOT, "scripts", "_env-loader.sh"), "utf-8"));
    const r = spawnSync("bash", ["-c", '. scripts/_env-loader.sh; echo POKRACOVALO'], {
      cwd: dir, encoding: "utf8", env: { ...process.env, AISHA_TIER: "production" },
    });
    expect(r.stdout ?? "", "skript nesmí pokračovat s useknutým prostředím").not.toContain("POKRACOVALO");
    expect(r.stderr ?? "", "a musí říct proč").toContain("NEÚPLNÉ");
  });
});

describe("hláška z compose není hodnota", () => {
  test("detektor pozná zkamenělou hlášku a nechá pravou hodnotu být", () => {
    const mapa = hlaskyPovinnychKlicu(ROOT);
    expect(mapa.size, "compose musí nějaké povinné klíče deklarovat").toBeGreaterThan(0);
    const [klic, hlasky] = [...mapa.entries()][0];
    const hlaska = [...hlasky][0];
    expect(jeHlaskaMistoHodnoty(klic, hlaska, mapa), `${klic}: hláška musí být nález`).toBe(true);
    expect(jeHlaskaMistoHodnoty(klic, "skutecna-hodnota", mapa), "pravá hodnota nálezem není").toBe(false);
    expect(jeHlaskaMistoHodnoty("KLIC_KTERY_NENI_V_COMPOSE", hlaska, mapa), "neznámý klíč se nehádá").toBe(false);
  });

  test("env-doktor tu kontrolu opravdu dělá", () => {
    const d = readFileSync(join(ROOT, "scripts", "aisha-env-doctor.mjs"), "utf-8");
    expect(d).toContain("hlaskyPovinnychKlicu(ROOT)");
    expect(d).toContain("jeHlaskaMistoHodnoty(key, val, hlasky)");
  });
});
