/**
 * Brána: plugin musí DORAZIT ke svému vykonavateli — a mluvit jeho jazykem.
 *
 * PROČ (naměřeno 2026-08-12 nad celou dráhou pluginu)
 * ---------------------------------------------------
 * Dráha byla postavená na obou koncích a chyběly články uprostřed:
 *
 *   plugins/<id>/src/index.ts        ✅ zdroj + testy
 *   plugin_catalog/plugin_versions   ✅ registr (8 tabulek)
 *   submit_plugin, materialize_*     ✅ RPC
 *   svc-plugin-system                ✅ stáhne, ověří SHA-256, dispatchne
 *   images/plugin-exec/shim          ✅ spustí
 *   ——— zdroj → artefakt ———         ⛔ NIKDO
 *   ——— ctx: config/plugin/tenant/schedule ——— ⛔ NIKDO
 *
 * ⭐ A obě strany mluvily JINÝM JAZYKEM, aniž to cokoli měřilo:
 *
 * 1. TVAR. Shim artefakt obaluje do `(async (ctx, action, params) => { … })`,
 *    tedy do TĚLA FUNKCE — `import`/`export` jsou tam syntaktická chyba.
 *    Pluginy jsou psané jako ESM moduly. Bez balení by artefakt spadl na
 *    prvním řádku, a to až v sandboxu — nejdál od místa vzniku chyby.
 *
 * 2. KONTRAKT ctx. Pluginy čtou `ctx.config`, `ctx.plugin`, `ctx.tenant`
 *    a `ctx.schedule`; shim dával `rpc`/`kv`/`fetch`/`llm`/`notify`/`log`.
 *    Čtyři z osmi členů neexistovaly. Konektor bez `config` nemá adresu ani
 *    přihlašovací údaje — mohl by jen selhat.
 *
 * Testy pluginů přitom procházely: měřily MAPPERY a KLIENTA, ne DORUČENÍ.
 * Táž věta jako u `knock.ts` — kód s testy, který nikdo nevolá, není ověřený.
 *
 * CO SE MĚŘÍ
 * ----------
 * Ne výskyt řetězců ve zdrojácích. Tvrzení níž SPUSTÍ build, vezmou hotový
 * artefakt a prohlédnou ho parserem `node:vm` v přesně té obálce, kterou
 * použije shim; a členy `ctx` porovnají jako MNOŽINY — co pluginy berou, musí
 * být podmnožinou toho, co shim dává.
 */
import { describe, expect, test, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import { hostOf } from "../../../scripts/plugins/host.mjs";

const ROOT = process.cwd();
const PLUGINS = join(ROOT, "plugins");
const SHIM_BROKER = join(ROOT, "images/plugin-exec/shim/src/broker.ts");
const SHIM_MAIN = join(ROOT, "images/plugin-exec/shim/src/main.ts");

/** Manifest pluginu, nebo null, když adresář pluginem není. */
function manifest(slug: string): Record<string, unknown> | null {
  const cesta = join(PLUGINS, slug, "manifest.json");
  return existsSync(cesta) ? (JSON.parse(readFileSync(cesta, "utf8")) as Record<string, unknown>) : null;
}

/** Deklaruje některý `*_spec` vstupní bod? */
function maVstup(m: Record<string, unknown>): boolean {
  return ["source_spec", "agent_spec", "provider_spec", "node_spec", "auth_spec", "tracking_spec"].some(
    (s) => typeof (m[s] as { adapter_entry?: unknown } | undefined)?.adapter_entry === "string",
  );
}

/**
 * Adaptéry brokeru (`source_spec.host: "source-broker"`) se vstupem. Do sandboxu
 * nepatří: běží v procesu `svc-source-broker` a cestují jeho obrazem. Rozhoduje
 * scripts/plugins/host.mjs — tentýž predikát, podle kterého je build přeskočí.
 */
function adapteryBrokeru(): string[] {
  return readdirSync(PLUGINS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((slug) => {
      const m = manifest(slug);
      return m !== null && maVstup(m) && hostOf(m) === "source-broker";
    });
}

/** Pluginy, které deklarují vstupní bod A patří do sandboxu — jen ty se balí. */
function pluginySVstupem(): string[] {
  return readdirSync(PLUGINS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    // An entry under plugins/ that carries no manifest is not a plugin. Reading
    // it unconditionally made an unrelated stray entry crash the whole gate
    // (measured 2026-08-16 on macOS: a Finder .DS_Store under plugins/ produced
    // ENOTDIR on plugins/.DS_Store/manifest.json, and the run reported a plugin
    // contract violation that did not exist). A gate must fail on what it
    // measures, not on what happens to sit next to it.
    .filter((d) => existsSync(join(PLUGINS, d.name, "manifest.json")))
    .filter((d) => {
      const m = JSON.parse(readFileSync(join(PLUGINS, d.name, "manifest.json"), "utf8"));
      return maVstup(m) && hostOf(m) === "sandbox";
    })
    .map((d) => d.name);
}

let vystup: string;
let artefakty: Map<string, string>;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-artefakt-"));
  vystup = execFileSync(process.execPath, ["scripts/plugins/build.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, OUT_DIR: dir },
    // Balí se i závislosti — 145 kB artefakty, tohle není okamžité.
    timeout: 180_000,
  });
  artefakty = new Map();
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".js")) artefakty.set(f.replace(/-\d+\.\d+\.\d+\.js$/, ""), readFileSync(join(dir, f), "utf8"));
  }
}, 200_000);

