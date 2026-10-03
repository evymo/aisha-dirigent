/**
 * domeny-rozbal — config/domains.env se rozbaluje STEJNĚ jako `set -a; . domains.env`.
 *
 * ⛔ NAMĚŘENO 2026-09-24 (<fork>): env-doktor puštěný samostatně zapsal do
 *    trezoru doslovné `STORAGE_PUBLIC_URL=https://${API_DOMAIN_PUBLIC:-}/storage/v1`
 *    a `WEB_PUSH_VAPID_SUBJECT=https://${APP_DOMAIN:-}`. Starý rozbalovač u
 *    sebeodkazu `X=${X:-}` vrátil syrovou šablonu téhož klíče; nad čistým trezorem
 *    tak vzniklo 42 hodnot s `${`. coolify-sync-envs je nerozbaluje, do Coolify by
 *    odešly doslovně.
 *
 * Měří se proto VLASTNOST: nad skutečným config/domains.env dá modul totéž co
 * skutečný bash — kromě jediné záměrné odchylky: složenina, které z VÝSLOVNĚ
 * volitelné domény zbyde URL bez hostitele, je prázdno (shell by vydal `https://`).
 * K tomu pravidla, na kterých se dohodl upstream (rozhoduje výslovná deklarace):
 *   `${X:-}` bez hodnoty → prázdno BEZ chyby; `${X}` bez hodnoty → NEROZBALITELNÉ.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  ODKAZ_MAX_HLOUBKA, bezUrlBezHostu, maUrlBezHostu, nesmiDoTrezoru, rozbalDomainsEnv, rozbalHodnotu,
} from "./domeny-rozbal.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOMAINS_ENV = readFileSync(path.join(ROOT, "config/domains.env"), "utf8");

const zProstredi = (env) => (n) => env[n] ?? "";
const rozbal = (text, env = {}) => rozbalDomainsEnv(text, zProstredi(env));

// Prostředí, jaké cold-start nastaví derivací (derive-domains --shell) před domains.env.
const DERIVACE = {
  APP_NAME_PREFIX: "zkouska", PUBLIC_TLD: "zkouska.test", INTERNAL_TLD: "internal.test",
  MESH_TLD: "mesh.test", APP_DOMAIN: "web.zkouska.test", API_DOMAIN_PUBLIC: "api.zkouska.test",
  API_DOMAIN: "zkouska-api.internal.test", AUTH_DOMAIN_PUBLIC: "auth.zkouska.test",
  KEYCLOAK_DOMAIN: "zkouska-auth.internal.test",
};

const docasne = [];
afterAll(() => { for (const d of docasne) rmSync(d, { recursive: true, force: true }); });

/** Skutečný bash: `set -a; . prostředí; . domains.env; env` — reference, ne model. */
function bashRozbal(text, env) {
  const dir = mkdtempSync(path.join(tmpdir(), "domeny-rozbal-"));
  docasne.push(dir);
  const soubor = path.join(dir, "domains.env");
  writeFileSync(soubor, text);
  const r = spawnSync("bash", ["--noprofile", "--norc", "-c", `set -a; . "${soubor}"; set +a; env`], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
  });
  if (r.status !== 0) throw new Error(`bash nedoběhl (${r.status}): ${r.stderr}`);
  const out = {};
  for (const l of r.stdout.split("\n")) { const i = l.indexOf("="); if (i > 0) out[l.slice(0, i)] = l.slice(i + 1); }
  return out;
}

describe("kontrolní vzorek — test nesmí projít naprázdno", () => {
  it("config/domains.env nese složeniny i sebeodkazy, které se mají rozbalit", () => {
    const radky = DOMAINS_ENV.split("\n").filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l));
    const slozeniny = radky.filter((l) => /\$\{/.test(l.slice(l.indexOf("=") + 1)));
    const sebeodkazy = radky.filter((l) => /^([A-Z_][A-Z0-9_]*)=\$\{\1:-/.test(l));
    expect(slozeniny.length, "žádná složenina — vlastnost by se měřila nad ničím").toBeGreaterThanOrEqual(2);
    expect(sebeodkazy.length, "žádný sebeodkaz X=${X:-} — právě ten nesl vadu").toBeGreaterThanOrEqual(2);
  });
});

