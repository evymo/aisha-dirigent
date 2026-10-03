/**
 * Klíč, který za běhu píše pki-renewer, trezor (.env.coolify) nedeklaruje.
 *
 * ⛔ NAMĚŘENO 2026-09-19 (guru, konvergence guru9): heredoc v aisha-cold-start.sh
 * psal do trezoru `NETBIRD_INTERNAL_CERT_B64=` a `NETBIRD_INTERNAL_KEY_B64=`
 * (prázdné, s komentářem „legacy env path"). coolify-sync-envs posílá každý klíč,
 * který compose referuje a trezor MÁ — i prázdný. Konvergence tak přepsala
 * certifikát, který renewer doručil do env aisha-netbird, prázdnem; nový renewer
 * pak hlásil „consumer has NONE", doručil znovu a restartoval řídicí rovinu meshe.
 * Oprava čtení (#1018, dekodér real_value) byla jen půlka — hodnota nepřežila zápis.
 *
 * ⭐ Měří se VLASTNOST nad jediným zdrojem pravdy o vlastnictví: klíče bere brána
 * z mapy konzumentů renewera (`consumer_for` v infra/pki/pki-renewer.sh), ne ze
 * seznamu. Pro každý takový klíč platí:
 *   1. žádný zapisovatel trezoru ho nedeklaruje (heredoc/přiřazení v .sh,
 *      položka kontraktu env-doktoru, emit generátoru, preset) — klíč, který
 *      trezor nemá, sync neposílá (build_app_payload: compose ∩ trezor);
 *   2. každý compose ho referuje jen volitelně `${KLIC:-…}` — bez trezoru musí
 *      compose projít a sync ho nesmí hlásit jako MISSING.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const RENEWER = "infra/pki/pki-renewer.sh";
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Klíče, které renewer doručuje do env konzumentů (tělo `consumer_for`). */
export function klicePodleRenewera(text: string): string[] {
  const telo = /^consumer_for\(\)\s*\{[\s\S]*?^\}/m.exec(text)?.[0] ?? "";
  const klice = new Set<string>();
  for (const m of telo.matchAll(/^\s*[^#\n]*\)\s*echo\s+"([^"]*)"/gm)) {
    // "<prefix>-<app> KLIC KLIC …" — první slovo je aplikace, zbytek klíče env.
    for (const slovo of m[1].trim().split(/\s+/).slice(1)) {
      if (/^[A-Z][A-Z0-9_]+$/.test(slovo)) klice.add(slovo);
    }
  }
  return [...klice].sort();
}

/** Řádky, na kterých soubor deklaruje klíč jako položku trezoru (bez komentářů). */
export function deklaraceVTrezoru(soubor: string, text: string, klic: string): number[] {
  const vzory: RegExp[] = soubor.endsWith(".sh")
    ? [new RegExp(`^\\s*(export\\s+)?${klic}=`)]
    : [
        new RegExp(`\\[\\s*["'\`]${klic}["'\`]\\s*,`), // kontrakt env-doktoru ["KLIC", "kind", …]
        new RegExp(`\\bemit\\(\\s*["'\`]${klic}["'\`]`), // generate-secrets
        new RegExp(`^\\s*${klic}\\s*:`), // presety { KLIC: … }
      ];
  const radky: number[] = [];
  text.split("\n").forEach((radek, i) => {
    const kod = soubor.endsWith(".sh") ? radek.replace(/(^|\s)#.*$/, "$1") : radek.replace(/(^|[^:"'`\\])\/\/.*$/, "$1");
    if (vzory.some((v) => v.test(kod))) radky.push(i + 1);
  });
  return radky;
}

const VYNECH = new Set(["node_modules", "dist", "build", "coverage", "__tests__"]);
function projdi(adresar: string, out: string[]): void {
  if (!existsSync(adresar)) return;
  for (const jmeno of readdirSync(adresar)) {
    if (VYNECH.has(jmeno)) continue;
    const cesta = join(adresar, jmeno);
    if (statSync(cesta).isDirectory()) projdi(cesta, out);
    else if (/\.(sh|mjs|cjs|js|ts)$/.test(jmeno) && !/\.test\.|\.spec\./.test(jmeno)) out.push(relative(ROOT, cesta));
  }
}

describe("klíče renewera: trezor je nedeklaruje, compose je bere volitelně (brána)", () => {
  const klice = klicePodleRenewera(cti(RENEWER));
  const zapisovatele: string[] = [];
  for (const k of ["scripts", "config"]) projdi(join(ROOT, k), zapisovatele);
  const composy = readdirSync(ROOT).filter((f) => /^docker-compose.*\.ya?ml$/.test(f));

  test("univerzum: renewer doručuje do env aspoň jeden pár klíčů a měřidlo vidí zapisovatele i compose", () => {
    expect(klice.length, "z consumer_for nevyčteny žádné klíče — měřidlo je slepé").toBeGreaterThanOrEqual(2);
    expect(zapisovatele, "měřidlo nevidí zapisovatele trezoru").toContain("scripts/aisha-cold-start.sh");
    expect(zapisovatele).toContain("scripts/aisha-env-doctor.mjs");
    expect(zapisovatele).toContain("scripts/generate-secrets.mjs");
    expect(composy.length, "měřidlo nevidí compose soubory").toBeGreaterThan(20);
  });

  test("⛔ žádný zapisovatel trezoru nedeklaruje klíč, který píše renewer", () => {
    const vady: string[] = [];
    for (const soubor of zapisovatele) {
      const text = cti(soubor);
      for (const klic of klice) {
        if (!text.includes(klic)) continue;
        for (const r of deklaraceVTrezoru(soubor, text, klic)) vady.push(`${soubor}:${r} ${klic}`);
      }
    }
    expect(vady, `klíč renewera v trezoru — sync by jím přepsal doručený certifikát:\n${vady.join("\n")}`).toEqual([]);
  });

  test("⛔ compose referuje klíč renewera jen volitelně (${KLIC:-…})", () => {
    const vady: string[] = [];
    for (const f of composy) {
      const text = cti(f);
      for (const klic of klice) {
        for (const m of text.matchAll(new RegExp(`(?<!\\$)\\$\\{${klic}(:[?]|\\?|\\})`, "g"))) {
          vady.push(`${f}: ${m[0]}`);
        }
      }
    }
    expect(vady, `povinná reference na klíč, který trezor nemá:\n${vady.join("\n")}`).toEqual([]);
  });

  test("mutace: měřidlo chytí heredoc s prázdným klíčem i položku kontraktu", () => {
    const klic = klice[0];
    expect(deklaraceVTrezoru("scripts/aisha-cold-start.sh", `A=1\n${klic}=\nB=2`, klic)).toEqual([2]);
    expect(deklaraceVTrezoru("scripts/aisha-env-doctor.mjs", `  ["${klic}", "external"],`, klic)).toEqual([1]);
    expect(deklaraceVTrezoru("scripts/generate-secrets.mjs", `emit('${klic}', x);`, klic)).toEqual([1]);
    // Zmínka v komentáři deklarace není.
    expect(deklaraceVTrezoru("scripts/aisha-cold-start.sh", `# ${klic}= sem nepatří`, klic)).toEqual([]);
    expect(klicePodleRenewera(`consumer_for() {\n  case "$1" in\n    x.*) echo "\${P}-x A_KEY B_KEY" ;;\n  esac\n}`)).toEqual(["A_KEY", "B_KEY"]);
  });
});
