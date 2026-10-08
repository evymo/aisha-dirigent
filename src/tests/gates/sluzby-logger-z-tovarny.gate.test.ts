/**
 * Každý logger služby vzniká z továrny `safeLoggerOptions` (@aisha/security).
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * V services/ (brána = services/gateway) platí pro produkční zdroj:
 *   · `Fastify({...})` má `logger: safeLoggerOptions(...)`, nebo `logger: false`,
 *     nebo `loggerInstance: <x>`, kde `x` je v témže souboru vyrobené `pino(...)`;
 *   · `pino(...)` dostává jako první argument `safeLoggerOptions(...)`;
 *   · `safeLoggerOptions` je dovezená z `@aisha/security` (ne stejnojmenná
 *     domácí funkce);
 *   · na fastify/pino se odkazuje jen voláním (alias, argument, re-export = nález);
 *   · `.child(` je nález: vazby dítěte pino zapisuje mimo hook i formatter
 *     továrny (formatter vazeb pro dítě resetuje). Dnes 0 výskytů.
 * Volání, které brána nepřečte (volby v proměnné, `require('fastify')`, dovoz
 * jmenným prostorem), je NÁLEZ, ne „asi dobře" — co měřidlo nevidí, neprošlo.
 *
 * ── PROČ (nezávislá revize 2026-10-05) ────────────────────────────────────────
 * Žádná služba neměla serializery. Fastify zapisuje každý požadavek jako
 * `{ req }` se syrovou URL i s dotazem, takže ws-gateway dávala do logu
 * `/ws?token=<JWT>` při každém připojení; chyby šly ven se vším, co na nich
 * viselo, a 404 opisuje URL přímo do zprávy. Pět míst bylo vidět, třída je
 * „logger mimo bezpečný tvar". Továrna ten tvar drží na jednom místě
 * (serializery `req` a `err` + redakce zpráv); tahle brána drží, že ho nikdo
 * neobejde.
 *
 * ── RÁČNA ─────────────────────────────────────────────────────────────────────
 * `VYJIMKY` smí jen ubývat: řádek s důvodem pro soubor, který z továrny
 * výslovně nemůže. Výjimka bez nálezu (soubor už je v pořádku) je červená —
 * zbytek se maže, neodkládá. Dnes je seznam prázdný.
 *
 * ── UNIVERZUM ────────────────────────────────────────────────────────────────
 * Služby, které deklaruje repozitář (lib/tracked-services — zbytek po smazané
 * službě na disku se nepočítá), a v nich CELÝ strom kromě dist/node_modules
 * a testů. Netrackovaný soubor uvnitř služby se kontroluje taky: přísnější, ne
 * slepější. Bez vlastního podprocesu (lehká dráha, drahy-bran-manifest).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { isTrackedService } from "./lib/tracked-services";
import { safeLoggerOptions } from "../../../packages/security/src/logOptions";

const ROOT = process.cwd();

/** soubor → důvod. Smí jen ubývat (viz RÁČNA). */
const VYJIMKY: Readonly<Record<string, string>> = {};

const ZDROJ_TOVARNY = new Set(["@aisha/security", "@aisha/security/log-options"]);
/** Moduly, jejichž volání brána sleduje. Map, ne objekt: `sledovane['constructor']` by byl pravdivý. */
const SLEDOVANE: ReadonlyMap<string, "fastify" | "pino"> = new Map([
  ["fastify", "fastify"],
  ["pino", "pino"],
]);
const SLUZBY = path.join(ROOT, "services");
const JE_KOD = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const NENI_PRODUKCE = /(^|\/)(__tests__|__mocks__|tests|test|e2e|dist|node_modules)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;

export interface Nalez {
  soubor: string;
  radek: number;
  co: string;
}

interface Vazby {
  fastify: Set<string>;
  pino: Set<string>;
  tovarna: Set<string>;
  nalezy: Nalez[];
}

function radek(sf: ts.SourceFile, uzel: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(uzel.getStart(sf)).line + 1;
}