describe("VLASTNOST: modul = skutečný bash nad config/domains.env", () => {
  for (const [nazev, env] of [
    ["derivace bez volitelných služeb", DERIVACE],
    ["derivace + OPENCLAW_URL (větev ořezání vzorem)", { ...DERIVACE, OPENCLAW_URL: "http://zkouska-openclaw:5210" }],
  ]) {
    it(nazev, () => {
      const r = rozbal(DOMAINS_ENV, env);
      const shell = bashRozbal(DOMAINS_ENV, env);
      const odchylky = Object.entries(r.hodnoty)
        .filter(([k, v]) => v !== (shell[k] ?? "") && v !== bezUrlBezHostu(shell[k] ?? ""))
        .map(([k, v]) => `${k}: modul „${v}" ≠ bash „${shell[k] ?? ""}"`);
      expect(odchylky, odchylky.join("\n")).toEqual([]);
      expect(Object.keys(r.hodnoty).length).toBeGreaterThan(20);
      expect(Object.entries(r.hodnoty).filter(([, v]) => v.includes("${")).map(([k]) => k)).toEqual([]);
      expect(Object.entries(r.hodnoty).filter(([, v]) => maUrlBezHostu(v)).map(([k]) => k)).toEqual([]);
      expect([...r.nerozbalene.keys()], "domains.env nesmí mít nerozbalitelný odkaz").toEqual([]);
      expect(r.odkazyDopredu, "odkaz dopředu vidí v shellu prostředí, ne ten řádek").toEqual([]);
    });
  }

  it("kanárci z instance <fork> (2026-09-24) vyjdou rozbalení", () => {
    const { hodnoty } = rozbal(DOMAINS_ENV, DERIVACE);
    expect(hodnoty.STORAGE_PUBLIC_URL).toBe("https://api.zkouska.test/storage/v1");
    expect(hodnoty.APP_DOMAIN).toBe("web.zkouska.test");
  });
});

describe("rozhoduje VÝSLOVNÁ deklarace, ne „hodnota chybí“", () => {
  it("`${X:-}` bez hodnoty → prázdno bez chyby; `${X}` bez hodnoty → nerozbalitelné", () => {
    const r = rozbal("VOLITELNA=${VOLITELNA:-}\nPOVINNA=${NIKDE}\n");
    expect(r.hodnoty.VOLITELNA).toBe("");
    expect(r.volitelnePrazdne.has("VOLITELNA")).toBe(true);
    expect(r.nerozbalene.has("VOLITELNA")).toBe(false);
    expect(r.nerozbalene.get("POVINNA")).toEqual(["NIKDE"]);
    expect(r.hodnoty.POVINNA).toBe("");
  });

  it("`${X:?}` bez hodnoty je nerozbalitelné", () => {
    expect(rozbal("A=${X:?chybí}\n").nerozbalene.get("A")).toEqual(["X"]);
  });

  it("prosté `X=` je deklarované prázdno; `${X}` na něj NENÍ chyba", () => {
    const r = rozbal("X=\nY=${X}\n");
    expect(r.nerozbalene.size).toBe(0);
    expect(r.hodnoty.Y).toBe("");
  });

  it("složenina z volitelně prázdné domény je PRÁZDNO, ne `https://` — a v seznamu zmizí jen ta položka", () => {
    const r = rozbal("D=${D:-}\nURL=https://${D}\nSEZNAM=https://${A},https://${D}\n", { A: "a.test" });
    expect(r.hodnoty.URL).toBe("");
    expect(r.volitelnePrazdne.has("URL")).toBe(true);
    expect(r.hodnoty.SEZNAM).toBe("https://a.test");
  });

  it("závislost na NEROZBALITELNÉM klíči je taky nerozbalitelná", () => {
    const r = rozbal("A=${NIKDE}\nB=https://${A}\n");
    expect([...r.nerozbalene.keys()].sort()).toEqual(["A", "B"]);
  });
});

