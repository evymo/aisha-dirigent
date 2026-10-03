/**
 * Dekodér `real_value` z Coolify: JS knihovna i shellové zrcadlo v pki-renewer
 * vrátí PŮVODNÍ hodnotu pro každý tvar, jaký Coolify vyrobí.
 *
 * ⛔ NAMĚŘENO 2026-09-18 (guru): renewer bral `real_value` literálu (`'LS0t…='`)
 * jako hodnotu, `base64 -d` na apostrofu selhal a NetBird se restartoval každých
 * 6 h. Vektory tu vyrábí PORT `EnvironmentVariable::realValue` + `escapeEnvVariables`
 * z Coolify 4.3.16 — test tedy měří inverzi skutečného vykreslení, ne odhad.
 */
import { afterAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hodnotaZCoolify } from "./coolify-env-hodnota.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const RENEWER = join(ROOT, "infra/pki/pki-renewer.sh");

/** Port Coolify 4.3.16 escapeEnvVariables (str_replace s poli = postupně). */
function escapeEnvVariables(v) {
  const hledej = ["\\", "\r", "\t", "\0", '"', "'"];
  const nahrad = ["\\\\", "\\r", "\\t", "\\0", '\\"', "\\'"];
  return hledej.reduce((s, h, i) => s.split(h).join(nahrad[i]), v);
}

/** Port PHP json_validate(). */
function jePlatnyJson(s) {
  try {
    return JSON.parse(s) !== undefined;
  } catch {
    return false;
  }
}

/** Port Coolify 4.3.16 EnvironmentVariable::realValue (bez sdílených proměnných). */
function vykresli(value, { literal = false, multiline = false } = {}) {
  if ((value.startsWith("{") || value.startsWith("[")) && jePlatnyJson(value)) return value;
  return literal || multiline ? `'${value}'` : escapeEnvVariables(value);
}

const HODNOTY = {
  CERT_B64: "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJ=",
  PEM: "-----BEGIN CERTIFICATE-----\nMIIB\nabc\n-----END CERTIFICATE-----\n",
  APOSTROF: "it's a 'quoted' value",
  UVOZOVKY: 'say "hi"',
  LOMITKA: "C:\\path\\to\\n\\r literal",
  RIDICI: "a\rb\tc\0d",
  DOLAR: "pa$$word$VAR${X}",
  JSON_OBJ: '{"a":1,"b":["x","y"]}',
  JSON_POLE: '["a","b"]',
  NE_JSON: "{not json",
  CESKY: "Příliš žluťoučký kůň",
  PRAZDNA: "",
};
const PRIZNAKY = [
  { jmeno: "plain", literal: false, multiline: false },
  { jmeno: "literal", literal: true, multiline: false },
  { jmeno: "multiline", literal: false, multiline: true },
];

/** Záznamy tak, jak je vrací /applications/<uuid>/envs: preview řádek PŘED produkčním. */
function odpovedApi() {
  const zaznamy = [];
  for (const [nazev, value] of Object.entries(HODNOTY)) {
    for (const p of PRIZNAKY) {
      const key = `${nazev}_${p.jmeno}`.toUpperCase();
      zaznamy.push({ key, value: "", real_value: "", is_preview: true, is_literal: p.literal, is_multiline: p.multiline });
      zaznamy.push({
        key,
        value,
        real_value: value === "" ? "" : vykresli(value, p),
        is_preview: false,
        is_literal: p.literal,
        is_multiline: p.multiline,
      });
    }
  }
  return zaznamy;
}

const tmp = mkdtempSync(join(tmpdir(), "coolify-env-hodnota-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("dekodér real_value z Coolify", () => {
  const zaznamy = odpovedApi();
  const produkcni = zaznamy.filter((e) => !e.is_preview);

  test("⛔ literál: real_value je hodnota v apostrofech — dekodér vrátí hodnotu bez nich", () => {
    const e = produkcni.find((z) => z.key === "CERT_B64_LITERAL");
    expect(e.real_value).toBe(`'${HODNOTY.CERT_B64}'`);
    expect(hodnotaZCoolify(e)).toBe(HODNOTY.CERT_B64);
  });

  test("JS: každá hodnota × každý příznak se vrátí beze změny", () => {
    const vady = produkcni
      .filter((e) => hodnotaZCoolify(e) !== e.value)
      .map((e) => `${e.key}: ${JSON.stringify(hodnotaZCoolify(e))} ≠ ${JSON.stringify(e.value)}`);
    expect(vady, vady.join("\n")).toEqual([]);
  });

  test("JS: prázdné real_value spadne na value (Coolify dřív maskoval jedno z nich)", () => {
    expect(hodnotaZCoolify({ real_value: "", value: "x" })).toBe("x");
    expect(hodnotaZCoolify({ real_value: null, value: "y" })).toBe("y");
    expect(hodnotaZCoolify({})).toBe("");
  });

  test("⛔ shell (pki-renewer coolify_env_hodnota): tytéž vektory, jen produkční řádek", () => {
    const vstup = join(tmp, "envs.json");
    writeFileSync(vstup, JSON.stringify(zaznamy));
    const vystup = join(tmp, "out");
    mkdirSync(vystup, { recursive: true });
    const klice = [...new Set(zaznamy.map((e) => e.key))];
    const harness = join(tmp, "harness.sh");
    writeFileSync(
      harness,
      `#!/bin/sh
export KEYCLOAK_URL=http://kc.invalid KEYCLOAK_REALM=test COOLIFY_API=http://coolify.invalid/api/v1
export COOLIFY_API_TOKEN=stub RENEW_SERVICES=x PKI_ISSUER_CLIENT_SECRET=stub PKI_CERTS_DIR="${tmp}" APP_NAME_PREFIX=aisha
PKI_RENEWER_LIB_ONLY=1 . "${RENEWER}"
set +e
for k in ${klice.join(" ")}; do
  coolify_env_hodnota "$k" < "${vstup}" > "${vystup}/$k"
done
echo HOTOVO
`,
      { mode: 0o755 },
    );
    const r = spawnSync("sh", [harness], { encoding: "utf8", timeout: 30_000 });
    expect(r.stdout, r.stderr).toContain("HOTOVO");
    const vady = produkcni
      .map((e) => ({ e, dostal: readFileSync(join(vystup, e.key)) }))
      // jq -r přidá za hodnotu jeden konec řádku
      .filter(({ e, dostal }) => !dostal.equals(Buffer.from(`${e.value}\n`, "utf8")))
      .map(({ e, dostal }) => `${e.key}: ${JSON.stringify(dostal.toString("utf8"))}`);
    expect(vady, vady.join("\n")).toEqual([]);
  });
});