function bezObalu(v: ts.Expression): ts.Expression {
  let e = v;
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) {
    e = e.expression;
  }
  return e;
}

/** Jména, pod kterými soubor vidí fastify, pino a továrnu — podle dovozu, ne podle jména. */
function vazby(sf: ts.SourceFile, soubor: string): Vazby {
  const v: Vazby = { fastify: new Set(), pino: new Set(), tovarna: new Set(), nalezy: [] };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const odkud = st.moduleSpecifier.text;
      const klauzule = st.importClause;
      if (!klauzule || klauzule.isTypeOnly) continue;
      const druh = SLEDOVANE.get(odkud);
      if (druh) {
        if (klauzule.name) v[druh].add(klauzule.name.text);
        const pojmenovane = klauzule.namedBindings;
        if (pojmenovane && ts.isNamespaceImport(pojmenovane)) {
          v.nalezy.push({ soubor, radek: radek(sf, st), co: `dovoz '${odkud}' jmenným prostorem — brána volání nepřečte` });
        } else if (pojmenovane) {
          for (const p of pojmenovane.elements) {
            if (p.isTypeOnly) continue;
            const puvodni = (p.propertyName ?? p.name).text;
            if (puvodni === druh || puvodni === "default") v[druh].add(p.name.text);
          }
        }
      }
      if (ZDROJ_TOVARNY.has(odkud) && klauzule.namedBindings && ts.isNamedImports(klauzule.namedBindings)) {
        for (const p of klauzule.namedBindings.elements) {
          if ((p.propertyName ?? p.name).text === "safeLoggerOptions") v.tovarna.add(p.name.text);
        }
      }
    }
  }
  // require('fastify') / require('pino') / import('fastify') — tvar, který brána nečte.
  const projdi = (u: ts.Node): void => {
    if (ts.isCallExpression(u) && u.arguments.length > 0 && ts.isStringLiteral(u.arguments[0])) {
      const jeRequire = ts.isIdentifier(u.expression) && u.expression.text === "require";
      const jeImport = u.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((jeRequire || jeImport) && SLEDOVANE.has(u.arguments[0].text)) {
        v.nalezy.push({ soubor, radek: radek(sf, u), co: `${jeRequire ? "require" : "import()"}('${u.arguments[0].text}') — brána volání nepřečte` });
      }
    }
    if (ts.isIdentifier(u) && (v.fastify.has(u.text) || v.pino.has(u.text))) {
      const co = odkazMimoVolani(u);
      if (co) v.nalezy.push({ soubor, radek: radek(sf, u), co: `${u.text}: ${co} — brána tvorbu loggeru přes alias nevidí` });
    }
    ts.forEachChild(u, projdi);
  };
  projdi(sf);
  return v;
}

/** Vlastnosti fastify/pino, které vracejí tutéž továrnu jiným jménem. */
const TOVARNA_JINYM_JMENEM = new Set(["default", "fastify", "pino"]);

/**
 * Odkaz na fastify/pino, který NENÍ přímé volání — alias (`const F2 = Fastify`),
 * předání jako argument, re-export, `new`. Brána sleduje jen volání vazby z
 * dovozu; cokoli jiného by logger vyrobilo mimo její zrak, proto je to nález.
 * Vrací popis nálezu, nebo null pro odkaz, který brána čte (volání, dovoz,
 * typová pozice, `pino.destination(…)` a podobné vlastnosti).
 */
