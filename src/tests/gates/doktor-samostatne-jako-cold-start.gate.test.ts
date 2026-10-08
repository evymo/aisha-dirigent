/**
 * BRÁNA: env-doktor puštěný SAMOSTATNĚ zapíše tentýž trezor jako pod cold-startem
 * — a nikdy nezapíše doslovný `${…}` ani URL bez hostitele.
 *
 * ⛔ NAMĚŘENO 2026-09-24 (<fork>, doktor puštěný samostatně podle runbooku
 *    „dry-run napřed"): do trezoru šly doslovné
 *    `STORAGE_PUBLIC_URL=https://${API_DOMAIN_PUBLIC:-}/storage/v1` a
 *    `WEB_PUSH_VAPID_SUBJECT=https://${APP_DOMAIN:-}`. coolify-sync-envs `${…}`
 *    nerozbaluje — do Coolify by šly doslovně. Nad čistým trezorem jich doktor
 *    samostatně vyrobil 42 a od běhu pod cold-startem se lišil ve 44 klíčích;
 *    pod cold-startem zase zapsal `NETBIRD_API_URL=https://` (bez hostitele).
 *
 * Příčina byla v pořadí, ne v datech: loadDomains() běžel PŘED loadTopologyEnv()
 * a u sebeodkazu `X=${X:-}` vracel syrovou šablonu. Cold-start přitom nejdřív
 * sourcuje derivaci a pak `set -a; . domains.env`. Brána proto pinuje VLASTNOST,
 * ne dva klíče: týž čistý trezor samostatně i pod (napodobeným) cold-startem →
 * totožné hodnoty, 0× `${`, 0× URL bez hostitele.
 *
 * Rozhodnutí „nezapsat" má JEDINÝ domov — stráž env-doktora (NEROZVINUTÁ ŠABLONA,
 * lib/domeny-rozbal.mjs nesmiDoTrezoru). Tahle brána ji nezdvojuje, jen měří, že
 * ji kořen (rozbalení po derivaci) nechá zasáhnout jen tam, kde chybí vstup.
 *
 * ⛔ NAMĚŘENO 2026-09-28: bez identity vydá derivace `APP_NAME_PREFIX=aisha`, bez
 * PUBLIC_TLD `APP_DOMAIN=web.aisha.example.com` — obojí z referenčního
 * `.json.example`. dom() takovou derivaci číst NESMÍ (kontrolní vzorky a/b dole).
 *
 * Náhodné klíče (tajemství a hodnoty z nich skládané) se poznají empiricky —
 * liší se už mezi dvěma samostatnými běhy. Hodnoty se ve zprávách NEVYPISUJÍ,
 * jen jména klíčů: tajemství fixtury nemají v logu CI co dělat.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { envDoktorDokoncil } from "./_env-doktor-dokoncil";

const ROOT = path.resolve(__dirname, "../../..");
const DOCTOR = path.join(ROOT, "scripts/aisha-env-doctor.mjs");
const DERIVE = path.join(ROOT, "scripts/lib/derive-domains.mjs");
const ZALOHY = path.join(ROOT, ".backup");

// Vstupy derivace, jaké operátor dává do .env-prod-backup (derive-domains to sám
// radí ve varování). Cookie domény JSOU povinné: referenční profil
// cloud-single.json.example je nese jako `.${SINGLE_HOST_SERVER:-backend}…`
// v jednoduchých uvozovkách — doslovně i pod cold-startem (viz negativní sonda).
const VSTUP: Record<string, string> = {
  AISHA_PROFILE: "cloud-single",
  PUBLIC_TLD: "zkouska.test",
  APP_NAME_PREFIX: "zkouska",
  OAUTH2_COOKIE_DOMAINS: ".zkouska.test",
  OAUTH2_WHITELIST_DOMAINS: ".zkouska.test",
};

// Barvy výstupu doktora — týž zápis jako cold-start-doctor.gate (bez řídicího znaku v literálu).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const docasne: string[] = [];
const semena = new Set<string>();

function prostredi(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Čisté prostředí: měří se repo, ne proměnné runneru (REGISTRY_PROXY, MESH_ENABLED…).
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? tmpdir(), ...VSTUP, ...extra };
}

function novyTrezor(obsah?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aisha-doktor-cold-"));
  docasne.push(dir);
  const soubor = path.join(dir, "env.test");
  // Čistý start = soubor NEEXISTUJE. Existující prázdný soubor doktor správně
  // odmítne jako rozepsaný zápis jiného procesu.
  if (obsah !== undefined) { writeFileSync(soubor, obsah); semena.add(obsah); }
  return soubor;
}

function beh(argv: string[], env: NodeJS.ProcessEnv): { status: number; vystup: string } {
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT, encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env,
  });
  if (r.error || r.signal) {
    throw new Error(`podproces nedoběhl — NENÍ to měření: ${r.error?.message ?? r.signal}`);
  }
  return { status: r.status ?? -1, vystup: `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(ANSI, "") };
}

function cti(soubor: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(soubor)) return out;
  for (const l of readFileSync(soubor, "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const sOdkazem = (t: Map<string, string>) => [...t].filter(([, v]) => v.includes("${")).map(([k]) => k).sort();
const bezHostu = (t: Map<string, string>) =>
  [...t].filter(([, v]) => /(^|,)"?[a-z][a-z0-9+.-]*:\/\/("|$|\/|,)/i.test(v)).map(([k]) => k).sort();

function samostatne(): { trezor: Map<string, string>; status: number; vystup: string } {
  const soubor = novyTrezor();
  const r = beh([process.execPath, DOCTOR], prostredi({ ENV_FILE: soubor }));
  return { trezor: cti(soubor), ...r };
}

/** Cold-start ~ř. 1005–1030: derivace → set -a; . topo; . domains.env; topo ZNOVU → doktor. */
function podColdStartem(): { trezor: Map<string, string>; status: number; vystup: string } {
  const soubor = novyTrezor();
  const topoDir = mkdtempSync(path.join(tmpdir(), "aisha-topo-"));
  docasne.push(topoDir);
  const topo = path.join(topoDir, "topo.env");
  const d = beh([process.execPath, DERIVE, "--shell"], prostredi());
  expect(d.status, `derive-domains --shell selhal:\n${d.vystup.slice(-800)}`).toBe(0);
  writeFileSync(topo, d.vystup.split("\n").filter((l) => /^([A-Z_][A-Z0-9_]*=|#)/.test(l)).join("\n") + "\n");
  // Cold-start (od 2026-10-05) exportuje, jaký doménový overlay si vyžádal — bez obalu
  // žádný, tedy prázdně. Env-doktor tím pod cold-startem WEB_FQDNS ZNÁ (založí ho).
  const skript = `set -a; . "${topo}"; . config/domains.env; . "${topo}"; set +a; export DOMAINS_OVERLAY_REQUESTED=""; exec "${process.execPath}" "${DOCTOR}"`;
  const r = beh(["bash", "--noprofile", "--norc", "-c", skript], prostredi({ ENV_FILE: soubor }));
  return { trezor: cti(soubor), ...r };
}

afterAll(() => {
  for (const d of docasne) rmSync(d, { recursive: true, force: true });
  if (!existsSync(ZALOHY)) return;
  // Doktor zálohuje existující cílový soubor do ROOT/.backup — smazat jen zálohy
  // NAŠICH semen, nikdy cizí (sdílená pracovní kopie).
  for (const f of readdirSync(ZALOHY)) {
    const p = path.join(ZALOHY, f);
    try { if (semena.has(readFileSync(p, "utf8"))) rmSync(p, { force: true }); } catch { /* cizí/neznámé nechat */ }
  }
});

describe("brána: env-doktor samostatně = pod cold-startem", () => {
  test("VLASTNOST: týž čistý trezor samostatně i pod cold-startem — totožné hodnoty, 0× `${`, 0× URL bez hostitele", () => {
    const a1 = samostatne();
    const a2 = samostatne();
    const b = podColdStartem();
    expect(envDoktorDokoncil(a1.status), `samostatný běh selhal:\n${a1.vystup.slice(-1200)}`).toBe(true);
    expect(b.status, `běh pod cold-startem selhal:\n${b.vystup.slice(-1200)}`).toBe(0);
    // ⭐ JEDINÝ ZÁMĚRNÝ ROZDÍL: WEB_FQDNS zakládá jen cold-start (výslovný požadavek na
    // doménový overlay). Samostatně ho doktor NEZNÁ a nezapíše — prázdný by doktoru domén
    // řekl „jedna značka" (revize 27d6f3f5e). Měří ho redeploy-zna-domeny-webu.
    expect(a1.trezor.has("WEB_FQDNS"), "samostatný běh založil WEB_FQDNS bez cold-startu").toBe(false);
    expect(b.trezor.get("WEB_FQDNS"), "pod cold-startem se WEB_FQDNS nezaložil").toBe("");
    a1.trezor.delete("WEB_FQDNS");
    b.trezor.delete("WEB_FQDNS");

    // Kontrolní vzorek — jinak by prázdný trezor prošel „bez rozdílu".
    expect(a1.trezor.size, "doktor nic nezapsal — brána by měřila nic").toBeGreaterThan(100);
    expect(a1.trezor.get("STORAGE_PUBLIC_URL")).toBe("https://api.zkouska.test/storage/v1");
    expect(a1.trezor.get("WEB_PUSH_VAPID_SUBJECT")).toBe("https://web.zkouska.test");

    const nahodne = new Set([...a1.trezor.keys()].filter((k) => a1.trezor.get(k) !== a2.trezor.get(k)));
    const klice = new Set([...a1.trezor.keys(), ...b.trezor.keys()]);
    const rozdilne = [...klice].filter((k) =>
      !a1.trezor.has(k) || !b.trezor.has(k) || (!nahodne.has(k) && a1.trezor.get(k) !== b.trezor.get(k)),
    ).sort();
    expect(rozdilne, `samostatný běh se liší od cold-startu v: ${rozdilne.join(" ")}`).toEqual([]);

    for (const [nazev, t] of [["samostatně", a1.trezor], ["pod cold-startem", b.trezor]] as const) {
      expect(sOdkazem(t), `${nazev}: doslovné \${…} v hodnotách`).toEqual([]);
      expect(bezHostu(t), `${nazev}: URL bez hostitele`).toEqual([]);
    }
  });

  test("po jednom apply --report --strict nehlásí nic z TŘÍDY (nerozvinutá šablona, URL bez hostu, prázdný alias)", () => {
    const soubor = novyTrezor();
    expect(envDoktorDokoncil(beh([process.execPath, DOCTOR], prostredi({ ENV_FILE: soubor })).status)).toBe(true);
    const r = beh([process.execPath, DOCTOR, "--report", "--strict", "--no-external"], prostredi({ ENV_FILE: soubor }));
    // Zbylá selhání strict (JWT klíče, COOLIFY_URL…) doplňují jiné nástroje — nad
    // čistým trezorem samotný doktor strict projít nemůže a tahle brána to netvrdí.
    expect(r.vystup).not.toMatch(/NEROZVINUTÁ ŠABLONA/);
    expect(r.vystup, "prázdný alias VAPID po apply").not.toMatch(/✗ VITE_WEB_PUSH_VAPID_PUBLIC_KEY \(empty\)/);
    expect(r.vystup, "hláška strict musí být skutečný běh").toMatch(/Summary/);
  });

  test("přítomný a PRÁZDNÝ alias (šablona external-secrets.required.env) se doplní z cíle", () => {
    const soubor = novyTrezor("VITE_WEB_PUSH_VAPID_PUBLIC_KEY=\n");
    const r = beh([process.execPath, DOCTOR], prostredi({ ENV_FILE: soubor }));
    expect(envDoktorDokoncil(r.status), r.vystup.slice(-1200)).toBe(true);
    const t = cti(soubor);
    expect(t.get("WEB_PUSH_VAPID_PUBLIC_KEY") ?? "", "cíl aliasu se nevygeneroval").not.toBe("");
    expect(t.get("VITE_WEB_PUSH_VAPID_PUBLIC_KEY")).toBe(t.get("WEB_PUSH_VAPID_PUBLIC_KEY"));
  });

  test("NEGATIVNÍ SONDA: doslovné `${…}` z referenčního profilu se NEZAPÍŠE — stráž ho jmenuje, zbytek se zapíše", () => {
    // Bez cookie domén vezme derivace cloud-single.json.example, který je nese jako
    // `.${SINGLE_HOST_SERVER:-backend}.internal.example.com` — doslovně.
    const soubor = novyTrezor();
    const env = prostredi({ ENV_FILE: soubor });
    delete env.OAUTH2_COOKIE_DOMAINS;
    delete env.OAUTH2_WHITELIST_DOMAINS;
    const r = beh([process.execPath, DOCTOR], env);
    const t = cti(soubor);
    // Apply bez --strict klíč jen nezapíše a jmenuje (stráž #1094); --strict na tom padá.
    expect(envDoktorDokoncil(r.status), r.vystup.slice(-1200)).toBe(true);
    expect(r.vystup).toMatch(/NEROZVINUTÁ ŠABLONA[\s\S]*✗ OAUTH2_COOKIE_DOMAINS/);
    expect(t.has("OAUTH2_COOKIE_DOMAINS"), "doslovná hodnota se zapsala").toBe(false);
    expect(t.size, "jeden vadný klíč nesmí zablokovat zápis ostatních").toBeGreaterThan(100);
    expect(sOdkazem(t)).toEqual([]);
  });
});

// ── dom() čte derivaci JEN pro TUTO instanci (kontrolní vzorky + mutace, guru 2026-09-28)
// Mutace, které musí bránu shodit (ověřeno ručně, viz PR):
//   (a) `DERIVACE_INSTANCE = IDENTITY && …` bez `IDENTITY &&`  → vzorek (a) červený
//   (b) bez `&& REFERENCNI_DOMENY.length === 0`                → vzorek (b) červený
describe("brána: dom() nečte referenční derivaci", () => {
  function behBez(klic: string) {
    const soubor = novyTrezor();
    const env = prostredi({ ENV_FILE: soubor });
    delete env[klic];
    const r = beh([process.execPath, DOCTOR], env);
    return { ...r, trezor: cti(soubor) };
  }
  function ocekavejNeslozeno(b: ReturnType<typeof behBez>, cizi: string) {
    expect(envDoktorDokoncil(b.status), b.vystup.slice(-1200)).toBe(true);
    expect(b.trezor.size, "doktor nic nezapsal — vzorek by měřil nic").toBeGreaterThan(100);
    expect(b.trezor.get("APP_DOMAIN") ?? "", "APP_DOMAIN z referenční derivace").toBe("");
    // Výchozí hodnota ani složenina se z prázdné domény nesloží — stráž je jmenuje.
    for (const k of ["WEB_PUSH_VAPID_SUBJECT", "VITE_API_URL"]) {
      expect(b.trezor.get(k) ?? "", `${k} nese hodnotu bez domény instance`).toBe("");
      expect(b.vystup, `stráž nejmenovala ${k}`).toMatch(new RegExp(`NEROZVINUTÁ ŠABLONA[\\s\\S]*✗ ${k}\\b`));
    }
    // Kontrolní vzorek, že derivace cizí hodnotu OPRAVDU vydala (jinak by vzorek nic neměřil):
    // derivedTopo ji smí vzít pro odvozené klíče — dom() ne.
    expect([...b.trezor.values()].some((v) => v.includes(cizi)), `derivace nevydala „${cizi}" — vzorek je slepý`).toBe(true);
  }

  test("(a) BEZ IDENTITY (PUBLIC_TLD dané) — derivace je referenční prefix `aisha`, dom() ji nečte", () => {
    ocekavejNeslozeno(behBez("APP_NAME_PREFIX"), "web.zkouska.test");
  });

  test("(b) identita známá, PUBLIC_TLD z `.json.example` — `web.aisha.example.com` se nezapíše", () => {
    ocekavejNeslozeno(behBez("PUBLIC_TLD"), "aisha.example.com");
  });
});
