#!/usr/bin/env node
/**
 * ci-kontrakt.mjs — tajemství a proměnné, které čtou workflow CI (Forgejo
 * Actions), odkud se berou a jestli je repo opravdu MÁ.
 *
 * ⛔ NAMĚŘENO 2026-09-27 na upstream mainu: workflow odkazují 49 jmen
 * (`secrets.X`, `vars.X`) a ~35 z nich neexistuje v repu, ve forku ani
 * v organizaci. Krok se pak spustí s PRÁZDNOU hodnotou — a nic to neřekne.
 * Env-doktor hlídá env pro Coolify, cold-start doktor jen dosažitelnost
 * Forgeja; otázku „má repo všechno, co jeho CI čte?“ nekladl nikdo.
 * (Majitel 2026-09-26: token balíčků kiosku ať zná doktor i warmup.)
 *
 * Tenhle modul je JEDINÉ místo, kde se na ni odpovídá:
 *   · KONTRAKT_CI — co CI čte a ODKUD to pochází. Zdroj „trezor“ jen ODKAZUJE
 *     na klíč z kontraktu aisha-env-doctor (týž název) — druh ani odvození se
 *     tu nekopírují; brána `ci-kontrakt` hlídá, že klíč v doktorovi existuje.
 *   · report — kontrakt × Forgejo (repo + organizace, JEN JMÉNA) × trezor
 *     (má hodnotu?) × ověřovače (zásuvné funkce nad hodnotou z trezoru).
 *   · apply — trezor → Forgejo (PUT secret / variable). Mění trvalou
 *     konfiguraci repa, proto JEN ručně, s výslovným potvrzením repa pro
 *     každý běh; nikdy z CI ani z warmupu. Hodnoty z Forgeja zpět vyčíst nejde
 *     a nezkouší se to.
 *
 * Hodnoty se NIKDY nevypisují — ani délky, ani otisky. Jen jména a akce.
 *
 * Oprávnění: výpis tajemství a proměnných repa i organizace vyžaduje token
 * SPRÁVCE repa/organizace (Forgejo vrací 403 jinak); stačí scope
 * `read:repository` + `read:organization`, pro `apply` `write:repository`.
 * Bez oprávnění je výsledek NEMĚŘENO, ne prázdný seznam.
 *
 * CLI:
 *   node scripts/lib/ci-kontrakt.mjs --repo <vlastník/repo> [--env-file <trezor>]
 *   node scripts/lib/ci-kontrakt.mjs --repo <v/r> --env-file <trezor> --apply --potvrzuji <v/r>
 * Prostředí: FORGEJO_URL (nebo --forgejo <url>), FORGEJO_TOKEN.
 *
 * Návratový kód (jako povinne-promenne): 0 = vše sedí · 1 = nález ·
 * 2 = NEMĚŘENO (Forgejo nečitelné, chybný vstup) · 3 = bez nálezu, ale část
 * změřit nešla (trezor, ověřovač).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { parseEnvFile } from "./config-env-files.mjs";
import { porovnej } from "./razeni.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Co CI čte a odkud. Pole:
 *   jmeno   — jméno v Forgeju (secrets.X / vars.X)
 *   druh    — "secret" | "var"
 *   zdroj   — { trezor: "KLIC" } (klíč kontraktu aisha-env-doctor) | "externi"
 *             (vydává člověk/správce mimo trezor; apply ho nedoplní)
 *   povinne — bez něj workflow nefunguje (nález), jinak jen upozornění
 *   overeni — volitelné jméno ověřovače (OVEROVACE níž) nad hodnotou z trezoru
 *   ucel    — proč ho CI potřebuje (pro člověka, který ho zadává)
 *
 * Co tu (zatím) není, stojí v ráčně src/tests/gates/ci-kontrakt.baseline.json
 * — jako MNOŽINA jmen: vypadnout smí, přibýt ne.
 */
