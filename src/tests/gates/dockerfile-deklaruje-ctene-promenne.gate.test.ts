/**
 * Dockerfile deklaruje každou proměnnou, kterou čte v RUN.
 *
 * PROČ (naměřeno 2026-10-04 z logů nasazení řídicí roviny): build cache v praxi nefungovala —
 * kroky RUN z cache 7 % flotily, core stack 0 z 96. Řídicí rovina vkládá build-time proměnné
 * aplikace jako ARG hned za každý FROM; jedna z nich se mění s každým nasazením (id commitu),
 * a protože ARG je v klíči cache každého RUN za deklarací, nový commit přestaví všechno
 * (npm ci, build ze zdrojů). Řídicí rovina má přepínač, který vkládání vypne. Bezpečný je jen
 * tehdy, když si každý Dockerfile deklaruje, co čte — jinak by proměnná tiše zmizela
 * (např. verze `unknown`). Tahle brána ten stav drží; je předpokladem vypnutí vkládání.
 *
 * Pravidlo pro každou fázi (FROM … do dalšího FROM): proměnná čtená v RUN (`$X`, `${X…}`) musí
 *   - být ve fázi deklarovaná přes ARG nebo ENV, nebo
 *   - přijít přes ENV z rodičovské fáze (`FROM <jiná fáze>` dědí ENV, ARG NE), nebo
 *   - být přiřazená v témže RUN (`X=…`, `export X=…`, `for X in`, `read X`), nebo
 *   - být na výčtu ENV ZÁKLADNÍCH OBRAZŮ níže (jmenovitě, s důvodem, se stropem).
 * Globální ARG před prvním FROM do fáze nepronikne, dokud ho fáze nedeklaruje znovu (Docker).
 * Měří se jen jména VELKÝMI písmeny (proměnné prostředí); malá jsou lokální proměnné shellu.
 * Nečte se obsah heredoc (`RUN <<EOF`) — tam brána nevidí a nic netvrdí.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const VYNECHAT = new Set(["node_modules", ".git", "dist", "build", ".turbo", ".next", "coverage"]);

/** ENV základních obrazů čtené bez vlastní deklarace. Každá položka musí být použitá (jinak je mrtvá). */
const ENV_ZAKLADNICH_OBRAZU: Record<string, string> = {
  GOPATH: "ENV oficiálního obrazu golang (build ze zdrojů v docker/minio)",
  GOROOT: "ENV oficiálního obrazu golang (build ze zdrojů v docker/minio)",
};
const STROP_ENV_ZAKLADNICH_OBRAZU = 4;
/** Proměnné, které nastavuje shell nebo systém, ne build. */
const SHELL = new Set(["PATH", "HOME", "PWD", "OLDPWD", "HOSTNAME", "USER", "SHELL", "TERM", "IFS", "UID", "RANDOM", "SECONDS", "LINENO", "PPID"]);

type Faze = { od: string; alias?: string; arg: Set<string>; env: Set<string>; runy: string[] };
type Nalez = { soubor: string; faze: number; od: string; promenna: string };

