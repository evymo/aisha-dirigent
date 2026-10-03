/**
 * Čtenáři .env.coolify mimo `source` vrátí hodnotu STEJNĚ jako bash.
 *
 * ⛔ NAMĚŘENO 2026-09-19 (guru): env-doktor uvozoval `AISHA_OPERATORS` správně,
 * ale coolify-sync-envs (awk/sed) a config-env-files.parseEnvFile uvozovky jen
 * odřízly — do Coolify šlo `{\"email\":…}`, migrace hlásila „AISHA_OPERATORS is
 * not valid JSON" a operátoři se nikdy neprovisionovali. Referencí je skutečný
 * `bash source` nad souborem zapsaným týmž `uvozovkuj`, jako ho píše env-doktor.
 */
import { afterAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { odUvozovkuj, uvozovkuj } from "./env-hodnota.mjs";
import { parseEnvFile } from "./config-env-files.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const LIB = join(ROOT, "scripts/lib/env-soubor.sh");

const HODNOTY = {
  OPERATORI: '{"operators":[{"email":"op@instance.test","roles":["admin","staff"]}]}',
  DOLAR: "pa$$word $HOME ${NIC}",
  BACKTICK: "a `date` b",
  LOMITKA: "C:\\path\\to\\n literal \\x",
  APOSTROF: "it's fine",
  MEZERY: "víc slov s diakritikou",
  PROSTA: "jednoduche_hodnota-123",
};

const tmp = mkdtempSync(join(tmpdir(), "env-soubor-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const soubor = join(tmp, ".env.coolify");
writeFileSync(
  soubor,
  [
    "# komentář",
    ...Object.entries(HODNOTY).map(([k, v]) => `${k}=${uvozovkuj(v)}`),
    "JEDNODUCHE='doslova $HOME \\n'",
    "",
  ].join("\n"),
);
const KLICE = [...Object.keys(HODNOTY), "JEDNODUCHE"];

/** Reference: co z řádků udělá `bash source` (NUL oddělené, ať projdou i konce řádků). */
function podleBashe() {
  const r = spawnSync("bash", ["-c", `set -a; . "$1"; for k in ${KLICE.join(" ")}; do printf '%s\\0' "\${!k}"; done`, "_", soubor], {
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
  const hodnoty = r.stdout.split("\0").slice(0, KLICE.length);
  return Object.fromEntries(KLICE.map((k, i) => [k, hodnoty[i]]));
}

describe("čtení .env.coolify mimo source = bash", () => {
  const bash = podleBashe();

  test("reference sedí s původními hodnotami (soubor je zapsaný správně)", () => {
    for (const [k, v] of Object.entries(HODNOTY)) expect(bash[k], k).toBe(v);
    expect(JSON.parse(bash.OPERATORI).operators[0].roles).toEqual(["admin", "staff"]);
  });

  test("⛔ JS parseEnvFile vrátí totéž co bash (AISHA_OPERATORS je platný JSON)", () => {
    // keepTemplates: `${NIC}` je tu DOSLOVNÝ text (escapovaný `$`), ne nerozvinutá šablona.
    const js = parseEnvFile(soubor, { keepTemplates: true });
    for (const k of KLICE) expect(js[k], k).toBe(bash[k]);
  });

  test("⛔ shell parse_env_soubor (coolify-sync-envs) vrátí totéž co bash", () => {
    const r = spawnSync("bash", ["-c", `. "$1"; parse_env_soubor "$2"`, "_", LIB, soubor], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const tsv = Object.fromEntries(r.stdout.trimEnd().split("\n").map((l) => [l.slice(0, l.indexOf("\t")), l.slice(l.indexOf("\t") + 1)]));
    for (const k of KLICE) expect(tsv[k], k).toBe(bash[k]);
  });

  test("shell read_env_key vrátí totéž co bash; chybějící klíč je prázdno", () => {
    for (const k of [...KLICE, "NENI"]) {
      const r = spawnSync("bash", ["-c", `set -euo pipefail; . "$1"; read_env_key "$2" "$3"`, "_", LIB, k, soubor], { encoding: "utf8" });
      expect(r.status, `${k}: ${r.stderr}`).toBe(0);
      expect(r.stdout.replace(/\n$/, ""), k).toBe(bash[k] ?? "");
    }
  });

  test("odUvozovkuj je inverze uvozovkuj", () => {
    for (const v of Object.values(HODNOTY)) expect(odUvozovkuj(uvozovkuj(v))).toBe(v);
  });
});
