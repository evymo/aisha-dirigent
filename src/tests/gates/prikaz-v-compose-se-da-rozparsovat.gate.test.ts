/**
 * Každý shellový příkaz v compose se dá ROZPARSOVAT
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * `healthcheck.test` (CMD-SHELL), `command` a `entrypoint` jsou SHELLOVÝ KÓD.
 * Nikdo je nespouští v CI, žádný linter je nečte — chyba v nich se pozná až
 * v běžícím kontejneru, a to jen když se někdo podívá na `docker inspect`.
 *
 * ── PROČ (naměřeno 2026-08-13) ────────────────────────────────────────────────
 * Hlídka vlny 0 (netinit — zakládá sítě instance) padala 170× po sobě na:
 *     /bin/sh: syntax error: unexpected "||"
 * Vlna 0 se má prokazovat ZDRAVÍM. Sonda se nerozparsovala, takže se vlna
 * nikdy neprokázala — a `Deploy: Core` v CI čekal 30 minut a vypršel.
 *
 * Příčina nebyla v shellu, ale v YAMLu. Ve skládaném skaláru (`>-`) se slepují
 * jen řádky se STEJNÝM odsazením jako první; řádek odsazený VÍC se bere doslovně
 * a nový řádek před ním zůstane. Autor odsadil pokračování `|| docker …` kvůli
 * čitelnosti a tím změnil význam — shell dostal řádek začínající `||`.
 *
 * Odsazení pro čitelnost je tedy v YAMLu SÉMANTICKÁ operace. Brána proto nečte
 * zdrojový text, ale to, co z YAMLu SKUTEČNĚ VYPADNE.
 *
 * ── JEDINÁ NUTNÁ TRANSFORMACE ─────────────────────────────────────────────────
 * Compose escapuje `$` jako `$$`. Bez toho by `$$((i+1))` vypadalo jako PID
 * následovaný `((` a brána by hlásila deset falešných nálezů — přesně to se
 * při vývoji téhle brány stalo. `${VAR}` se NEnahrazuje: `sh -n` kontroluje
 * SYNTAXI, ne definovanost, a náhrada sama vyráběla chyby u vnořených závorek.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();

type Nalez = { soubor: string; sluzba: string; klic: string; chyba: string };

/** Shellové příkazy ve službě — jen ty, které shell SKUTEČNĚ interpretuje. */
function shelloveNalezy(svc: unknown): { klic: string; kod: string }[] {
  if (!svc || typeof svc !== "object") return [];
  const s = svc as Record<string, unknown>;
  const out: { klic: string; kod: string }[] = [];

  const hc = s.healthcheck as { test?: unknown } | undefined;
  if (hc && Array.isArray(hc.test) && hc.test[0] === "CMD-SHELL" && typeof hc.test[1] === "string") {
    out.push({ klic: "healthcheck", kod: hc.test[1] });
  }

  for (const klic of ["command", "entrypoint"] as const) {
    const v = s[klic];
    // Řetězec = shell forma. Pole = exec forma, kterou shell NEVIDÍ — leda že
    // je to výslovně `sh -c <kód>`.
    if (typeof v === "string") out.push({ klic, kod: v });
    else if (Array.isArray(v) && v.length >= 3 && typeof v[v.length - 1] === "string") {
      const shell = String(v[0]);
      if (/(^|\/)(sh|bash|ash|dash)$/.test(shell) && v.slice(0, 2).includes("-c")) {
        out.push({ klic, kod: String(v[v.length - 1]) });
      }
    }
  }
  return out;
}

/** Compose escapuje `$` jako `$$` — jediná transformace, kterou brána dělá. */
function jakToUvidiShell(kod: string): string {
  return kod.replace(/\$\$/g, "$");
}

describe("každý shellový příkaz v compose se dá rozparsovat", () => {
  const soubory = readdirSync(ROOT).filter((f) => /^docker-compose.*\.ya?ml$/.test(f)).sort();

  it("compose soubory se vůbec našly", () => {
    // Mlčení sondy je samo nálezem: kdyby se přejmenoval vzor, brána by
    // „prošla" s nulou prohlédnutých souborů a nic by neměřila.
    expect(soubory.length, "nenašel se ŽÁDNÝ docker-compose*.yml — brána neměří").toBeGreaterThan(5);
  });

  it("žádný healthcheck / command / entrypoint nepadá na syntaxi", () => {
    const nalezy: Nalez[] = [];
    let prohlednuto = 0;

    for (const soubor of soubory) {
      let doc: unknown;
      try {
        doc = parse(readFileSync(path.join(ROOT, soubor), "utf8"));
      } catch (e) {
        nalezy.push({ soubor, sluzba: "(celý soubor)", klic: "yaml", chyba: String(e).slice(0, 200) });
        continue;
      }
      const services = (doc as { services?: Record<string, unknown> })?.services;
      if (!services || typeof services !== "object") continue;

      for (const [sluzba, svc] of Object.entries(services)) {
        for (const { klic, kod } of shelloveNalezy(svc)) {
          prohlednuto += 1;
          try {
            execFileSync("sh", ["-n"], { input: jakToUvidiShell(kod), stdio: ["pipe", "ignore", "pipe"] });
          } catch (e) {
            const err = e as { stderr?: Buffer };
            nalezy.push({
              soubor,
              sluzba,
              klic,
              chyba: (err.stderr?.toString() ?? "").trim().split("\n")[0] || "sh -n selhal",
            });
          }
        }
      }
    }

    // Druhá polovina „mlčení je nález": kdyby se rozbil extraktor (jiný tvar
    // healthchecku, jiné jméno klíče), prohlédnuto by kleslo k nule a seznam
    // nálezů by byl prázdný — což vypadá stejně jako „vše v pořádku".
    expect(
      prohlednuto,
      "brána neprohlédla prakticky žádný příkaz — extraktor je rozbitý, ne strom čistý",
    ).toBeGreaterThan(80);

    expect(
      nalezy.map((n) => `${n.soubor} :: ${n.sluzba} :: ${n.klic} → ${n.chyba}`),
      "Shellový kód v compose se nerozparsuje. V kontejneru se to projeví až za běhu:\n" +
        "healthcheck zčervená napořád (a vlna se nikdy neprokáže zdravím), command\n" +
        "spadne hned po startu. Pozor na skládaný skalár `>-`: řádek odsazený VÍC než\n" +
        "první se NESLEPÍ a nový řádek před ním zůstane.",
    ).toEqual([]);
  });
});