describe("pravidla shellu", () => {
  it("sebeodkaz `X=${X:-}` čte PROSTŘEDÍ — nikdy syrovou šablonu (jádro vady z 2026-09-24)", () => {
    const text = "API_DOMAIN_PUBLIC=${API_DOMAIN_PUBLIC:-}\nSTORAGE_PUBLIC_URL=https://${API_DOMAIN_PUBLIC}/storage/v1\n";
    expect(rozbal(text, { API_DOMAIN_PUBLIC: "api.x" }).hodnoty.STORAGE_PUBLIC_URL).toBe("https://api.x/storage/v1");
    const bez = rozbal(text).hodnoty.STORAGE_PUBLIC_URL;
    expect(bez).toBe("");
    expect(bez).not.toContain("${");
  });

  it("vnořená výchozí `${A:-https://${B}}` se rozbalí celá", () => {
    expect(rozbal("U=${U:-https://${B}}\n", { B: "b.test" }).hodnoty.U).toBe("https://b.test");
    expect(rozbal("U=${U:-https://${B}}\n", { U: "https://jina.test", B: "b.test" }).hodnoty.U).toBe("https://jina.test");
  });

  it("`${X:+w}` připojí jen když X má hodnotu", () => {
    const text = "L=a${S:+,${S}}\n";
    expect(rozbal(text).hodnoty.L).toBe("a");
    expect(rozbal(text, { S: "b" }).hodnoty.L).toBe("a,b");
  });

  it("ořezání vzorem `#` `##` `%` `%%` jako shell", () => {
    const env = { U: "http://h.test:5210/x:y" };
    const r = rozbal("A=${U#*://}\nB=${U##*/}\nC=${U%:*}\nD=${U%%:*}\n", env);
    const shell = bashRozbal("A=${U#*://}\nB=${U##*/}\nC=${U%:*}\nD=${U%%:*}\n", env);
    for (const k of ["A", "B", "C", "D"]) expect(r.hodnoty[k], k).toBe(shell[k]);
  });

  it("odkaz dopředu vidí prostředí (jako shell) a je zaznamenán", () => {
    const r = rozbal("A=x${B}\nB=y\n", { B: "z" });
    expect(r.hodnoty.A).toBe("xz");
    expect(r.odkazyDopredu).toEqual(["A → B"]);
  });

  it(`přetečení hloubky (${ODKAZ_MAX_HLOUBKA}) je nerozbalitelné, ne smyčka`, () => {
    let text = "";
    for (let i = 0; i <= ODKAZ_MAX_HLOUBKA + 1; i++) text += "${X" + i + ":-";
    text += "konec" + "}".repeat(ODKAZ_MAX_HLOUBKA + 2);
    const r = rozbalHodnotu(text, () => null);
    expect(r.chybi.some((c) => c.includes("přetečení hloubky"))).toBe(true);
    expect(r.hodnota).not.toContain("${");
  });

  it("neuzavřená závorka je nerozbalitelná", () => {
    expect(rozbal("A=${B:-c\n").nerozbalene.has("A")).toBe(true);
  });
});

describe("stráž zápisu nesmiDoTrezoru — jediný domov rozhodnutí „nezapsat“", () => {
  it("jmenuje doslovný odkaz i URL bez hostitele (vzorek `https:///storage/v1`)", () => {
    for (const v of [
      "https://${APP_DOMAIN:-}", "${X}", "https:///storage/v1", "https://", "https:///realms/zkouska",
      "https://web.zkouska.test,https://", "http://",
    ]) expect(nesmiDoTrezoru(v), v).toBe(true);
  });
  it("pustí hodnotu s hostitelem i hodnoty, které URL nejsou", () => {
    for (const v of [
      "https://api.zkouska.test/storage/v1", "https://web.zkouska.test", "mailto:ops@zkouska.test",
      "postgresql://u:p@zkouska-db:5432/postgres", "http://zkouska-svc:3011", "", "abc/def+ghi==", "18190",
    ]) expect(nesmiDoTrezoru(v), v).toBe(false);
  });
  it("syrový řádek se vrací v `sablony` (volající ho předá stráži u nerozbalitelného klíče)", () => {
    const r = rozbal("A=https://${CHYBI}\n");
    expect(r.nerozbalene.get("A")).toEqual(["CHYBI"]);
    expect(r.sablony.A).toBe("https://${CHYBI}");
    expect(nesmiDoTrezoru(r.sablony.A)).toBe(true);
  });
});