export const KONTRAKT_CI = [
  { jmeno: "COOLIFY_URL", druh: "secret", zdroj: { trezor: "COOLIFY_URL" }, povinne: true, ucel: "nasazení a stav aplikací přes Coolify API" },
  { jmeno: "COOLIFY_API_TOKEN", druh: "secret", zdroj: "externi", povinne: true, ucel: "nasazení přes Coolify API (token vydává Coolify)" },
  { jmeno: "APP_NAME_PREFIX", druh: "var", zdroj: { trezor: "APP_NAME_PREFIX" }, povinne: true, ucel: "identita instance pro jména aplikací (bez ní nasazení STOP)" },
  { jmeno: "REGISTRY_PROXY", druh: "var", zdroj: { trezor: "REGISTRY_PROXY" }, povinne: false, ucel: "centrální cache obrazů" },
  { jmeno: "INSTANCE_OVERLAY_REPO", druh: "secret", zdroj: "externi", povinne: false, ucel: "repo dat instance (host/vlastník/repo) pro overlay v CI" },
  { jmeno: "REPO_API_TOKEN", druh: "secret", zdroj: "externi", povinne: false, ucel: "čtení repa dat instance v CI" },
  { jmeno: "API_DOMAIN_PUBLIC", druh: "secret", zdroj: { trezor: "API_DOMAIN_PUBLIC" }, povinne: false, ucel: "ověření nasazení (deploy.yml)" },
  { jmeno: "APP_DOMAIN", druh: "secret", zdroj: { trezor: "APP_DOMAIN" }, povinne: false, ucel: "ověření nasazení (deploy.yml)" },
  { jmeno: "KEYCLOAK_DOMAIN", druh: "secret", zdroj: { trezor: "KEYCLOAK_DOMAIN" }, povinne: false, ucel: "ověření nasazení (deploy.yml)" },
  { jmeno: "KEYCLOAK_REALM", druh: "secret", zdroj: { trezor: "KEYCLOAK_REALM" }, povinne: false, ucel: "ověření nasazení (deploy.yml)" },
  { jmeno: "POSTGREST_URL", druh: "secret", zdroj: { trezor: "POSTGREST_URL" }, povinne: false, ucel: "ověření nasazení (deploy.yml)" },
  { jmeno: "POSTGREST_SERVICE_TOKEN", druh: "secret", zdroj: { trezor: "POSTGREST_SERVICE_TOKEN" }, povinne: false, ucel: "servisní volání PostgREST z CI" },
  { jmeno: "ANTHROPIC_API_KEY", druh: "secret", zdroj: { trezor: "ANTHROPIC_API_KEY" }, povinne: false, ucel: "testy s modelem (ci.yml)" },
  { jmeno: "OPENAI_API_KEY", druh: "secret", zdroj: { trezor: "OPENAI_API_KEY" }, povinne: false, ucel: "testy s modelem (ci.yml)" },
  { jmeno: "GOOGLE_AI_API_KEY", druh: "secret", zdroj: { trezor: "GOOGLE_AI_API_KEY" }, povinne: false, ucel: "testy s modelem (ci.yml)" },
  { jmeno: "FORGEJO_TOKEN", druh: "secret", zdroj: { trezor: "FORGEJO_TOKEN" }, povinne: false, ucel: "vydání (claude-app-release.yml)" },
  { jmeno: "KIOSK_BALICKY_TOKEN", druh: "secret", zdroj: "externi", povinne: true, ucel: "balíčky kiosku: registr a úložiště APK (kiosk-balicky.yml)" },
  { jmeno: "HLIDAC_KEYSTORE_B64", druh: "secret", zdroj: "externi", povinne: true, ucel: "podpis Kiosk Admin — keystore (kiosk-balicky.yml); otisk certifikátu je v QR tabletů, nový klíč = nové zapsání" },
  { jmeno: "HLIDAC_KEYSTORE_PASSWORD", druh: "secret", zdroj: "externi", povinne: true, ucel: "podpis Kiosk Admin — heslo keystore (kiosk-balicky.yml)" },
  { jmeno: "HLIDAC_KEY_ALIAS", druh: "secret", zdroj: "externi", povinne: true, ucel: "podpis Kiosk Admin — alias klíče (kiosk-balicky.yml)" },
  { jmeno: "HLIDAC_KEY_PASSWORD", druh: "secret", zdroj: "externi", povinne: true, ucel: "podpis Kiosk Admin — heslo klíče (kiosk-balicky.yml)" },
  { jmeno: "ANDROID_KEYSTORE_B64", druh: "secret", zdroj: "externi", povinne: true, ucel: "podpis aplikací kiosku (Řidič) — keystore (kiosk-balicky.yml); aktualizace přijme jen týž podpis" },
  { jmeno: "ANDROID_KEYSTORE_PASSWORD", druh: "secret", zdroj: "externi", povinne: true, ucel: "podpis aplikací kiosku — heslo keystore (kiosk-balicky.yml)" },
  { jmeno: "ANDROID_KEYSTORE_ALIAS", druh: "secret", zdroj: "externi", povinne: true, ucel: "podpis aplikací kiosku — alias klíče (kiosk-balicky.yml)" },
  { jmeno: "ANDROID_KEY_PASSWORD", druh: "secret", zdroj: "externi", povinne: true, ucel: "podpis aplikací kiosku — heslo klíče (kiosk-balicky.yml)" },
];

