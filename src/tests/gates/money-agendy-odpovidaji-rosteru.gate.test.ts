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
 * ⭐ Brána NESMÍ být zelená mlčením. Když roster ani env nejsou k dispozici,
 * řekne to nahlas místo tichého průchodu — `AISHA_OVERLAY_REQUIRED=1` pak
 * nedostupnost překlápí ve vadu zapojení.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
// ⛔ K overlayi vedou JEDNY dveře (brána `overlay-jde-jen-jednemi-dvermi`).
// Číst `AISHA_INSTANCE_CONFIG_DIR` napřímo se nesmí: rozcestník ho čte LÍNĚ,
// takže se nedá minout tím, že si ho konzument hydratuje až po importu — a
// `overlayRequired()` z jednoho přepínače udělá z volitelného čtení povinné.
import { overlayDir, overlayRequired } from "../../../scripts/lib/instance-overlay.mjs";

const ROOT = process.cwd();
const ROSTER_REL = "sources/money-agendas.json";

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

describe("Money agendy: roster v instančním repu × doručená pověření", () => {
  const OVERLAY_REQUIRED = overlayRequired();
  const roster = nactiRoster(overlayDir() ?? "");
  const env = nactiEnvAgendy(ROOT);

  test("roster je čitelný, když je overlay k dispozici", () => {
    if (!OVERLAY_REQUIRED) return; // bez overlaye je nepřítomnost legitimní stav
    expect(
      roster,
      `AISHA_OVERLAY_REQUIRED=1, ale ${ROSTER_REL} v overlayi chybí nebo není platný JSON.\n` +
        "Overlay JE k dispozici, takže jeho nepřítomnost je vada zapojení, ne stav světa.",
    ).not.toBeNull();
  });

  test("port je identita — žádná agenda si ho s jinou nedělí", () => {
    if (!roster) {
      expect(OVERLAY_REQUIRED, "roster nedostupný a overlay není povinný — NEPROHLÉDNUTO").toBe(false);
      return;
    }
    const nalezy = najdiKolize(roster.agendas ?? [], "roster");
    expect(
      nalezy.map((n) => `${n.kde}: ${n.co}`),
      "Money rozlišuje účetní jednotky PORTEM. Kolize = data dvou firem pod jednou identitou —\n" +
        "chyba, která nikde nespadne a pozná se až podle cizích čísel v účetnictví.",
    ).toEqual([]);
  });

  test("roster a pověření se shodují oběma směry", () => {
    if (!roster || !env) {
      // Nemám čím měřit. To se musí PŘIZNAT, ne prolézt jako zelená.
      expect(
        OVERLAY_REQUIRED && !roster,
        `NEPROHLÉDNUTO — roster: ${roster ? "ano" : "ne"}, .env.coolify: ${env ? "ano" : "ne"}.\n` +
          "(.env.coolify je gitignorovaný, takže v CI chybí právem; tahle shoda se měří lokálně a při nasazení.)",
      ).toBe(false);
      return;
    }
    const nalezy = porovnej(roster.agendas ?? [], env);
    expect(
      nalezy.map((n) => `chybí v ${n.kde} — ${n.co}`),
      "Seznam agend má DVA domovy: deklaraci v instančním repu (obnovitelnou z gitu)\n" +
        "a pověření v env. Rozejdou-li se, jeden z nich tiše lže o tom, co systém umí.",
    ).toEqual([]);
  });
});
