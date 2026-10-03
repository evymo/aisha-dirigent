/**
 * Brána: cold-start ověřuje zdraví aplikace, kterou MANIFEST nasazuje — ne jméno
 * napsané rukou.
 *
 * ⛔ NAMĚŘENO 2026-09-13 (dry-run cold-startu nad guru, před obnovou 21 aplikací):
 * krok 6 čekal na `coolify_app_healthy aisha-n8n`. Manifest ale nasazuje n8n jako
 * `orchestration`, takže aplikace se jmenuje `<prefix>-orchestration` — a
 * `aisha-n8n` nebyla žádná. Čekání by 5 minut dotazovalo nic a skončilo `exit 1`
 * („n8n not ready"); s ním by se nespustil smoke test, kontrola domén, embed
 * kickstart, úklid warmupu ani restart validace. n8n je přitom základ platformy.
 *
 * Třída: ověřovač dostane literál místo odvozeniny. Literál nic nekontroluje —
 * neexistující jméno je nerozlišitelné od „ještě nenaběhlo". Proto se měří
 * VLASTNOST: žádné volání `coolify_app_healthy` (ani seznam, který mu jména
 * podává) nesmí nést jméno aplikace napevno, a n8n se hledá podle compose
 * souboru, který manifest platformy opravdu nasazuje.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COLD_START = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");
const MANIFEST = readFileSync(join(ROOT, "coolify/manifests/aisha.manifest"), "utf8");

/** Kódové řádky (bez komentářů) s voláním ověřovače nebo se smyčkou, která mu podává jména. */
function literalyOverovace(sh: string): string[] {
  const nalezy: string[] = [];
  const radky = sh.split("\n");
  radky.forEach((radek, i) => {
    if (/^\s*#/.test(radek)) return;
    const volani = /coolify_app_healthy\s+([^\s;)]+)/.exec(radek);
    if (volani && !/^"?\$/.test(volani[1])) nalezy.push(`ř. ${i + 1}: ${radek.trim()}`);
    const smycka = /^\s*for\s+(\w+)\s+in\s+(.+?);\s*do\s*$/.exec(radek);
    if (smycka) {
      // Smyčka se počítá, jen když její proměnná míří do ověřovače v těle smyčky.
      const telo = radky.slice(i + 1, i + 12).join("\n");
      const krmiOverovac = new RegExp(`coolify_app_healthy\\s+"?\\$\\{?${smycka[1]}\\b`).test(telo);
      const literaly = smycka[2].split(/\s+/).filter((t) => t && !/^"?\$/.test(t));
      if (krmiOverovac && literaly.length) nalezy.push(`ř. ${i + 1}: ${radek.trim()}`);
    }
  });
  return nalezy;
}

describe("cold-start ověřuje aplikaci z manifestu (brána)", () => {
  test("univerzum není prázdné — ověřovač se v cold-startu opravdu volá", () => {
    expect(COLD_START.match(/coolify_app_healthy\s+\S/g)?.length ?? 0).toBeGreaterThan(1);
  });

  test("žádné volání ověřovače nenese jméno aplikace napevno", () => {
    expect(
      literalyOverovace(COLD_START),
      "ověřovač zdraví dostává literál — neexistující jméno je nerozlišitelné od „ještě nenaběhlo\",\n" +
        "čekání vyprší a cold-start skončí dřív, než udělá zbytek. Jméno odvoď z manifestu\n" +
        "(aplikace_podle_compose <compose>), ne rukou.",
    ).toEqual([]);
  });

  test("sonda jde rozsvítit — původní tvar z 2026-09-13 by brána chytila", () => {
    const puvodni = [
      "  for i in $(seq 1 60); do",
      "    if coolify_app_healthy aisha-n8n; then",
      "  done",
      "  for _app in aisha-n8n; do",
      "    if coolify_app_healthy \"$_app\"; then",
    ].join("\n");
    expect(literalyOverovace(puvodni)).toHaveLength(2);
  });

  test("n8n se hledá podle compose, který manifest platformy nasazuje — a bez něj se končí nahlas", () => {
    const odvozeni = /N8N_APP="\$\(aplikace_podle_compose (docker-compose\.[a-z0-9.-]+\.yml)\)"/.exec(COLD_START);
    expect(odvozeni, "krok 6 neodvozuje aplikaci n8n z manifestu").not.toBeNull();
    const compose = odvozeni![1];
    expect(
      new RegExp(`^app:\\s*[a-z0-9-]+:[a-z0-9-]+:${compose.replace(/\./g, "\\.")}(:|\\s*$)`, "m").test(MANIFEST),
      `manifest platformy nenasazuje ${compose} — odvození by v kroku 6 nenašlo nic`,
    ).toBe(true);
    const i = COLD_START.indexOf(odvozeni![0]);
    expect(COLD_START.slice(i, i + 400), "chybějící n8n v manifestu nekončí exit 1").toMatch(/exit 1/);
  });
});
