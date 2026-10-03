/**
 * `real_value` z Coolify API čte JEN dekodér — nikdo jiný ho nebere za hodnotu.
 *
 * ⛔ NAMĚŘENO 2026-09-18 (guru): `real_value` je tvar proměnné pro soubor .env
 * (Coolify 4.3.16 EnvironmentVariable::realValue) — literál/multiline v `'…'`,
 * jinak escapeEnvVariables. pki-renewer ho četl jako hodnotu: base64 certifikátu
 * NetBirdu v apostrofech nedekódoval, usoudil „konzument nemá certifikát" a
 * restartoval řídicí rovinu meshe každých 6 h a při každém startu PKI (od 16. 9.
 * nejméně 25×). Stejně četly coolify-env-store (reverse-sync trezoru),
 * bootstrap-env-from-coolify, fix-empty-runtime-envs (prázdný literál `''`
 * považoval za neprázdný) a fix-buildtime-flags (apostrofy zapisoval ZPĚT jako
 * hodnotu).
 *
 * ⭐ Měří se VLASTNOST nad kódem (bez komentářů): token `real_value` se smí
 * vyskytnout jen v scripts/lib/coolify-env-hodnota.mjs a ve funkci
 * `coolify_env_hodnota` v infra/pki/pki-renewer.sh (obraz bez node). Že obě
 * dekódují správně, měří scripts/lib/coolify-env-hodnota.test.mjs týmiž vektory.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const DEKODER_JS = "scripts/lib/coolify-env-hodnota.mjs";
const RENEWER = "infra/pki/pki-renewer.sh";

const KORENY = ["scripts", "infra", "services", "apps", "src", "packages", "config"];
const PRIPONY = /\.(mjs|cjs|js|ts|tsx|sh)$/;
const VYNECH_ADRESARE = new Set(["node_modules", "dist", "build", ".next", "coverage", "__tests__"]);
const JE_TEST = /(\.test\.|\.spec\.|\/tests\/gates\/)/;

function projdi(adresar: string, out: string[]): void {
  if (!existsSync(adresar)) return;
  for (const jmeno of readdirSync(adresar)) {
    if (VYNECH_ADRESARE.has(jmeno)) continue;
    const cesta = join(adresar, jmeno);
    const st = statSync(cesta);
    if (st.isDirectory()) projdi(cesta, out);
    else if (PRIPONY.test(jmeno)) out.push(relative(ROOT, cesta));
  }
}

/** Kód bez komentářů — zmínka v komentáři není čtení. */
function bezKomentaru(soubor: string, text: string): string {
  if (soubor.endsWith(".sh")) return text.replace(/(^|\s)#.*$/gm, "$1");
  // Blokový komentář nahradí jen jeho konce řádků, ať čísla řádků ve výpisu sedí.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Tělo shellové funkce `jmeno() { … }` (do první `}` na začátku řádku). */
function teloFunkce(text: string, jmeno: string): string | null {
  const m = new RegExp(`^${jmeno}\\(\\)\\s*\\{[\\s\\S]*?^\\}`, "m").exec(text);
  return m ? m[0] : null;
}

const SOUBORY: string[] = [];
for (const k of KORENY) projdi(join(ROOT, k), SOUBORY);
const KOD = SOUBORY.filter((s) => !JE_TEST.test(`/${s}`));

describe("real_value z Coolify čte jen dekodér (brána)", () => {
  test("univerzum: měřidlo vidí kód a v něm oba dekodéry", () => {
    expect(KOD.length, "měřidlo nevidí zdrojáky").toBeGreaterThan(500);
    expect(KOD).toContain(DEKODER_JS);
    expect(KOD).toContain(RENEWER);
    expect(bezKomentaru(DEKODER_JS, readFileSync(join(ROOT, DEKODER_JS), "utf8"))).toMatch(/real_value/);
    expect(teloFunkce(readFileSync(join(ROOT, RENEWER), "utf8"), "coolify_env_hodnota"), "renewer nemá dekodér").toMatch(
      /real_value/,
    );
  });

  test("⛔ nikdo mimo dekodér nečte real_value", () => {
    const vady: string[] = [];
    for (const s of KOD) {
      if (s === DEKODER_JS) continue;
      let kod = bezKomentaru(s, readFileSync(join(ROOT, s), "utf8"));
      if (s === RENEWER) {
        const telo = teloFunkce(kod, "coolify_env_hodnota") ?? "";
        kod = kod.replace(telo, telo.replace(/[^\n]/g, ""));
      }
      kod.split("\n").forEach((radek, i) => {
        if (/real_value/.test(radek)) vady.push(`${s}:${i + 1}  ${radek.trim().slice(0, 120)}`);
      });
    }
    expect(vady, `čte real_value mimo dekodér (použij hodnotaZCoolify):\n${vady.join("\n")}`).toEqual([]);
  });

  test("⛔ renewer čte stav konzumenta přes dekodér", () => {
    const telo = teloFunkce(readFileSync(join(ROOT, RENEWER), "utf8"), "current_cert_pem");
    expect(telo, "current_cert_pem zmizel — přečti renewer znovu").not.toBeNull();
    expect(telo).toMatch(/\|\s*coolify_env_hodnota\s+"\$2"/);
  });
});