function odkazMimoVolani(id: ts.Identifier): string | null {
  const rodic = id.parent;
  if (ts.isImportClause(rodic) || ts.isImportSpecifier(rodic) || ts.isNamespaceImport(rodic)) return null;
  for (let a: ts.Node | undefined = rodic; a; a = a.parent) {
    if (ts.isTypeNode(a)) return null;
  }
  if (ts.isCallExpression(rodic) && rodic.expression === id) return null;
  if (ts.isPropertyAccessExpression(rodic)) {
    if (rodic.name === id) return null;
    return TOVARNA_JINYM_JMENEM.has(rodic.name.text) ? `vlastnost .${rodic.name.text} je tatáž továrna` : null;
  }
  // Jméno vlastnosti nebo deklarace (`{ pino: 1 }`, `function f(pino)`), ne odkaz na vazbu.
  if ((ts.isPropertyAssignment(rodic) || ts.isMethodDeclaration(rodic) || ts.isPropertyDeclaration(rodic)) && rodic.name === id) return null;
  if ((ts.isVariableDeclaration(rodic) || ts.isParameter(rodic) || ts.isBindingElement(rodic) || ts.isFunctionDeclaration(rodic)) && rodic.name === id) {
    return "jméno vazby překryté deklarací";
  }
  if (ts.isNewExpression(rodic)) return "new — tvar, který brána nečte";
  if (ts.isExportSpecifier(rodic)) return "re-export";
  return "odkaz mimo přímé volání (alias, argument, hodnota)";
}

function jeVolaniTovarny(e: ts.Expression | undefined, v: Vazby): boolean {
  if (!e) return false;
  const x = bezObalu(e);
  return ts.isCallExpression(x) && ts.isIdentifier(x.expression) && v.tovarna.has(x.expression.text);
}

/** Proměnné v souboru, jejichž hodnota je volání pino(...) — kandidáti pro loggerInstance. */
function pinoPromenne(sf: ts.SourceFile, v: Vazby): Set<string> {
  const out = new Set<string>();
  const projdi = (u: ts.Node): void => {
    if (ts.isVariableDeclaration(u) && ts.isIdentifier(u.name) && u.initializer) {
      const x = bezObalu(u.initializer);
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && v.pino.has(x.expression.text)) out.add(u.name.text);
    }
    ts.forEachChild(u, projdi);
  };
  projdi(sf);
  return out;
}

