/**
 * Ověření patří fázi, která jeho kanál vyrábí (CLASS gate)
 *
 * TŘÍDA VADY: fáze ověřuje stav přes kanál, který zavádí až fáze POZDĚJŠÍ.
 * Ověření pak nemůže nikdy projít, hlásí nepravdivého viníka („služba
 * neběží"), a protože je fail-closed, zruší i fáze, které by ten kanál
 * vyrobily. Čtvrtý naměřený výskyt téže rodiny během jednoho dne
 * (mesh pojistka ve vlně 2 · brána nad nenasazenou aplikací · MESH_ENABLED
 * bez deklarace · tohle).
 *
 * Naměřeno 2026-08-09 na --wipe deployi: Phase B četla migration_log_dump přes
 * https://${API_DOMAIN_PUBLIC} — tedy edge → mesh-router → CORE_MESH_IP. Ta
 * cesta vzniká až vlnou 5 (Phase E: edge re-enroll s mesh IP). Hlásilo se
 * „PostgREST/api is not serving in Phase B" — nepravdivá atribuce: naměřeno
 * web=200 (edge slouží), core=starting, netbird=nenasazený (vlna 4). Core
 * nebyl rozbitý; chyběl mesh, protože ještě neměl být.
 *
 * Táž Phase B přitom vzor umí SPRÁVNĚ: KC brána jde přes
 * KEYCLOAK_DOMAIN_DIRECT s komentářem „NOT the mesh host … mesh not up yet".
 * Oprava = re-migrate+verify blok přesunut do Phase G (za vlnu 5), kde jeho
 * kanál existuje; KC-fail sémantika zachována přes _kc_gate_ok.
 *
 * DRUHÁ POLOVINA (táž třída, jiná vrstva): identita instance deklarovaná
 * v .env.local přicházela POZDĚ — STORY/MANIFEST se počítaly před jeho
 * načtením, běh končil na „Missing …/.manifest" (příznak) a jediné „řešení"
 * byl ruční export (přesně to, co je zakázané). Import identity teď běží
 * PŘED výpočtem STORY a chybová hláška jmenuje příčinu.
 *
 * ⚠️ POUČENÍ Z 2026-08-13: test té druhé poloviny si původně pinoval LITERÁL
 * `sed -n 's/^APP_NAME_PREFIX=//p' "$ENV_LOCAL"`. Měřil tím tvar JEDNOHO kanálu,
 * ne vlastnost „identita je k dispozici dřív, než se z ní počítá" — a zelenou
 * dával i ve chvíli, kdy instance deklarující identitu ve vaultu pro cold-start
 * neexistovala a wipe na ní padal. Pin tedy vadu ZAKONZERVOVAL. Test níž proto
 * pinuje jen POŘADÍ (delegace vs výpočet STORY); matici kanálů měří chováním
 * identita-ma-jeden-domov.gate.test.ts.
 *
 * Obecná fázová korektnost se staticky dokázat nedá — tahle brána PINuje
 * konkrétní naměřené případy + drží pořadí textově. To říkám rovnou, aby
 * zelená nevypadala jako důkaz víc, než čím je.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COLD_START = join(ROOT, "scripts", "aisha-cold-start.sh");

function src(): string {
  return readFileSync(COLD_START, "utf-8");
}

/** Index prvního výskytu; -1 když chybí. Exportováno kvůli negativním testům. */
export function idx(hay: string, needle: string): number {
  return hay.indexOf(needle);
}

