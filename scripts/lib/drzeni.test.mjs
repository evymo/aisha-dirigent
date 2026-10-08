/**
 * drzeni.sh — shellový čtenář deklarace držení (studený start, sync env, deploy-init,
 * story-init, doktor). Měří se CHOVÁNÍ skutečného souboru v bashi: načtení přes
 * skutečný domov (nasazeni-drzene.mjs), odpověď `drzena`, a hlavně fail-closed —
 * nenačtená deklarace ani uříznutý výstup validátoru nesmí znamenat „nic drženo“.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OVERLAY_ENV } from "./instance-overlay.mjs";
import { SOUBOR } from "./nasazeni-drzene.mjs";

const ROOT = process.cwd();
const LIB = join(ROOT, "scripts/lib/drzeni.sh");

const polozka = (o = {}) => ({
  aplikace: "web-render",
  duvod: "zkušební důvod držení",
  rozhodnuti: { kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28" },
  ...o,
});

function overlay(obsah) {
  const d = mkdtempSync(join(tmpdir(), "drzeni-sh-"));
  if (obsah !== undefined) writeFileSync(join(d, SOUBOR), typeof obsah === "string" ? obsah : JSON.stringify(obsah));
  return d;
}

/** Spustí shellový úryvek se zdrojovanou knihovnou v ČISTÉM prostředí (+ co test deklaruje). */
function bash(skript, env = {}, cestaNavic = "") {
  const r = spawnSync("bash", ["-c", `set -euo pipefail\n. "${LIB}"\n${skript}`], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: `${cestaNavic ? `${cestaNavic}:` : ""}${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      ...env,
    },
    timeout: 60_000,
  });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}

/** Podvržený `node`: místo domova vypíše daný text a skončí daným kódem. */
function falesnyNode(vystup, kod = 0) {
  const bin = mkdtempSync(join(tmpdir(), "drzeni-node-"));
  mkdirSync(bin, { recursive: true });
  const soubor = join(bin, "vystup.txt");
  writeFileSync(soubor, vystup);
  writeFileSync(join(bin, "node"), `#!/bin/sh\ncat "${soubor}"\nexit ${kod}\n`);
  chmodSync(join(bin, "node"), 0o755);
  return bin;
}

const DOTAZ = `
drzeni_nacti test || { echo "NACTENI=selhalo"; exit 7; }
echo "POPIS=$DRZENI_POPIS"
for r in web-render local-ingest core; do
  if drzena "$r"; then echo "$r=ANO|$(drzeni_hlaska "$r")"; else echo "$r=NE"; fi
done
echo "VYPIS=$(drzeni_vypis | wc -l | tr -d ' ')"
`;

describe("drzeni.sh nad skutečným domovem", { timeout: 60_000 }, () => {
  it("držené aplikace: drzena = 0 jen pro ně, hláška je text domova", () => {
    const r = bash(DOTAZ, { [OVERLAY_ENV]: overlay([polozka(), polozka({ aplikace: "local-ingest" })]) });
    expect(r.rc, r.err).toBe(0);
    expect(r.out).toMatch(/^web-render=ANO\|DRŽENO: web-render — zkušební důvod držení — rozhodnutí majitel 2026-09-28 \(rozhodnutí 2026-09-28\); drženo od 2026-09-28 \(\d+ dní\)$/m);
    expect(r.out).toMatch(/^local-ingest=ANO\|DRŽENO: local-ingest — /m);
    expect(r.out).toMatch(/^core=NE$/m);
    expect(r.out).toMatch(/^POPIS=nasazeni-drzene\.json v overlayi instance: drženo 2 \(web-render, local-ingest\)$/m);
    expect(r.out).toMatch(/^VYPIS=2$/m);
  });

  it("instance bez overlaye a overlay bez souboru = nic drženo — a popis říká které", () => {
    const bez = bash(DOTAZ);
    expect(bez.rc, bez.err).toBe(0);
    expect(bez.out).toMatch(/^POPIS=instance nemá overlay .* nic drženo$/m);
    expect(bez.out).toMatch(/^web-render=NE$/m);
    const prazdny = bash(DOTAZ, { [OVERLAY_ENV]: overlay() });
    expect(prazdny.rc, prazdny.err).toBe(0);
    expect(prazdny.out).toMatch(/^POPIS=overlay instance nasazeni-drzene\.json nemá — nic drženo$/m);
    expect(prazdny.out).toMatch(/^web-render=NE$/m);
  });

  it("⛔ nečitelná nebo neplatná deklarace: drzeni_nacti ≠ 0 a důvod jde na stderr", () => {
    for (const obsah of ["{nejde", [polozka({ duvod: "" })], [polozka({ aplikace: "core" })]]) {
      const r = bash(DOTAZ, { [OVERLAY_ENV]: overlay(obsah) });
      expect(r.rc, JSON.stringify(obsah)).toBe(7);
      expect(r.out).toMatch(/^NACTENI=selhalo$/m);
      expect(r.out).not.toMatch(/=NE$/m);
      expect(r.err).toMatch(/::error title=deklarace držení (NEČITELNÁ|NEPLATNÁ)::/);
    }
  });

  it("⛔ drzena před načtením ukončí skript — „není držená“ od nenačtené deklarace by bylo fail-open", () => {
    const r = bash(`if drzena web-render; then echo ANO; else echo NE; fi\necho "POKRACUJE"`);
    expect(r.rc).toBe(1);
    expect(r.out).not.toMatch(/NE|ANO|POKRACUJE/);
    expect(r.err).toMatch(/deklarace nebyla načtena/);
    // …a po NEÚSPĚŠNÉM načtení taky (volající, který návratový kód přehlédl)
    const po = bash(`drzeni_nacti test || true\nif drzena web-render; then echo ANO; else echo NE; fi\necho "POKRACUJE"`, { [OVERLAY_ENV]: overlay("{nejde") });
    expect(po.rc).toBe(1);
    expect(po.out).not.toMatch(/NE|ANO|POKRACUJE/);
  });

  it("env-soubor se předá domovu (deklarace overlaye pro samostatně spuštěný nástroj)", () => {
    const d = overlay();
    const envSoubor = join(d, "env.instance");
    writeFileSync(envSoubor, `AISHA_INSTANCE_DATA_GIT_URL=file://${join(d, "neexistuje.git")}#main\n`);
    const r = bash(`drzeni_nacti test "${envSoubor}" || { echo "NACTENI=selhalo"; exit 7; }\necho "POPIS=$DRZENI_POPIS"`);
    expect(r.rc).toBe(7);
    expect(r.err).toMatch(/instance deklaruje vlastní overlay/);
  });
});

describe("drzeni.sh: výstup validátoru se přijme jen ÚPLNÝ (patička = důkaz)", { timeout: 60_000 }, () => {
  const dotaz = `drzeni_nacti test || { echo "NACTENI=selhalo"; exit 7; }\nif drzena web-render; then echo ANO; else echo NE; fi`;

  it("kontrolní vzorek: úplný výstup podvrženého validátoru projde", () => {
    const r = bash(dotaz, {}, falesnyNode("web-render\tDRŽENO: web-render — x\n__DRZENI_END__\t1\tfixture\n"));
    expect(r.rc, r.err).toBe(0);
    expect(r.out.trim()).toBe("ANO");
  });

  it("⛔ prázdný výstup s kódem 0 není „nic drženo“", () => {
    const r = bash(dotaz, {}, falesnyNode(""));
    expect(r.rc).toBe(7);
    expect(r.err).toMatch(/bez patičky/);
  });

  it("⛔ uříznutý výstup (řádky bez patičky) a nesouhlasný počet = selhání", () => {
    const bezPaticky = bash(dotaz, {}, falesnyNode("web-render\tDRŽENO: web-render — x\n"));
    expect(bezPaticky.rc).toBe(7);
    expect(bezPaticky.err).toMatch(/bez patičky/);
    const pocet = bash(dotaz, {}, falesnyNode("web-render\tDRŽENO: web-render — x\n__DRZENI_END__\t2\tfixture\n"));
    expect(pocet.rc).toBe(7);
    expect(pocet.err).toMatch(/neúplný \(patička hlásí 2, řádků 1\)/);
  });

  it("⛔ nenulový kód validátoru = selhání, i kdyby něco vypsal", () => {
    const r = bash(dotaz, {}, falesnyNode("__DRZENI_END__\t0\tfixture\n", 1));
    expect(r.rc).toBe(7);
  });
});