function vlastnost(obj: ts.ObjectLiteralExpression, jmeno: string): ts.ObjectLiteralElementLike | undefined {
  return obj.properties.find((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === jmeno);
}

export interface Rozbor {
  nalezy: Nalez[];
  /** Kolik volání fastify/pino měřidlo vidělo — aby prázdný výsledek nebyl slepota. */
  volaniFastify: number;
  volaniPino: number;
}

/**
 * Soubor, který nemá 'fastify' ani 'pino' jako řetězec, žádný z nich dovézt
 * neumí (dovoz i require berou název modulu jako literál), a bez `.child(`
 * nemá ani vazby dítěte — parsovat ho netřeba.
 */
const MUZE_DOVEZT = /[`'"](fastify|pino)[`'"]|\.child\s*\(/;

/** Rozbor jednoho zdroje — prázdné `nalezy` = soubor drží pravidlo. */
export function rozbor(soubor: string, zdroj: string): Rozbor {
  if (!MUZE_DOVEZT.test(zdroj)) return { nalezy: [], volaniFastify: 0, volaniPino: 0 };
  const sf = ts.createSourceFile(soubor, zdroj, ts.ScriptTarget.Latest, true, soubor.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const v = vazby(sf, soubor);
  const nalezy = [...v.nalezy];
  const instance = pinoPromenne(sf, v);
  const nalez = (u: ts.Node, co: string): void => {
    nalezy.push({ soubor, radek: radek(sf, u), co });
  };
  let volaniFastify = 0;
  let volaniPino = 0;

  const projdi = (u: ts.Node): void => {
    if (ts.isCallExpression(u) && ts.isPropertyAccessExpression(u.expression) && u.expression.name.text === "child") {
      nalez(u, ".child(…) — vazby dítěte jdou do logu mimo továrnu; zapiš je do objektu volání");
    }
    if (ts.isCallExpression(u) && ts.isIdentifier(u.expression)) {
      const jmeno = u.expression.text;
      if (v.pino.has(jmeno)) {
        volaniPino += 1;
        if (!jeVolaniTovarny(u.arguments[0], v)) nalez(u, `${jmeno}(…) bez safeLoggerOptions(…) jako první argument`);
      }
      if (v.fastify.has(jmeno)) {
        volaniFastify += 1;
        const arg = u.arguments[0] ? bezObalu(u.arguments[0]) : undefined;
        if (!arg) {
          nalez(u, `${jmeno}() bez voleb — napiš logger: safeLoggerOptions(…) (nebo výslovně logger: false)`);
        } else if (!ts.isObjectLiteralExpression(arg)) {
          nalez(u, `${jmeno}(<volby v proměnné>) — brána logger nevidí; volby piš doslovně`);
        } else {
          const logger = vlastnost(arg, "logger");
          const loggerInstance = vlastnost(arg, "loggerInstance");
          if (logger && loggerInstance) nalez(u, `${jmeno}: logger i loggerInstance zároveň`);
          if (logger) {
            const hodnota = ts.isPropertyAssignment(logger) ? bezObalu(logger.initializer) : undefined;
            const jeVypnuty = hodnota !== undefined && hodnota.kind === ts.SyntaxKind.FalseKeyword;
            if (!jeVypnuty && !jeVolaniTovarny(hodnota, v)) nalez(logger, `${jmeno}: logger mimo safeLoggerOptions(…) — bez serializerů req/err`);
          } else if (loggerInstance) {
            const hodnota = ts.isPropertyAssignment(loggerInstance)
              ? bezObalu(loggerInstance.initializer)
              : ts.isShorthandPropertyAssignment(loggerInstance)
                ? loggerInstance.name
                : undefined;
            const jePino = hodnota !== undefined && ts.isIdentifier(hodnota) && instance.has(hodnota.text);
            if (!jePino) nalez(loggerInstance, `${jmeno}: loggerInstance není pino(…) z tohoto souboru — brána jeho tvorbu nevidí`);
          } else {
            nalez(u, `${jmeno}({…}) bez logger — napiš logger: safeLoggerOptions(…) (nebo výslovně logger: false)`);
          }
        }
      }
    }
    ts.forEachChild(u, projdi);
  };
  projdi(sf);
  return { nalezy, volaniFastify, volaniPino };
}

export function nalezyVeZdroji(soubor: string, zdroj: string): Nalez[] {
  return rozbor(soubor, zdroj).nalezy;
}

function produkcniSoubory(): string[] {
  const out: string[] = [];
  const projdi = (adresar: string): void => {
    for (const polozka of readdirSync(adresar, { withFileTypes: true })) {
      const cesta = path.join(adresar, polozka.name);
      const rel = path.relative(ROOT, cesta).split(path.sep).join("/");
      if (polozka.isDirectory()) {
        if (!NENI_PRODUKCE.test(`${rel}/`)) projdi(cesta);
      } else if (polozka.isFile() && JE_KOD.test(rel) && !NENI_PRODUKCE.test(rel)) {
        out.push(rel);
      }
    }
  };
  for (const sluzba of readdirSync(SLUZBY, { withFileTypes: true })) {
    if (sluzba.isDirectory() && isTrackedService(sluzba.name)) projdi(path.join(SLUZBY, sluzba.name));
  }
  return out.sort();
}

/** Měřidlo vlastnosti továrny: chrání req serializer URL s tajemstvím, a nechá neškodný parametr? */
function serializerChraniUrl(volby: object): boolean {
  const req = (volby as { serializers?: Record<string, unknown> }).serializers?.req;
  if (typeof req !== "function") return false;
  // JWT tvar (hlavička {"alg":"HS256"}), testovací hodnota.
  const tajemstvi = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.dGVzdA";
  const vystup = JSON.stringify((req as (r: unknown) => unknown)({ method: "GET", url: `/ws?token=${tajemstvi}&lang=cs` }));
  return !vystup.includes(tajemstvi) && vystup.includes("lang=cs");
}

describe("služby: každý logger z továrny safeLoggerOptions", () => {
  const soubory = produkcniSoubory();
  const zdroje = new Map(soubory.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8")]));
  let rozbory: Rozbor[] | undefined;
  const universum = (): Rozbor[] => (rozbory ??= [...zdroje].map(([f, z]) => rozbor(f, z)));

  it("měřidlo vidí universum (ne prázdný výsledek ze slepoty)", () => {
    const fastify = universum().reduce((n, r) => n + r.volaniFastify, 0);
    const pino = universum().reduce((n, r) => n + r.volaniPino, 0);
    // Naměřeno 2026-10-05: 28 volání Fastify, 4 volání pino ve službách.
    expect(fastify, "brána nenašla volání Fastify — změnil se tvar dovozu?").toBeGreaterThanOrEqual(25);
    expect(pino, "brána nenašla volání pino").toBeGreaterThanOrEqual(3);
  });

  it("továrna má serializer req, který URL s tajemstvím chrání a neškodný parametr nechá", () => {
    expect(serializerChraniUrl(safeLoggerOptions({ level: "info" }))).toBe(true);
  });

  it("⛔ mutace: logger bez serializeru měřidlo vlastnosti NAJDE", () => {
    expect(serializerChraniUrl({})).toBe(false);
    expect(serializerChraniUrl({ serializers: { req: (r: { url: string }) => ({ url: r.url }) } })).toBe(false);
    expect(serializerChraniUrl({ serializers: { req: () => ({}) } }), "kotva: zahodit celou URL není ochrana").toBe(false);
  });

  it("žádný logger služby mimo továrnu (mimo výslovné výjimky)", () => {
    const vse = universum().flatMap((r) => r.nalezy);
    const mimoVyjimky = vse.filter((n) => !(n.soubor in VYJIMKY));
    expect(
      mimoVyjimky.map((n) => `${n.soubor}:${n.radek} — ${n.co}`),
      "Logger služby vzniká z safeLoggerOptions(…) (@aisha/security): Fastify({ logger: safeLoggerOptions({ level }) }) " +
        "nebo pino(safeLoggerOptions({ level })). Bez ní jde syrová URL s dotazem a celé chyby do logu.",
    ).toEqual([]);
  });

  it("ráčna: každá výjimka má důvod a pořád nález (jinak ji smaž)", () => {
    for (const [soubor, duvod] of Object.entries(VYJIMKY)) {
      expect(duvod.trim().length, `${soubor}: výjimka bez důvodu`).toBeGreaterThan(20);
      const z = zdroje.get(soubor);
      expect(z, `${soubor}: výjimka pro soubor, který už není v universu`).toBeDefined();
      expect(nalezyVeZdroji(soubor, z as string).length, `${soubor}: výjimka už nic nepokrývá — smaž ji`).toBeGreaterThan(0);
    }
  });

  describe("⛔ mutace nad skutečnými soubory a tvary", () => {
    const vzorFastify = "services/svc-pki-bridge/src/server.ts";
    const vzorPino = "services/event-worker/src/config.ts";

    it("kotva: vzorové soubory jsou dnes čisté a mají co mutovat", () => {
      expect(nalezyVeZdroji(vzorFastify, zdroje.get(vzorFastify) as string)).toEqual([]);
      expect(nalezyVeZdroji(vzorPino, zdroje.get(vzorPino) as string)).toEqual([]);
    });

    it("Fastify s holými volbami loggeru → nález", () => {
      const z = zdroje.get(vzorFastify) as string;
      const mutant = z.replace("logger: safeLoggerOptions({ level: config.logLevel })", "logger: { level: config.logLevel }");
      expect(mutant).not.toBe(z);
      expect(nalezyVeZdroji(vzorFastify, mutant).map((n) => n.co)).toEqual([
        "Fastify: logger mimo safeLoggerOptions(…) — bez serializerů req/err",
      ]);
    });

    it("pino bez továrny → nález", () => {
      const z = zdroje.get(vzorPino) as string;
      const mutant = z.replace(/pino\(safeLoggerOptions\((\{[^}]*\})\)\)/, "pino($1)");
      expect(mutant).not.toBe(z);
      expect(nalezyVeZdroji(vzorPino, mutant)).toHaveLength(1);
    });

    it("jiný alias dovozu, Fastify bez loggeru, volby v proměnné, cizí safeLoggerOptions → nálezy", () => {
      const zdroj = [
        "import F from 'fastify';",
        "import { pino as P } from 'pino';",
        "function safeLoggerOptions(o: object) { return o; }",
        "const opts = { logger: true };",
        "F({ logger: { level: 'info' } });",
        "F({ trustProxy: true });",
        "F(opts);",
        "F({ logger: safeLoggerOptions({ level: 'info' }) });",
        "P({ level: 'info' });",
      ].join("\n");
      expect(nalezyVeZdroji("services/x/src/server.ts", zdroj).map((n) => n.radek)).toEqual([5, 6, 7, 8, 9]);
    });

    it("loggerInstance odjinud než z pino(…) tohoto souboru → nález; z továrny → čisté", () => {
      const spatne = "import Fastify from 'fastify';\nimport { log } from './jinde.js';\nFastify({ loggerInstance: log });";
      expect(nalezyVeZdroji("services/x/src/a.ts", spatne)).toHaveLength(1);
      const dobre = [
        "import Fastify from 'fastify';",
        "import pino from 'pino';",
        "import { safeLoggerOptions } from '@aisha/security';",
        "const log = pino(safeLoggerOptions({ level: 'info' }));",
        "Fastify({ loggerInstance: log as never, logger: undefined as never });",
      ].join("\n");
      expect(nalezyVeZdroji("services/x/src/b.ts", dobre).map((n) => n.co)).toEqual(["Fastify: logger i loggerInstance zároveň", "Fastify: logger mimo safeLoggerOptions(…) — bez serializerů req/err"]);
      const cisty = dobre.replace(", logger: undefined as never", "");
      expect(nalezyVeZdroji("services/x/src/b.ts", cisty)).toEqual([]);
    });

    it("alias továrny (const F2 = Fastify; F2({…})) a předání jako argument → nález", () => {
      const alias = "import Fastify from 'fastify';\nconst F2 = Fastify;\nF2({ logger: { level: 'info' } });";
      expect(nalezyVeZdroji("services/x/src/f.ts", alias).map((n) => n.radek)).toEqual([2]);
      const argument = "import pino from 'pino';\nconst vyrob = (f: unknown) => f;\nvyrob(pino);";
      expect(nalezyVeZdroji("services/x/src/g.ts", argument)).toHaveLength(1);
      const vlastnost = "import Fastify from 'fastify';\nconst F3 = Fastify.fastify;";
      expect(nalezyVeZdroji("services/x/src/h.ts", vlastnost)).toHaveLength(1);
      // kotva: typová pozice a běžná vlastnost nejsou alias
      const kotva = [
        "import pino from 'pino';",
        "import { safeLoggerOptions } from '@aisha/security';",
        "type L = ReturnType<typeof pino>;",
        "const log: L = pino(safeLoggerOptions({ level: 'info' }), pino.destination(1));",
      ].join("\n");
      expect(nalezyVeZdroji("services/x/src/i.ts", kotva)).toEqual([]);
    });

    it("logger.child(…) → nález (vazby dítěte obcházejí továrnu)", () => {
      const zdroj = "import pino from 'pino';\nimport { safeLoggerOptions } from '@aisha/security';\nconst log = pino(safeLoggerOptions({ level: 'info' }));\nlog.child({ token: 'x' }).info('a');";
      expect(nalezyVeZdroji("services/x/src/j.ts", zdroj).map((n) => n.radek)).toEqual([4]);
    });

    it("require('fastify') a dovoz jmenným prostorem → nález (co brána nečte, neprošlo)", () => {
      expect(nalezyVeZdroji("services/x/src/c.ts", "const F = require('fastify');\nF({});")).toHaveLength(1);
      expect(nalezyVeZdroji("services/x/src/d.ts", "import * as P from 'pino';\nP.default({});")).toHaveLength(1);
    });

    it("logger: false je výslovné vypnutí — čisté (kotva)", () => {
      expect(nalezyVeZdroji("services/x/src/e.ts", "import Fastify from 'fastify';\nFastify({ logger: false });")).toEqual([]);
    });
  });
});