describe("ověření patří fázi, která jeho kanál vyrábí", () => {
  test("migration_log_dump verify běží až PO vlně 5 (kanál = edge mesh-router)", () => {
    const t = src();
    const verifyAt = idx(t, "_mig_api=");
    const wave5At = idx(t, "--from=${AISHA_WAVE_PHASE_D_FROM}");
    expect(verifyAt, "_mig_api verify blok nenalezen").toBeGreaterThan(-1);
    expect(wave5At, "spuštění vln od 5 nenalezeno").toBeGreaterThan(-1);
    expect(
      verifyAt,
      "verify čte api přes mesh-router; před vlnou 5 měří kanál, který neexistuje, " +
        "a fail-closed pak zruší i fáze, které by ho vyrobily (naměřeno 2026-08-09)",
    ).toBeGreaterThan(wave5At);
  });

  test("Phase B nesahá na mesh-závislý api kanál", () => {
    const t = src();
    const b = t.slice(idx(t, "Phase B: KC realm"), idx(t, "Phase C: dynamic DB+OIDC"));
    expect(b.length).toBeGreaterThan(100);
    expect(b.includes("migration_log_dump"), "Phase B nesmí číst postgrest přes mesh").toBe(false);
    expect(b.includes("API_DOMAIN_PUBLIC"), "Phase B nesmí mířit na veřejné api (mesh hop)").toBe(false);
  });

  test("přesun zachovává KC-fail sémantiku (nezastavuje běh, ne nový hard-fail)", () => {
    const t = src();
    expect(/_kc_gate_ok=1/.test(t), "úspěch KC brány se musí zaznamenat").toBe(true);
    const g = t.slice(idx(t, "Phase G: operator provisioning"));
    expect(g.length).toBeGreaterThan(100);
    const vetev = /_kc_gate_ok:-0[^\n]*!= "1"[^\n]*\n([\s\S]{0,220}?)\n\s*else/.exec(g)?.[1] ?? "";
    // Od 2026-09-13 se KC-fail zapíše do NEDOKONCENO (konec běhu nenulou), aby
    // neprošel jako hotový — ale běh NEZASTAVÍ. Přitvrzení, které brána zakazuje,
    // je zastavení (`exit`), ne to, že se nedokončené přizná.
    expect(vetev, "KC-fail větev nenalezena").not.toBe("");
    expect(/\bexit\b/.test(vetev), "KC-fail větev nesmí zastavit běh — přesun nesmí přitvrdit").toBe(false);
    expect(/warn |nedokonceno /.test(vetev), "KC-fail větev musí být slyšet (warn/nedokonceno)").toBe(true);
  });

  test("identita se zjišťuje PŘED výpočtem STORY/MANIFEST", () => {
    const t = src();
    // Pinuje se POŘADÍ, ne kanál: který soubor identitu nese, je věcí sdíleného
    // řetězu (lib/coolify-instance-scope.mjs), a měří se chováním jinde.
    const zjisteniAt = idx(t, "declare_instance_identity");
    const storyAt = idx(t, 'STORY="${AISHA_STORY:-${APP_NAME_PREFIX:-}}"');
    expect(zjisteniAt, "zjištění identity nenalezeno — cold-start ho musí volat").toBeGreaterThan(-1);
    expect(storyAt, "výpočet STORY nenalezen").toBeGreaterThan(-1);
    expect(
      zjisteniAt,
      "deklarace musí platit dřív, než se z STORY odvodí cesta k manifestu — " +
        "jinak je jediné řešení ruční export (reprodukováno 2026-08-09 i 2026-08-13)",
    ).toBeLessThan(storyAt);
  });

  test("chybějící manifest jmenuje příčinu, když je prázdná identita", () => {
    const t = src();
    const miss = t.slice(idx(t, 'if [ ! -f "$MANIFEST" ]'), idx(t, 'if [ ! -f "$MANIFEST" ]') + 900);
    expect(
      miss.includes("Identita instance NENÍ deklarovaná"),
      "hláška o .manifest bez jména instance je příznak; příčina je nedeklarovaná identita",
    ).toBe(true);
  });

  // Negativní testy — brána, která nemůže padnout, není brána.
  test("pořadový helper skutečně rozlišuje pořadí", () => {
    const sample = "AAA --from=5 BBB _mig_api= CCC";
    expect(idx(sample, "_mig_api=")).toBeGreaterThan(idx(sample, "--from=5"));
    const wrong = "AAA _mig_api= BBB --from=5 CCC";
    expect(idx(wrong, "_mig_api=")).toBeLessThan(idx(wrong, "--from=5"));
  });
});