/**
 * Zásuvné ověřovače: async (hodnota z trezoru) → { stav: "ok" | "nesedi" |
 * "nemereno", duvod? }. Nedostupné měřidlo = NEMĚŘENO, nikdy průchod.
 * (První ověřovač — anon-jwt: role == anon + shoda s nasazeným webem — přijde
 * s blokem kiosku, který ho potřebuje.)
 */
export const OVEROVACE = {};

// ─── čisté funkce ───────────────────────────────────────────────────────────

/** Klíče kontraktu aisha-env-doctor ze zdroje (týž tvar jako brána env-doctor-contract-coverage). */
export function klicKontraktuDoktora(zdrojDoktora) {
  return new Map([...String(zdrojDoktora).matchAll(/^\s*\["([A-Z][A-Z0-9_]+)",\s*"([a-z-]+)"/gm)].map((m) => [m[1], m[2]]));
}

/**
 * Co workflow čtou: klíč `druh:jméno` → { druh, jmeno, workflow[] }.
 * Komentáře YAML se přeskočí (zmínka v komentáři není čtení); `GITHUB_TOKEN`
 * dodává Forgejo samo.
 */
export function referenceWorkflow(soubory) {
  const out = new Map();
  for (const { soubor, text } of soubory) {
    const bezKomentaru = String(text).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    for (const m of bezKomentaru.matchAll(/\b(secrets|vars)\.([A-Z_][A-Z0-9_]*)\b/g)) {
      if (m[1] === "secrets" && m[2] === "GITHUB_TOKEN") continue;
      const druh = m[1] === "secrets" ? "secret" : "var";
      const klic = `${druh}:${m[2]}`;
      const z = out.get(klic) ?? { druh, jmeno: m[2], workflow: [] };
      if (!z.workflow.includes(soubor)) z.workflow.push(soubor);
      out.set(klic, z);
    }
  }
  return out;
}

/**
 * Soulad kontraktu s workflow a doktorem (pro bránu).
 * @returns {{ nezarazene: string[], zastaraleVRacne: string[], mrtve: string[], neznamyTrezor: string[], neznamyOverovac: string[], dvojite: string[] }}
 */
export function nalezyKontraktu({ reference, kontrakt, racna, doktor, overovace = OVEROVACE }) {
  const vKontraktu = new Map();
  const dvojite = [];
  for (const p of kontrakt) {
    const k = `${p.druh}:${p.jmeno}`;
    if (vKontraktu.has(k)) dvojite.push(k);
    vKontraktu.set(k, p);
  }
  const vRacne = new Set(racna);
  const nezarazene = [...reference.keys()].filter((k) => !vKontraktu.has(k) && !vRacne.has(k)).sort(porovnej);
  // Ráčna jen ubývá: jméno, které už je v kontraktu nebo ho žádné workflow nečte, z ní musí odejít.
  const zastaraleVRacne = [...vRacne].filter((k) => vKontraktu.has(k) || !reference.has(k)).sort(porovnej);
  const mrtve = [...vKontraktu.keys()].filter((k) => !reference.has(k)).sort(porovnej);
  const neznamyTrezor = kontrakt
    .filter((p) => typeof p.zdroj === "object" && !doktor.has(p.zdroj.trezor))
    .map((p) => `${p.druh}:${p.jmeno} → ${p.zdroj.trezor}`);
  const neznamyOverovac = kontrakt.filter((p) => p.overeni && !overovace[p.overeni]).map((p) => `${p.druh}:${p.jmeno} → ${p.overeni}`);
  return { nezarazene, zastaraleVRacne, mrtve, neznamyTrezor, neznamyOverovac, dvojite };
}

/**
 * Změří kontrakt proti Forgeju a trezoru.
 * @param {object} o
 * @param {object[]} o.kontrakt
 * @param {{ secrets: Set<string>, vars: Set<string> } | null} o.forgejo  null = NEMĚŘENO
 * @param {Map<string,string> | null} o.trezor  null = trezor nedodán
 * @returns {Promise<{ radky: object[], kod: 0|1|2|3 }>}
 */
export async function zmer({ kontrakt, forgejo, trezor, overovace = OVEROVACE }) {
  if (!forgejo) return { radky: [], kod: 2 };
  const radky = [];
  for (const p of kontrakt) {
    const veForgeju = (p.druh === "secret" ? forgejo.secrets : forgejo.vars).has(p.jmeno);
    const zTrezoru = typeof p.zdroj === "object";
    const hodnota = zTrezoru && trezor ? trezor.get(p.zdroj.trezor) : undefined;
    const vTrezoru = !zTrezoru ? "n/a" : trezor === null ? "nemereno" : hodnota ? "ano" : "ne";
    let overeni = "n/a";
    let duvod = "";
    if (p.overeni && zTrezoru) {
      if (!hodnota) overeni = "nemereno";
      else {
        try {
          const v = await overovace[p.overeni](hodnota);
          overeni = v.stav;
          duvod = v.duvod ?? "";
        } catch (e) {
          // Spadlé měřidlo = NEMĚŘENO s důvodem, nikdy průchod. Důvod je text
          // chyby ověřovače, ne hodnota tajemství.
          overeni = "nemereno";
          duvod = `ověřovač ${p.overeni} spadl: ${e?.message ?? e}`;
          console.warn(`ci-kontrakt: ${p.jmeno}: ${duvod}`);
        }
      }
    }
    let stav = "ok";
    if (!veForgeju) stav = p.povinne ? "chybi" : "chybi-nepovinne";
    if (vTrezoru === "ne" && p.povinne) stav = "chybi";
    if (overeni === "nesedi") stav = "nesedi";
    const akce =
      !veForgeju && vTrezoru === "ano" ? `doplnit z trezoru (${p.zdroj.trezor})` :
      !veForgeju && !zTrezoru ? "zadá správce (externí)" :
      vTrezoru === "ne" ? `chybí i v trezoru (${p.zdroj.trezor}) — nejdřív env-doktor` : "";
    radky.push({ druh: p.druh, jmeno: p.jmeno, povinne: !!p.povinne, veForgeju, vTrezoru, overeni, duvod, stav, akce });
  }
  const nalez = radky.some((r) => r.stav === "chybi" || r.stav === "nesedi");
  const castecne = radky.some((r) => r.vTrezoru === "nemereno" || r.overeni === "nemereno");
  return { radky, kod: nalez ? 1 : castecne ? 3 : 0 };
}

/** Co by `apply` zapsal: položky ze zdroje trezor s hodnotou. Existující se PŘEPÍŠE (hodnotu Forgejo nevydá). */
export function planApply({ kontrakt, forgejo, trezor }) {
  return kontrakt
    .filter((p) => typeof p.zdroj === "object" && trezor?.get(p.zdroj.trezor))
    .map((p) => ({
      druh: p.druh,
      jmeno: p.jmeno,
      klic: p.zdroj.trezor,
      akce: (p.druh === "secret" ? forgejo.secrets : forgejo.vars).has(p.jmeno) ? "prepsat" : "pridat",
    }));
}

// ─── Forgejo (I/O přes předaný fetch) ───────────────────────────────────────

/** Jména z jednoho výpisu (stránkovaně). 401/403 = bez oprávnění → výjimka (NEMĚŘENO). */
async function jmena(url, h, f) {
  const out = new Set();
  for (let strana = 1; strana < 50; strana++) {
    const r = await f(`${url}${url.includes("?") ? "&" : "?"}limit=50&page=${strana}`, { headers: h });
    if (r.status === 404) return { jmena: out, chybi: true };
    if (r.status === 401 || r.status === 403) throw new Error(`${new URL(url).pathname}: ${r.status} — token nemá oprávnění správce (read:repository/read:organization)`);
    if (!r.ok) throw new Error(`${new URL(url).pathname}: ${r.status}`);
    const s = await r.json();
    if (!Array.isArray(s)) throw new Error(`${new URL(url).pathname}: odpověď není seznam`);
    for (const x of s) if (x?.name) out.add(x.name);
    if (s.length < 50) break;
  }
  return { jmena: out, chybi: false };
}

/** Tajemství a proměnné viditelné pro repo = repo ∪ organizace vlastníka. */
export async function nactiForgejo({ forgejo, repo, token, f = fetch }) {
  const [vlastnik] = repo.split("/");
  const api = `${new URL(forgejo).origin}/api/v1`;
  const h = { Authorization: `token ${token}` };
  const rs = await jmena(`${api}/repos/${repo}/actions/secrets`, h, f);
  if (rs.chybi) throw new Error(`repo ${repo} nenalezeno`);
  const rv = await jmena(`${api}/repos/${repo}/actions/variables`, h, f);
  // Vlastník nemusí být organizace (404) — pak organizační úroveň prostě není.
  const os = await jmena(`${api}/orgs/${vlastnik}/actions/secrets`, h, f);
  const ov = await jmena(`${api}/orgs/${vlastnik}/actions/variables`, h, f);
  return { secrets: new Set([...rs.jmena, ...os.jmena]), vars: new Set([...rv.jmena, ...ov.jmena]) };
}

async function zapis({ forgejo, repo, token, polozka, hodnota, f = fetch }) {
  const api = `${new URL(forgejo).origin}/api/v1/repos/${repo}/actions`;
  const h = { Authorization: `token ${token}`, "Content-Type": "application/json" };
  if (polozka.druh === "secret") {
    const r = await f(`${api}/secrets/${polozka.jmeno}`, { method: "PUT", headers: h, body: JSON.stringify({ data: hodnota }) });
    if (!r.ok) throw new Error(`secret ${polozka.jmeno}: ${r.status}`);
    return;
  }
  const metoda = polozka.akce === "prepsat" ? "PUT" : "POST";
  const r = await f(`${api}/variables/${polozka.jmeno}`, { method: metoda, headers: h, body: JSON.stringify({ value: hodnota }) });
  if (!r.ok) throw new Error(`variable ${polozka.jmeno}: ${r.status}`);
}

// ─── příkazová řádka ────────────────────────────────────────────────────────

function argumenty(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return a;
}

async function hlavni(argv) {
  const a = argumenty(argv);
  const repo = a.repo;
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    console.error("ci-kontrakt: NEMĚŘENO — chybí --repo <vlastník/repo>");
    return 2;
  }
  const forgejo = a.forgejo ?? process.env.FORGEJO_URL ?? "";
  const token = process.env.FORGEJO_TOKEN ?? "";
  let trezor = null;
  if (a["env-file"]) {
    if (!existsSync(a["env-file"])) {
      console.error(`ci-kontrakt: NEMĚŘENO — trezor ${a["env-file"]} neexistuje`);
      return 2;
    }
    trezor = new Map(Object.entries(parseEnvFile(a["env-file"])));
  }
  let stav;
  try {
    if (!forgejo || !token) throw new Error("chybí FORGEJO_URL nebo FORGEJO_TOKEN");
    stav = await nactiForgejo({ forgejo, repo, token });
  } catch (e) {
    console.error(`ci-kontrakt: NEMĚŘENO — Forgejo: ${e.message}`);
    return 2;
  }

  if (a.apply) {
    // ⛔ Trvalá konfigurace repa: jen ručně, s potvrzením TOHOTO repa, nikdy z CI.
    if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.FORGEJO_ACTIONS) {
      console.error("ci-kontrakt: apply se v CI nespouští — zapisuje jen člověk s výslovným „ano“ majitele");
      return 2;
    }
    if (a.potvrzuji !== repo) {
      console.error(`ci-kontrakt: apply vyžaduje --potvrzuji ${repo} (výslovné „ano“ majitele pro tento běh)`);
      return 2;
    }
    if (!trezor) {
      console.error("ci-kontrakt: apply vyžaduje --env-file <trezor>");
      return 2;
    }
    for (const p of planApply({ kontrakt: KONTRAKT_CI, forgejo: stav, trezor })) {
      await zapis({ forgejo, repo, token, polozka: p, hodnota: trezor.get(p.klic) });
      console.log(`${p.akce === "pridat" ? "přidáno" : "přepsáno"}: ${p.druh} ${p.jmeno} ← trezor ${p.klic}`);
    }
    stav = await nactiForgejo({ forgejo, repo, token });
  }

  const { radky, kod } = await zmer({ kontrakt: KONTRAKT_CI, forgejo: stav, trezor });
  console.log(`ci-kontrakt: repo ${repo} · položek ${radky.length}${trezor ? "" : " · trezor nedodán"}`);
  for (const r of radky) {
    const znak = r.stav === "ok" ? "✓" : r.stav === "chybi-nepovinne" ? "·" : "✗";
    console.log(`  ${znak} ${r.druh.padEnd(6)} ${r.jmeno.padEnd(28)} Forgejo:${r.veForgeju ? "ano" : "NE "} trezor:${r.vTrezoru}${r.overeni !== "n/a" ? ` ověření:${r.overeni}${r.duvod ? ` (${r.duvod})` : ""}` : ""}${r.akce ? ` → ${r.akce}` : ""}`);
  }
  return kod;
}

export function nactiWorkflow(koren = REPO_ROOT) {
  const dir = join(koren, ".github", "workflows");
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ soubor: f, text: readFileSync(join(dir, f), "utf8") }));
}

if (isDirectRun(import.meta.url)) {
  hlavni(process.argv.slice(2)).then(
    (kod) => process.exit(kod),
    (e) => {
      console.error(`ci-kontrakt: NEMĚŘENO — ${e.message}`);
      process.exit(2);
    },
  );
}
