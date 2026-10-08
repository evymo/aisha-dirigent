/**
 * Money agendy: deklarovaný roster × doručená pověření (CLASS gate)
 *
 * TŘÍDA VADY: seznam, který existuje JEN jako hodnota tajemství. Nedá se z něj
 * obnovit, CO tam mělo být — chybějící položka se nepozná od úplného seznamu.
 *
 * ⛔ NAMĚŘENO 2026-08-28: `MONEY_AGENDAS` (env, preservedValue) nesla PĚT agend.
 * Šestá firma — Slezské kamenolomy a.s., jediný zdroj DODACÍCH LISTŮ — v ní
 * nebyla. Nikde přitom nevznikla chyba: `svc-money` naskočil zdravý, `/agendas`
 * vrátilo pět položek a všechny fungovaly. Chybějící agenda se nedá odlišit od
 * agendy, která tam nikdy patřit neměla — env blob NEZNÁ svůj zamýšlený tvar.
 * Půl dne se proto hledala vada spojení k dodacím listům, které se nikdy
 * nezačalo ptát (souvisí: „měřidlo, jehož univerzum mine část světa, vydá
 * stejný výstup jako měřidlo, které nic nenašlo").
 *
 * NÁPRAVA (majitel 2026-08-28: „by design riq data repo config, tam chceme moct
 * obnovit"): roster je DEKLARACE v instančním repu — `sources/money-agendas.json`,
 * obnovitelná z gitu. Tajemství zůstávají v env pod `secret_ref`. Tahle brána
 * drží obojí u sebe.
 *
 * INVARIANTY:
 *   1. PORT JE IDENTITA AGENDY. Money rozlišuje účetní jednotky portem, ne
 *      cestou (naměřeno 2026-08-27: tentýž client_id → TOKEN OK na 100,
 *      invalid_client na 81). Dva záznamy na jednom portu = tichá záměna dat
 *      mezi DVĚMA FIRMAMI. To je nejhorší možný tvar chyby: nikde nespadne.
 *   2. Roster a doručená pověření se musí shodovat OBĚMA SMĚRY. Agenda navíc
 *      v env = nedeklarovaný přístup do cizího účetnictví; agenda navíc
 *      v rosteru = deklarovaný zdroj, který se nikdy nezeptá.
 *
 * ⭐ Brána NESMÍ být zelená mlčením. Když overlay není k dispozici, řekne to
 * nahlas (NEMĚŘENO, přeskočený test) — `AISHA_OVERLAY_REQUIRED=1` pak
 * nedostupnost OVERLAYE překlápí ve vadu zapojení.
 *
 * ⛔ MODUL NENÍ PODMÍNKA PLATFORMY (naměřeno 2026-10-03). Do té doby brána pod
 * `AISHA_OVERLAY_REQUIRED=1` vyžadovala roster od KAŽDÉHO overlaye: instance,
 * která Money vůbec nepoužívá, by měla lane overlay-gates červenou — tvar jedné
 * instance se stal pravidlem pro všechny. Použitelnost se proto ODVOZUJE z toho,
 * co overlay opravdu nese, ne z další deklarace k udržování:
 *
 *   overlay nese modul  ⇔  má roster, NEBO některý zdroj v `sources/` odkazuje
 *                          na agendu (`agenda_key`), NEBO dorazila pověření
 *
 *   · nenese nic z toho  → není co porovnávat; řekne to VIDITELNĚ a test přeskočí
 *   · nese jen PŮLKU     → červená (agenda bez rosteru, pověření bez rosteru,
 *                          roster bez agend, odkaz na agendu, kterou roster nezná)
 *   · nese celý          → invarianty 1 a 2 + každý odkaz zdroje vede do rosteru
 *
 * Že měřidlo není slepé, drží vzorový overlay (fixtures/overlay-vzor) a mutace níž.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
// ⛔ K overlayi vedou JEDNY dveře (brána `overlay-jde-jen-jednemi-dvermi`).
// Číst `AISHA_INSTANCE_CONFIG_DIR` napřímo se nesmí: rozcestník ho čte LÍNĚ,
// takže se nedá minout tím, že si ho konzument hydratuje až po importu — a
// `overlayRequired()` z jednoho přepínače udělá z volitelného čtení povinné.
import { overlayDirOrRequired } from "../../../scripts/lib/instance-overlay.mjs";

const ROOT = process.cwd();
const ROSTER_REL = "sources/money-agendas.json";
const ZDROJE_REL = "sources";
const VZOR = join(ROOT, "src/tests/gates/fixtures/overlay-vzor");

export interface Agenda {
  key: string;
  label: string;
  port: number;
}

export interface Nalez {
  kde: string;
  co: string;
}

/** Roster z instančního repa. `null` = není odkud číst (ne „je prázdný"). */
export function nactiRoster(overlayDir: string): { agendas: Agenda[] } | null {
  if (!overlayDir) return null;
  const p = join(overlayDir, ROSTER_REL);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as { agendas: Agenda[] };
}