describe("plugin dorazí do sandboxu (brána)", () => {
  test("měřidlo má co měřit — v plugins/ je aspoň jeden plugin se vstupním bodem", () => {
    // Bez tohohle by všechna tvrzení níž byla vakuová: prázdná množina projde
    // úplně stejně jako správná.
    expect(
      pluginySVstupem().length,
      "žádný plugin nedeklaruje adapter_entry — brána ztratila předmět měření, oprav ji, NEODSTRAŇUJ ji",
    ).toBeGreaterThan(0);
  });

  test("build zabalí každý plugin, který deklaruje vstupní bod", () => {
    for (const slug of pluginySVstupem()) {
      expect(
        artefakty.has(slug),
        `plugin ${slug} deklaruje adapter_entry, ale build nevydal artefakt.\n` +
          `Výstup buildu:\n${vystup}`,
      ).toBe(true);
    }
  });

  test("adaptér brokeru se do sandboxu NEBALÍ — a build řekne proč", () => {
    // ⛔ NAMĚŘENO 2026-09-13: adaptér s čistým `pg` shodil sandboxový build
    // a publikace pak nevyrobila dist pro ŽÁDNÝ plugin. Přeskočení musí být
    // DEKLAROVANÉ a VIDITELNÉ, ne tichý výpadek z výstupu.
    // V upstreamu žádný adaptér brokeru neleží, tvrzení tam nemá co zkoumat;
    // měří ho fork, který adaptér brokeru nese. Proto žádná podmínka
    // na neprázdnost — ta patří jen měřidlu sandboxu výš.
    for (const slug of adapteryBrokeru()) {
      expect(artefakty.has(slug), `adaptér brokeru ${slug} se nesmí zabalit jako sandboxový artefakt`).toBe(false);
      expect(
        vystup,
        `build u adaptéru brokeru ${slug} neřekl, proč ho přeskočil.\nVýstup buildu:\n${vystup}`,
      ).toMatch(new RegExp(`${slug}\\s+přeskočen — host=source-broker`));
    }
  });

  test("artefakt je NAČTITELNÝ jako tělo async funkce — tak ho pouští shim", () => {
    for (const [slug, kod] of artefakty) {
      expect(() => {
        new Script(`(async (ctx, action, params) => {\n${kod}\n})`, { filename: `${slug}.js` });
      }, `artefakt pluginu ${slug} se nedá načíst v obálce shimu`).not.toThrow();
    }
  });

  test("artefakt nesahá na globály, které sandbox VYPÍNÁ", () => {
    // `createContext({ require: undefined, process: undefined, globalThis: undefined })`
    // v shimu — cokoli z toho by se projevilo až za běhu v sandboxu.
    const zakazane: Array<[RegExp, string]> = [
      [/(^|[^.\w])require\s*\(/, "require"],
      [/(^|[^.\w])process\s*\./, "process"],
      [/(^|[^.\w])globalThis\b/, "globalThis"],
    ];
    for (const [slug, kod] of artefakty) {
      for (const [vzor, jmeno] of zakazane) {
        expect(
          vzor.test(kod),
          `artefakt pluginu ${slug} sahá na \`${jmeno}\`, které sandbox vypíná — ` +
            "projevilo by se to až za běhu jako `undefined is not a function`",
        ).toBe(false);
      }
    }
  });

  test("⭐ co pluginy z ctx BEROU, musí shim DÁVAT", () => {
    // Tohle je to podstatné tvrzení. Přesně tady se ty dvě vrstvy rozešly:
    // pluginy braly osm členů, shim dával šest, a nic ty dvě množiny
    // neporovnávalo.
    const dava = new Set<string>();
    const broker = readFileSync(SHIM_BROKER, "utf8");
    const rozhrani = /export interface SandboxContext[^{]*\{([\s\S]*?)\n\}/.exec(broker);
    expect(
      rozhrani,
      "v broker.ts se nenašlo `export interface SandboxContext { … }` — brána ztratila předmět",
    ).not.toBeNull();
    for (const m of rozhrani![1].matchAll(/^\s{2}(?:\/\*\*[\s\S]*?\*\/\s*)?([a-zA-Z_$][\w$]*)\s*[?:(]/gm)) {
      dava.add(m[1]);
    }
    // Členy zděděné přes `extends` (identita) čte brána z toho rozhraní zvlášť.
    const identita = /export interface SandboxIdentity\s*\{([\s\S]*?)\n\}/.exec(broker);
    if (identita) {
      for (const m of identita[1].matchAll(/^\s{2}([a-zA-Z_$][\w$]*)\s*[?:]/gm)) dava.add(m[1]);
    }

    expect(dava.size, "z broker.ts se nepodařilo vyčíst členy ctx — měřidlo je rozbité").toBeGreaterThan(3);

    for (const slug of pluginySVstupem()) {
      const zdroje = readdirSync(join(PLUGINS, slug, "src")).filter((f) => f.endsWith(".ts"));
      const bere = new Set<string>();
      for (const f of zdroje) {
        const text = readFileSync(join(PLUGINS, slug, "src", f), "utf8");
        for (const m of text.matchAll(/\bctx\.([a-zA-Z_$][\w$]*)/g)) bere.add(m[1]);
      }
      const chybi = [...bere].filter((c) => !dava.has(c)).sort();
      expect(
        chybi,
        `plugin ${slug} čte z ctx členy, které shim neposkytuje: ${chybi.join(", ")}\n` +
          `  shim dává: ${[...dava].sort().join(", ")}\n` +
          `  plugin bere: ${[...bere].sort().join(", ")}\n` +
          "Za běhu by to bylo `undefined is not a function` uvnitř sandboxu.",
      ).toEqual([]);
    }
  });

  test("shim předává identitu a konfiguraci, které si od hostitele vyžádal", () => {
    // Bez tohohle by ctx.config existoval v typu, ale nesl prázdno — a to je
    // od chybějícího členu k nerozeznání.
    const main = readFileSync(SHIM_MAIN, "utf8");
    for (const klic of ["plugin_version", "tenant_id", "config"]) {
      expect(
        main,
        `shim nečte \`${klic}\` z PLUGIN_PAYLOAD — hodnota by do pluginu nedorazila`,
      ).toContain(klic);
    }
  });

  test("hostitel ty hodnoty do payloadu SKUTEČNĚ dává", () => {
    // Druhá strana téhož spoje. Shim může číst, co chce; když to hostitel
    // neposílá, plugin dostane prázdno.
    const runner = readFileSync(join(ROOT, "services/svc-plugin-system/src/runner-client.ts"), "utf8");
    for (const klic of ["plugin_version", "tenant_id", "config"]) {
      expect(runner, `runner-client.ts neposílá \`${klic}\` v payloadu`).toContain(klic);
    }
  });

  test("konektor je data_source, ne backend_provider", () => {
    // Enum si tu záměnu sám pojmenovává (aisha/db/sql/enums/plugin_kind.sql):
    // „A data connector … is NOT a backend_provider (that kind is LLM-shaped)".
    // Špatný druh = materializace do ai_provider_registry místo do ingest
    // páteře — plugin by se „nainstaloval" a nikdy nic nepřinesl.
    for (const slug of readdirSync(PLUGINS)) {
      const m = JSON.parse(readFileSync(join(PLUGINS, slug, "manifest.json"), "utf8"));
      if (m.kind !== "backend_provider") continue;
      const text = JSON.stringify(m).toLowerCase();
      const telematika = /telemat|fleet|vehicle|vozidl|gps|logbook|kniha jízd/.test(text);
      expect(
        telematika,
        `plugin ${slug} je deklarovaný jako backend_provider, ale popisuje se jako ` +
          "telematika/flotila. backend_provider je LLM-shaped (→ ai_provider_registry); " +
          "konektor patří pod data_source (→ agent_knowledge_sources).",
      ).toBe(false);
    }
  });

  test("manifest deklaruje závislosti, které se do artefaktu opravdu zabalí", () => {
    // Sandbox instaluje jen závislosti SHIMU. Balík, který se nezabalí, za
    // běhu prostě není — `dependencies` je tedy tvrzení o realitě.
    // Build to porovnává a při neshodě končí nenulově; tady se jen doloží,
    // že to tvrzení opravdu proběhlo.
    expect(vystup, `build neoznámil ani jeden zabalený plugin:\n${vystup}`).toMatch(/✓/);
    expect(vystup).not.toMatch(/✗/);
  });

  test("build.mjs existuje a je spustitelný z repa", () => {
    expect(
      existsSync(join(ROOT, "scripts/plugins/build.mjs")),
      "scripts/plugins/build.mjs zmizel — bez něj se plugin nikam nedostane",
    ).toBe(true);
  });
});