function logickeRadky(text: string): string[] {
  const vystup: string[] = [];
  let rozpracovany = "";
  for (const surovy of text.split("\n")) {
    const radek = surovy.replace(/\r$/, "");
    if (!rozpracovany && /^\s*#/.test(radek)) continue;
    if (/\\\s*$/.test(radek)) {
      rozpracovany += radek.replace(/\\\s*$/, " ");
      continue;
    }
    vystup.push(rozpracovany + radek);
    rozpracovany = "";
  }
  if (rozpracovany) vystup.push(rozpracovany);
  return vystup;
}

/** `ARG A=1 B` / `ENV A=1 B=2` → jména. Starý tvar `ENV A 1` řeší volající (jméno je jen první slovo). */
function jmenaDeklarace(zbytek: string): string[] {
  return zbytek.trim().split(/\s+/).map((s) => s.split("=")[0]).filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
}

function faze(text: string): Faze[] {
  const vysledek: Faze[] = [];
  for (const radek of logickeRadky(text)) {
    const m = /^\s*([A-Za-z]+)\s*(.*)$/.exec(radek);
    if (!m) continue;
    const instrukce = m[1].toUpperCase();
    const zbytek = m[2];
    if (instrukce === "FROM") {
      const a = /\s+AS\s+([A-Za-z0-9_.-]+)\s*$/i.exec(zbytek);
      vysledek.push({ od: zbytek.replace(/\s+AS\s+.*$/i, "").trim(), alias: a?.[1], arg: new Set(), env: new Set(), runy: [] });
      continue;
    }
    const aktualni = vysledek[vysledek.length - 1];
    if (!aktualni) continue; // globální ARG před prvním FROM do fáze nepronikne
    if (instrukce === "ARG") for (const j of jmenaDeklarace(zbytek)) aktualni.arg.add(j);
    else if (instrukce === "ENV") {
      const slova = zbytek.trim().split(/\s+/);
      const jmena = slova.length >= 2 && !slova[0].includes("=") ? [slova[0]] : jmenaDeklarace(zbytek);
      for (const j of jmena) aktualni.env.add(j);
    } else if (instrukce === "RUN") aktualni.runy.push(zbytek);
  }
  return vysledek;
}

function zdedeneEnv(vsechny: Faze[], f: Faze, hloubka = 0): Set<string> {
  const rodic = vsechny.find((x) => x.alias && x.alias === f.od);
  if (!rodic || hloubka > 20) return new Set();
  return new Set([...rodic.env, ...zdedeneEnv(vsechny, rodic, hloubka + 1)]);
}

function nalezyVDockerfilu(soubor: string, text: string, envObrazu: Record<string, string> = ENV_ZAKLADNICH_OBRAZU): { nalezy: Nalez[]; pouziteZObrazu: Set<string> } {
  const nalezy: Nalez[] = [];
  const pouziteZObrazu = new Set<string>();
  const vsechny = faze(text);
  vsechny.forEach((f, i) => {
    const deklarovane = new Set([...f.arg, ...f.env, ...zdedeneEnv(vsechny, f)]);
    for (const run of f.runy) {
      const mistni = new Set<string>();
      for (const m of run.matchAll(/(?:^|[\s;&|(`])(?:export\s+|local\s+|readonly\s+)?([A-Z][A-Z0-9_]*)=/g)) mistni.add(m[1]);
      for (const m of run.matchAll(/\b(?:for|read)\s+([A-Z][A-Z0-9_]*)\b/g)) mistni.add(m[1]);
      const ctene = new Set([...run.matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
      for (const j of [...ctene].sort()) {
        if (deklarovane.has(j) || mistni.has(j) || SHELL.has(j)) continue;
        if (j in envObrazu) { pouziteZObrazu.add(j); continue; }
        nalezy.push({ soubor, faze: i, od: f.od, promenna: j });
      }
    }
  });
  return { nalezy, pouziteZObrazu };
}

function dockerfily(adr: string, vystup: string[] = []): string[] {
  for (const e of readdirSync(adr, { withFileTypes: true })) {
    if (VYNECHAT.has(e.name)) continue;
    const p = path.join(adr, e.name);
    if (e.isDirectory()) dockerfily(p, vystup);
    else if (/^Dockerfile(\..+)?$/.test(e.name) || /\.Dockerfile$/.test(e.name)) vystup.push(p);
  }
  return vystup;
}

describe("Dockerfile deklaruje každou proměnnou, kterou čte v RUN", () => {
  const soubory = dockerfily(ROOT).sort();
  const texty = new Map(soubory.map((s) => [path.relative(ROOT, s), readFileSync(s, "utf8")]));

  it("samotest vzoru: Dockerfily i deklarace se našly (jinak NEZMĚŘENO, ne zelená)", () => {
    expect(soubory.length, "NEZMĚŘENO: skoro žádný Dockerfile — brána neměří").toBeGreaterThan(40);
    // Měřeno 2026-10-04 nezávisle (awk po řádcích): ARG nebo ENV ve fázi má 50 z 64 Dockerfilů; jen ARG ve
    // fázi 8 — většina deklaruje ARG jen globálně před FROM (adresa registru), do fází nepronikne.
    const sDeklaraci = [...texty.values()].filter((t) => faze(t).some((f) => f.arg.size > 0 || f.env.size > 0)).length;
    expect(sDeklaraci, "NEZMĚŘENO: deklarace ARG/ENV se ve fázích nenašly — vzor nečte").toBeGreaterThan(40);
    const web = texty.get("Dockerfile.web");
    expect(web, "NEZMĚŘENO: Dockerfile.web nenalezen").toBeDefined();
    expect(faze(web!).some((f) => f.arg.has("GIT_SHA")), "NEZMĚŘENO: vzor nenašel ARG GIT_SHA v Dockerfile.web").toBe(true);
  });

  it("žádná fáze nečte nedeklarovanou proměnnou", () => {
    const nalezy = [...texty].flatMap(([s, t]) => nalezyVDockerfilu(s, t).nalezy);
    expect(
      nalezy.map((n) => `${n.soubor} fáze ${n.faze} (${n.od}): $${n.promenna}`),
      "Proměnná čtená v RUN bez deklarace ve fázi. Bez vkládání ARG řídicí rovinou by tiše zmizela. " +
        "Doplň `ARG <jméno>` do fáze co nejpozději (před první RUN, který ji čte), nebo `ENV`, pokud ji potřebuje i běh.",
    ).toEqual([]);
  });

  it("výčet ENV základních obrazů je jmenovitý, se stropem a bez mrtvých položek", () => {
    expect(Object.keys(ENV_ZAKLADNICH_OBRAZU).length).toBeLessThanOrEqual(STROP_ENV_ZAKLADNICH_OBRAZU);
    for (const [jmeno, duvod] of Object.entries(ENV_ZAKLADNICH_OBRAZU)) expect(duvod.length, jmeno).toBeGreaterThan(10);
    const pouzite = new Set([...texty].flatMap(([s, t]) => [...nalezyVDockerfilu(s, t).pouziteZObrazu]));
    expect(Object.keys(ENV_ZAKLADNICH_OBRAZU).filter((j) => !pouzite.has(j)), "položka výčtu, kterou už nic nečte — odeber ji").toEqual([]);
  });
});

describe("kotva: brána pozná nedeklarovanou proměnnou", () => {
  const nalezy = (t: string) => nalezyVDockerfilu("vzor/Dockerfile", t, {}).nalezy.map((n) => `${n.faze}:${n.promenna}`);

  it("RUN čtoucí nedeklarovanou proměnnou = nález (kontrolní vzorek červené)", () => {
    expect(nalezy("FROM node:22\nRUN echo \"verze ${VERZE_BUILDU:-unknown}\"\n")).toEqual(["0:VERZE_BUILDU"]);
  });

  it("deklarace ARG ve fázi = bez nálezu", () => {
    expect(nalezy("FROM node:22\nARG VERZE_BUILDU\nRUN echo \"$VERZE_BUILDU\"\n")).toEqual([]);
  });

  it("globální ARG před FROM do fáze nepronikne (Docker)", () => {
    expect(nalezy("ARG VERZE_BUILDU=1\nFROM node:22\nRUN echo $VERZE_BUILDU\n")).toEqual(["0:VERZE_BUILDU"]);
  });

  it("ENV z rodičovské fáze se dědí, ARG ne", () => {
    const t = "FROM node:22 AS zaklad\nENV CESTA_A=/a\nARG JEN_TADY\nFROM zaklad AS build\nRUN echo $CESTA_A $JEN_TADY\n";
    expect(nalezy(t)).toEqual(["1:JEN_TADY"]);
  });

  it("přiřazení v témže RUN a víceřádkový RUN se pokračováním", () => {
    const t = "FROM alpine\nRUN VERZE=\"$(cat v)\"; \\\n  export DALSI=1; \\\n  for SOUBOR in a b; do echo $SOUBOR $VERZE $DALSI; done\n";
    expect(nalezy(t)).toEqual([]);
  });

  it("odebraná deklarace ze skutečného Dockerfile.web = nález (mutace)", () => {
    const web = readFileSync(path.join(ROOT, "Dockerfile.web"), "utf8");
    const bez = web.replace(/^ARG GIT_SHA\s*$/m, "");
    expect(bez).not.toBe(web);
    expect(nalezyVDockerfilu("Dockerfile.web", bez).nalezy.map((n) => n.promenna)).toContain("GIT_SHA");
  });
});