/**
 * Pověření z `.env.coolify`. Soubor je gitignorovaný — v CI NENÍ, a to je
 * legitimní stav, ne vada. `null` proto znamená „nemám čím měřit".
 */
export function nactiEnvAgendy(root: string): Agenda[] | null {
  const p = join(root, ".env.coolify");
  if (!existsSync(p)) return null;
  const src = readFileSync(p, "utf8");
  // Hodnota je JSON v apostrofech na jednom řádku; bereme JEN první výskyt.
  const m = src.match(/^MONEY_AGENDAS=(.*)$/m);
  if (!m) return null;
  const raw = m[1].trim().replace(/^'|'$/g, "").replace(/^"|"$/g, "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Agenda[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Port je identita — kolize je tichá záměna dat mezi firmami. */
export function najdiKolize(agendas: Agenda[], kde: string): Nalez[] {
  const out: Nalez[] = [];
  const porty = new Map<number, string>();
  const klice = new Map<string, number>();
  for (const a of agendas) {
    if (!a || typeof a !== "object") {
      out.push({ kde, co: "položka není objekt" });
      continue;
    }
    if (!a.key) out.push({ kde, co: `agenda na portu ${String(a.port)} nemá key` });
    if (!a.label) out.push({ kde, co: `agenda '${a.key}' nemá label — jde do owner_company` });
    if (!Number.isInteger(a.port)) {
      out.push({ kde, co: `agenda '${a.key}' nemá platný port: ${String(a.port)}` });
      continue;
    }
    const drzitel = porty.get(a.port);
    if (drzitel !== undefined) {
      out.push({ kde, co: `PORT ${a.port} mají DVĚ agendy ('${drzitel}' a '${a.key}') — tichá záměna dat mezi firmami` });
    }
    porty.set(a.port, a.key);
    if (klice.has(a.key)) out.push({ kde, co: `klíč '${a.key}' je dvakrát` });
    klice.set(a.key, a.port);
  }
  return out;
}

/** Roster × env, OBĚMA směry. Klíčem je port (identita agendy). */
export function porovnej(roster: Agenda[], env: Agenda[]): Nalez[] {
  const out: Nalez[] = [];
  const vRosteru = new Map(roster.map((a) => [a.port, a.key]));
  const vEnv = new Map(env.map((a) => [a.port, a.key]));

  for (const [port, key] of vRosteru) {
    if (!vEnv.has(port)) {
      out.push({ kde: "env", co: `agenda '${key}' (port ${port}) je DEKLAROVANÁ v rosteru, ale pověření nedorazila — zdroj se nikdy nezeptá` });
    }
  }
  for (const [port, key] of vEnv) {
    if (!vRosteru.has(port)) {
      out.push({ kde: "roster", co: `agenda '${key}' (port ${port}) má pověření, ale NENÍ deklarovaná — nedeklarovaný přístup do cizího účetnictví` });
    }
  }
  return out;
}

export interface Odkaz {
  soubor: string;
  agenda: string;
}

/**
 * Které zdroje overlaye odkazují na agendu — každé `agenda_key` kdekoli v
 * `sources/*.json` (mimo roster). Seznam zdrojů se HLEDÁ, neudržuje.
 * `necitelne` = soubor, který nejde přečíst jako JSON: nevíme, na co odkazuje.
 */
export function odkazyNaAgendy(overlayDir: string): { odkazy: Odkaz[]; necitelne: string[] } {
  const odkazy: Odkaz[] = [];
  const necitelne: string[] = [];
  const dir = join(overlayDir, ZDROJE_REL);
  if (!overlayDir || !existsSync(dir)) return { odkazy, necitelne };
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    if (`${ZDROJE_REL}/${f}` === ROSTER_REL) continue;
    let j: unknown;
    try {
      j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      necitelne.push(f);
      continue;
    }
    const projdi = (x: unknown): void => {
      if (Array.isArray(x)) return x.forEach(projdi);
      if (!x || typeof x !== "object") return;
      for (const [k, v] of Object.entries(x)) {
        if (k === "agenda_key" && typeof v === "string" && v) odkazy.push({ soubor: f, agenda: v });
        else projdi(v);
      }
    };
    projdi(j);
  }
  return { odkazy, necitelne };
}

export interface Vstup {
  roster: { agendas?: Agenda[] } | null;
  odkazy: Odkaz[];
  necitelne?: string[];
  env: Agenda[] | null;
}

/**
 * Nese overlay modul Money — a drží pohromadě? Čistá funkce: tatáž měří overlay
 * instance i vzorový overlay s mutacemi.
 *   nese=false, nalezy=[]  → modul v overlayi není, není co porovnávat
 *   nalezy≠[]              → půlka modulu nebo rozpor (červená)
 */
export function posudModul(v: Vstup): { nese: boolean; nalezy: Nalez[] } {
  const nalezy: Nalez[] = [];
  for (const f of v.necitelne ?? []) {
    nalezy.push({ kde: "zdroj", co: `${ZDROJE_REL}/${f} není platný JSON — nejde zjistit, zda odkazuje na agendu` });
  }
  const povereni = v.env ?? [];

  if (!v.roster) {
    for (const o of v.odkazy) {
      nalezy.push({ kde: "roster", co: `zdroj ${ZDROJE_REL}/${o.soubor} odkazuje na agendu '${o.agenda}', ale ${ROSTER_REL} v overlayi není — agenda bez deklarace` });
    }
    if (povereni.length > 0) {
      nalezy.push({ kde: "roster", co: `pověření MONEY_AGENDAS nesou ${povereni.length} agend, ale ${ROSTER_REL} v overlayi není — nedeklarovaný přístup do cizího účetnictví` });
    }
    return { nese: nalezy.length > 0, nalezy };
  }

  const agendy = Array.isArray(v.roster.agendas) ? v.roster.agendas : [];
  if (agendy.length === 0) {
    nalezy.push({ kde: "roster", co: `${ROSTER_REL} nenese žádnou agendu — roster bez agend je půlka modulu (instance bez Money roster nemá vůbec)` });
  }
  nalezy.push(...najdiKolize(agendy, "roster"));
  const zname = new Set(agendy.map((a) => a?.key));
  for (const o of v.odkazy) {
    if (!zname.has(o.agenda)) {
      nalezy.push({ kde: "roster", co: `zdroj ${ZDROJE_REL}/${o.soubor} odkazuje na agendu '${o.agenda}', kterou roster nezná — zdroj se nikdy nezeptá` });
    }
  }
  if (v.env) nalezy.push(...porovnej(agendy, v.env));
  return { nese: true, nalezy };
}

const vypis = (nalezy: Nalez[]) => nalezy.map((n) => `${n.kde}: ${n.co}`);

describe("Money agendy: roster v instančním repu × doručená pověření", () => {
  test("overlay instance: modul Money drží pohromadě — nebo ho overlay nenese", (ctx) => {
    // Chybí-li overlay a je vynucený, vyhodí to už dveře (vada zapojení, ne stav světa).
    const dir = overlayDirOrRequired("money-agendy-odpovidaji-rosteru");
    if (!dir) {
      console.warn("[money-agendy] bez overlaye — roster instance NEMĚŘENO");
      ctx.skip();
      return;
    }
    const roster = nactiRoster(dir);
    const { odkazy, necitelne } = odkazyNaAgendy(dir);
    const env = nactiEnvAgendy(ROOT);
    const { nese, nalezy } = posudModul({ roster, odkazy, necitelne, env });

    expect(
      vypis(nalezy),
      "Seznam agend má DVA domovy: deklaraci v instančním repu (obnovitelnou z gitu) a pověření\n" +
        "v env; zdroje na agendy odkazují klíčem a Money je rozlišuje PORTEM. Rozejdou-li se,\n" +
        "některý tiše lže o tom, co systém umí — a kolize portu zamění data dvou firem.",
    ).toEqual([]);

    if (!nese) {
      console.warn(
        "[money-agendy] overlay modul Money nenese (žádný roster, žádný zdroj s agenda_key, " +
          "žádná pověření) — NEMĚŘENO, není co porovnávat",
      );
      ctx.skip();
      return;
    }
    if (!env) {
      // .env.coolify je gitignorovaný, v CI chybí právem; shoda se měří lokálně a při nasazení.
      console.warn(
        `[money-agendy] roster (${roster?.agendas?.length ?? 0} agend) a ${odkazy.length} odkazů zdrojů změřeno; ` +
          "shoda s doručenými pověřeními NEMĚŘENO (.env.coolify není k dispozici)",
      );
    }
  });
});

describe("měřidlo modulu Money nad vzorovým overlayem (kotva a mutace)", () => {
  const S_MONEY = join(VZOR, "s-money");
  const BEZ_MODULU = join(VZOR, "bez-modulu");
  const vzor = () => {
    const roster = nactiRoster(S_MONEY);
    const { odkazy, necitelne } = odkazyNaAgendy(S_MONEY);
    return { roster, odkazy, necitelne };
  };

  test("kladná kotva: overlay s modulem se MĚŘÍ a je v pořádku", () => {
    const { roster, odkazy, necitelne } = vzor();
    expect(roster?.agendas?.map((a) => a.key), "vzorový roster se nenačetl — kotva by neměřila nic").toEqual([
      "vzorova-alfa",
      "vzorova-beta",
    ]);
    expect(odkazy, "odkaz zdroje na agendu se nenašel — hledání `agenda_key` je slepé").toEqual([
      { soubor: "money-doklady.json", agenda: "vzorova-alfa" },
    ]);
    expect(necitelne).toEqual([]);
    expect(posudModul({ roster, odkazy, env: null })).toEqual({ nese: true, nalezy: [] });
    // s pověřeními, která rosteru odpovídají, je to pořád čisté
    expect(posudModul({ roster, odkazy, env: roster!.agendas! }).nalezy).toEqual([]);
  });

  test("overlay bez modulu: nenese — a není to nález", () => {
    expect(nactiRoster(BEZ_MODULU)).toBeNull();
    const { odkazy, necitelne } = odkazyNaAgendy(BEZ_MODULU);
    expect(existsSync(join(BEZ_MODULU, ZDROJE_REL, "dokumenty.json")), "vzor bez modulu má mít zdroj, který agendy nepoužívá").toBe(true);
    expect({ odkazy, necitelne }).toEqual({ odkazy: [], necitelne: [] });
    expect(posudModul({ roster: null, odkazy, env: null })).toEqual({ nese: false, nalezy: [] });
    // prázdná pověření (proměnná je, seznam ne) modul nezakládají
    expect(posudModul({ roster: null, odkazy, env: [] })).toEqual({ nese: false, nalezy: [] });
  });

  test("mutace: PŮLKA modulu je červená", () => {
    const { roster, odkazy } = vzor();
    const agendy = roster!.agendas!;
    const pocet = (v: Vstup) => posudModul(v).nalezy.length;

    // agenda bez rosteru: zdroj odkazuje, deklarace chybí
    expect(vypis(posudModul({ roster: null, odkazy, env: null }).nalezy).join("\n")).toMatch(/odkazuje na agendu 'vzorova-alfa', ale .* není/);
    // pověření bez rosteru
    expect(vypis(posudModul({ roster: null, odkazy: [], env: agendy }).nalezy).join("\n")).toMatch(/pověření MONEY_AGENDAS nesou 2 agend/);
    // roster bez agend
    expect(pocet({ roster: { agendas: [] }, odkazy: [], env: null })).toBeGreaterThan(0);
    expect(pocet({ roster: {}, odkazy: [], env: null })).toBeGreaterThan(0);
    // odkaz na agendu, kterou roster nezná
    expect(vypis(posudModul({ roster, odkazy: [{ soubor: "x.json", agenda: "neznama" }], env: null }).nalezy).join("\n")).toMatch(/kterou roster nezná/);
    // rozbitý roster: dvě agendy na jednom portu
    const kolize = { agendas: [agendy[0], { ...agendy[1], port: agendy[0].port }] };
    expect(vypis(posudModul({ roster: kolize, odkazy, env: null }).nalezy).join("\n")).toMatch(/PORT 8101 mají DVĚ agendy/);
    // roster × pověření, oba směry
    expect(vypis(posudModul({ roster, odkazy, env: [agendy[0]] }).nalezy).join("\n")).toMatch(/DEKLAROVANÁ v rosteru, ale pověření nedorazila/);
    const navic = [...agendy, { key: "cizi", label: "Cizí", port: 8199 }];
    expect(vypis(posudModul({ roster, odkazy, env: navic }).nalezy).join("\n")).toMatch(/má pověření, ale NENÍ deklarovaná/);
    // zdroj, který nejde přečíst: nevíme, na co odkazuje
    expect(pocet({ roster: null, odkazy: [], necitelne: ["rozbity.json"], env: null })).toBe(1);
    expect(posudModul({ roster: null, odkazy: [], necitelne: ["rozbity.json"], env: null }).nese).toBe(true);
  });
});
