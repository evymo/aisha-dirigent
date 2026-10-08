#!/usr/bin/env node
/**
 * kiosk-balicky.mjs — co musí CI postavit a zveřejnit, aby tablety dostaly
 * DEKLAROVANOU verzi Kiosk Admina a jeho appek. A zápis výsledku zpět do dat
 * instance.
 *
 * ⭐ ROZHODNUTÍ MAJITELE 2026-09-24: build appek i Kiosk Admina běží SÁM.
 *    Vyžádání je zvednutá verze v datech instance. Build → podpis → registr →
 *    deklarace → úložiště → noční okno už nikdo ručně nedělá.
 *
 * ⭐ KONVERGENCE, NE UDÁLOST. Plán porovná, co data instance CHTĚJÍ (verze),
 *    s tím, co registr MÁ, a s tím, co deklarace UVÁDÍ. Zmeškaný běh, pád
 *    buildu i sloučení tokenem dožene příští běh — stejné pravidlo, jakým
 *    storage-auth srovnává úložiště s deklarací.
 *
 * Tři zdroje, tři role:
 *   · `surfaces/<povrch>/version.json` — verze appky (bump-version.sh): CHCE;
 *   · deklarace zařízení (`profile.zarizeni.hlidac`, typicky zarizeni/hlidac.json)
 *     — identita Kiosk Admina (CHCE) a artefakty (UVÁDÍ);
 *   · registr = GitHub Releases repozitáře instance (KIOSK_REGISTRY_REPO): jedno
 *     vydání na balíček a verzi (tag `<balíček>-<verze>`), APK jako jeho asset
 *     — co je postavené a podepsané (MÁ). Neměnný: táž verze s jiným otiskem je
 *     chyba, ne přepis (asset se nikdy nepřepisuje).
 *
 * ⛔ CI PÍŠE DO DEKLARACE JEN POLE ARTEFAKTU — otisk, velikost, zdroj a u appek
 *    verzi, ke které artefakt patří. Identitu, výbavu ani podpis nemění; ty
 *    patří člověku.
 *
 * Příkazy (volá je .github/workflows/kiosk-balicky.yml):
 *   plan      --data <adresář dat instance>    co postavit / deklarovat
 *   zverejni  --data <…> (--balicek <b> | --druh kiosk-admin) --apk <soubor>
 *                                               nahrát do registru (release asset)
 *   deklaruj  --data <…>                        PR s artefakty do dat instance
 *   over      --data <…>                        platnost deklarace (CI dat instance; bez tokenu)
 *
 * Prostředí: KIOSK_REGISTRY_REPO (vlastník/repo registru), GITHUB_SERVER_URL +
 * GITHUB_API_URL (v Actions je dodá běh; lokálně se zadají), KIOSK_BALICKY_TOKEN,
 * a pro `deklaruj` ještě DATA_REPO (host/vlastník/repo[.git]) a BEH_URL.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isDirectRun } from "../lib/cli-entry.mjs";
import { cestaIdentity, normalizuj } from "../lib/zarizeni-deklarace.mjs";

/** Jméno balíčku, org i verze v adrese registru: nic, co by adresu rozbilo. */
const SOUCAST = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;

// ─── čisté funkce ───────────────────────────────────────────────────────────

/**
 * Cesta k deklaraci zařízení z profilů instance. Která instance to je, CI
 * neví (jméno instance do stacku nepatří) — proto projde všechny profily a
 * vezme JEDINOU deklarovanou cestu. Dvě různé = STOP: nevíme, kterou stavět.
 *
 * @param {{soubor: string, obsah: string}[]} profily
 * @returns {string | null} null = instance tablety nechce
 */
export function cestaDeklarace(profily) {
  const cesty = new Map();
  for (const { soubor, obsah } of profily) {
    let j;
    try {
      j = JSON.parse(obsah);
    } catch (e) {
      throw new Error(`${soubor}: není platný JSON (${e.message})`);
    }
    const c = cestaIdentity(j?.zarizeni);
    if (c !== null) cesty.set(c, soubor);
  }
  if (cesty.size > 1) {
    const kde = [...cesty].map(([c, s]) => `${c} (${s})`).join(", ");
    throw new Error(`profily instance deklarují různé cesty zarizeni.hlidac: ${kde} — nevím, kterou stavět`);
  }
  return cesty.size ? [...cesty.keys()][0] : null;
}

/**
 * Povrch, který staví appku s tímto balíčkem (`app.bundleId` je i jméno
 * balíčku na Androidu — app.config.ts). Žádný nebo dva = STOP.
 *
 * @param {{povrch: string, obsah: string}[]} povrchy
 * @param {string} balicek
 */
export function povrchAppky(povrchy, balicek) {
  const nalezene = [];
  for (const { povrch, obsah } of povrchy) {
    let j;
    try {
      j = JSON.parse(obsah);
    } catch (e) {
      throw new Error(`surfaces/${povrch}/version.json: není platný JSON (${e.message})`);
    }
    if (j?.app?.bundleId !== balicek) continue;
    if (typeof j.version !== "string" || !j.version) {
      throw new Error(`surfaces/${povrch}/version.json: chybí version`);
    }
    if (!Number.isInteger(j.build) || j.build < 1) {
      throw new Error(`surfaces/${povrch}/version.json: build musí být kladné celé číslo`);
    }
    nalezene.push({ povrch, versionName: j.version, versionCode: j.build });
  }
  if (nalezene.length === 0) {
    throw new Error(`appku ${balicek} deklarace rozdává, ale žádný povrch ji nestaví (surfaces/*/version.json app.bundleId)`);
  }
  if (nalezene.length > 1) {
    throw new Error(`appku ${balicek} staví víc povrchů (${nalezene.map((n) => n.povrch).join(", ")}) — nevím, který`);
  }
  return nalezene[0];
}

/**
 * Kde balíček v registru leží. Registr = GitHub Releases repozitáře
 * `registr.repo`: jedno vydání na balíček a verzi (tag `<balíček>-<verze>`),
 * APK je jeho asset. Verze = `<versionName>-<versionCode>`.
 *
 * `url` (pole `zdroj` deklarace) je stabilní adresa stažení — známá DŘÍV, než
 * se cokoli nahraje, takže ji plán umí porovnat s deklarací.
 *
 * @param {{ registr: { repo: string, server: string, api: string }, balicek: string, versionName: string, versionCode: number }} o
 */
export function souradnice({ registr, balicek, versionName, versionCode }) {
  const verze = `${versionName}-${versionCode}`;
  const [vlastnik, jmeno, ...navic] = String(registr?.repo ?? "").split("/");
  if (navic.length) throw new Error(`registr „${registr?.repo}“ není ve tvaru vlastník/repo`);
  for (const [co, x] of [["vlastník", vlastnik], ["repo registru", jmeno], ["balíček", balicek], ["verze", verze]]) {
    if (!SOUCAST.test(String(x ?? ""))) throw new Error(`${co} „${x}“ nejde použít v adrese registru`);
  }
  const server = new URL(registr.server).origin;
  const api = String(registr.api).replace(/\/+$/, "");
  const tag = `${balicek}-${verze}`;
  const soubor = `${tag}.apk`;
  return {
    verze,
    soubor,
    tag,
    url: `${server}/${vlastnik}/${jmeno}/releases/download/${tag}/${soubor}`,
    vydani: `${api}/repos/${vlastnik}/${jmeno}/releases/tags/${tag}`,
    vydaniNove: `${api}/repos/${vlastnik}/${jmeno}/releases`,
  };
}

/**
 * Co s jednou položkou udělat.
 *   postavit   — registr cílovou verzi nemá;
 *   deklarovat — registr ji má, deklarace ji (celou) neuvádí;
 *   nic        — deklarace uvádí přesně zveřejněný artefakt.
 */
export function rozhodni({ cil, deklarovano, vRegistru, url }) {
  // ⛔ Kiosk instaluje jen VYŠŠÍ versionCode. Cíl pod tím, co se už rozdává,
  //    by tablety nikdy nevzaly — a nikdo by nevěděl proč.
  if (Number.isInteger(deklarovano.versionCode) && deklarovano.versionCode > cil.versionCode) {
    throw new Error(
      `cílová verze ${cil.versionName} (${cil.versionCode}) je NIŽŠÍ než rozdávaná (${deklarovano.versionCode}) — tablety ji nevezmou`,
    );
  }
  if (!vRegistru) return { akce: "postavit", duvod: `registr nemá ${cil.versionName} (${cil.versionCode})` };
  const sedi =
    deklarovano.versionCode === cil.versionCode &&
    deklarovano.versionName === cil.versionName &&
    String(deklarovano.sha256 ?? "").toLowerCase() === vRegistru.sha256 &&
    deklarovano.velikostBajtu === vRegistru.bajtu &&
    deklarovano.zdroj === url;
  return sedi
    ? { akce: "nic", duvod: "deklarace uvádí zveřejněný artefakt" }
    : { akce: "deklarovat", duvod: `registr má ${cil.versionName} (${cil.versionCode}), deklarace ho neuvádí` };
}

/**
 * Assety vydání → {sha256, bajtu} našeho souboru, nebo null.
 *
 * GitHub u assetu vrací `size` a `digest` ve tvaru `sha256:<hex>`. Bez otisku
 * nebo velikosti je to chyba, ne odhad — plán by jinak „deklaroval" artefakt,
 * jehož obsah nikdo nezměřil.
 */
export function zeSeznamuSouboru(soubory, soubor) {
  if (!Array.isArray(soubory)) throw new Error("registr: seznam assetů není pole");
  const s = soubory.find((x) => x?.name === soubor);
  if (!s) return null;
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(String(s.digest ?? ""))?.[1];
  if (!sha256 || !Number.isInteger(s.size)) {
    throw new Error(`registr: ${soubor} nemá otisk nebo velikost`);
  }
  return { sha256, bajtu: s.size };
}

/**
 * Deklarace z dat instance: cesta z profilů, text a ověřený obsah. null = instance
 * zařízení nedeklaruje.
 *
 * ⛔ Táž validace jako storage-auth (`normalizuj` ≙ `zeSuroveDeklarace`): nad
 *    deklarací, kterou by konzument odmítl, se nestaví ani nic nedeklaruje.
 */
export function nactiDeklaraci({ cti, profily }) {
  const cesta = cestaDeklarace(profily);
  if (cesta === null) return null;
  const text = cti(cesta);
  if (text === null) throw new Error(`profil deklaruje zarizeni.hlidac="${cesta}", ale soubor v datech instance není`);
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error(`${cesta}: není platný JSON (${e.message})`);
  }
  normalizuj(j, cesta);
  return { cesta, text, j };
}

/**
 * Kontrola pro CI DAT INSTANCE (bez registru a bez tokenu): deklarace je platná
 * a každou rozdávanou appku staví právě jeden povrch.
 *
 * ⭐ Nahrazuje ochranu, kterou do 2026-09 dávala derivace `ZARIZENI_HLIDAC`
 *    (vadná deklarace shodila doktora). Bez ní by vadný soubor prošel sloučením
 *    a projevil se až tím, že storage-auth schopnost vypne.
 */
export function overDeklaraci({ cti, profily, povrchy }) {
  const d = nactiDeklaraci({ cti, profily });
  if (d === null) return { cesta: null, appky: [] };
  const appky = (d.j.appky ?? []).map((a) => ({ balicek: a.balicek, ...povrchAppky(povrchy, a.balicek) }));
  return { cesta: d.cesta, appky };
}

/**
 * Plán: co data instance chtějí vs. co registr má vs. co deklarace uvádí.
 *
 * @param {object} o
 * @param {(cesta: string) => string | null} o.cti      soubor z dat instance
 * @param {{soubor: string, obsah: string}[]} o.profily
 * @param {{povrch: string, obsah: string}[]} o.povrchy
 * @param {(s: ReturnType<typeof souradnice>) => Promise<{sha256: string, bajtu: number} | null>} o.dotazRegistru
 * @param {{ repo: string, server: string, api: string }} o.registr  repo registru (KIOSK_REGISTRY_REPO)
 */
export async function naplanuj({ cti, profily, povrchy, dotazRegistru, registr }) {
  const d = nactiDeklaraci({ cti, profily });
  if (d === null) return { cesta: null, text: null, polozky: [] };
  const { cesta, text, j } = d;

  const polozky = [];
  for (const a of j.appky ?? []) {
    const p = povrchAppky(povrchy, a.balicek);
    const cil = { versionName: p.versionName, versionCode: p.versionCode };
    const s = souradnice({ registr, balicek: a.balicek, ...cil });
    const vRegistru = await dotazRegistru(s);
    polozky.push({
      druh: "appka", balicek: a.balicek, povrch: p.povrch, ...cil, ...s, vRegistru, certSha256: a.certSha256 ?? null,
      ...rozhodni({ cil, deklarovano: a, vRegistru, url: s.url }),
    });
  }
  const cil = { versionName: j.versionName, versionCode: j.versionCode };
  const s = souradnice({ registr, balicek: j.applicationId, ...cil });
  const vRegistru = await dotazRegistru(s);
  polozky.push({
    druh: "kiosk-admin", balicek: j.applicationId, ...cil, ...s, vRegistru, certSha256: j.signing?.certSha256 ?? null,
    ...rozhodni({ cil, deklarovano: { ...cil, ...(j.apk ?? {}) }, vRegistru, url: s.url }),
  });
  return { cesta, text, polozky };
}

/**
 * Nový text deklarace: položky „deklarovat“ dostanou artefakt z registru.
 * Pořadí klíčů i poznámky (`_note`) zůstanou — mění se jen hodnoty artefaktu.
 */
export function upravDeklaraci(text, polozky, cesta) {
  const j = JSON.parse(text);
  for (const p of polozky) {
    if (p.akce !== "deklarovat") continue;
    const artefakt = { sha256: p.vRegistru.sha256, velikostBajtu: p.vRegistru.bajtu, zdroj: p.url };
    if (p.druh === "appka") {
      const i = (j.appky ?? []).findIndex((a) => a.balicek === p.balicek);
      if (i < 0) throw new Error(`${cesta}: appka ${p.balicek} v deklaraci není`);
      j.appky[i] = { ...j.appky[i], versionCode: p.versionCode, versionName: p.versionName, ...artefakt };
    } else {
      j.apk = { ...(j.apk ?? {}), ...artefakt };
    }
  }
  // Producent musí být aspoň tak přísný jako konzument.
  normalizuj(j, cesta);
  return JSON.stringify(j, null, 2) + "\n";
}

/** Git blob SHA-1 textu — předpoklad pro contents API („měníš TUHLE verzi souboru“). */
export function blobSha(text) {
  const data = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
}

/** Větev PR: z obsahu změny, takže opakovaný běh trefí tutéž větev. */
export function vetevDeklarace(polozky) {
  const klic = polozky
    .filter((p) => p.akce === "deklarovat")
    .map((p) => `${p.balicek}@${p.verze}#${p.vRegistru.sha256}`)
    .join(",");
  return `ci/zarizeni-${createHash("sha256").update(klic).digest("hex").slice(0, 12)}`;
}

/**
 * `host/vlastník/repo(.git)` (tvar INSTANCE_OVERLAY_REPO) → REST API a repo.
 * github.com → api.github.com; jiný host = GitHub Enterprise Server (`/api/v3`).
 */
export function repoDat(deklarace) {
  const m = /^(?:https:\/\/)?([^/@\s]+)\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(deklarace ?? "").trim());
  if (!m) throw new Error(`DATA_REPO „${deklarace}“ není ve tvaru host/vlastník/repo`);
  const api = m[1] === "github.com" ? "https://api.github.com" : `https://${m[1]}/api/v3`;
  return { api, repo: `${m[2]}/${m[3]}` };
}

/** Hlavičky REST API GitHubu. */
export function hlavicky(token, navic = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...navic,
  };
}

/** Otisk certifikátu z výstupu `apksigner verify --print-certs` → tvar deklarace (A1:B2:…). */
export function otiskZApksigneru(vystup) {
  const m = /Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]{64})/.exec(String(vystup));
  if (!m) throw new Error("apksigner nevrátil otisk certifikátu — APK není (platně) podepsané");
  return m[1].toUpperCase().match(/../g).join(":");
}

/**
 * ⛔ Do registru jde jen balík podepsaný DEKLAROVANÝM klíčem. Otisk souboru
 *    (sha256) zapisuje do deklarace samo CI, takže by binárku se špatným
 *    klíčem „posvětilo“; otisk CERTIFIKÁTU deklaruje člověk. Android by
 *    aktualizaci jiným klíčem odmítl — a tablet by ji zkoušel každou noc.
 */
export function overPodpis({ polozka, otisk }) {
  if (!polozka.certSha256) {
    throw new Error(`${polozka.balicek}: deklarace neuvádí otisk podpisu (certSha256) — bez něj nic nezveřejním`);
  }
  if (String(polozka.certSha256).toUpperCase() !== otisk) {
    throw new Error(`${polozka.balicek}: APK je podepsané JINÝM klíčem (${otisk}) než deklarace (${polozka.certSha256})`);
  }
}

/** apksigner z nejnovějších build-tools v $ANDROID_HOME. */
function apksigner(sdk = process.env.ANDROID_HOME ?? "") {
  const bt = join(sdk, "build-tools");
  const verze = existsSync(bt) ? readdirSync(bt).sort((a, b) => a.localeCompare(b, "en", { numeric: true })) : [];
  if (!sdk || verze.length === 0) throw new Error("apksigner nenalezen (ANDROID_HOME/build-tools)");
  return join(bt, verze.at(-1), "apksigner");
}

// ─── registr a repo dat (I/O přes předaný fetch) ────────────────────────────

/** Vydání podle tagu. 404 = verze není; jiná chyba = NEDOSTUPNÝ, ne prázdný. */
async function vydani({ s, token, f }) {
  const r = await f(s.vydani, { headers: hlavicky(token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`registr neodpověděl na ${s.verze}: ${r.status} — plán bez registru nevznikne`);
  return r.json();
}

/** Dotaz registru. 404 = verze není; jiná chyba = NEDOSTUPNÝ, ne prázdný. */
export function registrZFetch({ token, f = fetch }) {
  return async (s) => {
    const v = await vydani({ s, token, f });
    return v === null ? null : zeSeznamuSouboru(v.assets ?? [], s.soubor);
  };
}

/**
 * Nahrání balíčku do registru (asset vydání `s.tag`; vydání se založí, když
 * chybí). Registr je neměnný: existující asset je v pořádku jen tehdy, když je
 * to TÝŽ soubor (opakovaný běh). Jiný otisk = dva buildy téže verze, a to se
 * nesmí vyřešit přepisem.
 */
export async function zverejni({ data, s, token, f = fetch }) {
  const sha256 = createHash("sha256").update(data).digest("hex");
  const bajtu = data.length;
  const odmitnuto = (st) => new Error(`registr odmítl zápis (${st}) — KIOSK_BALICKY_TOKEN nemá contents:write na repu registru`);
  const uzTam = (assets) => {
    const tam = zeSeznamuSouboru(assets ?? [], s.soubor);
    if (tam === null) return null;
    if (tam.sha256 === sha256) return { stav: "uz_tam_je", sha256, bajtu };
    throw new Error(
      `registr už má ${s.soubor} s JINÝM otiskem (${tam.sha256} ≠ ${sha256}). Verze jsou neměnné — zvedni číslo verze.`,
    );
  };

  let v = await vydani({ s, token, f });
  if (v === null) {
    const r = await f(s.vydaniNove, {
      method: "POST",
      headers: hlavicky(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ tag_name: s.tag, name: s.tag, body: `Balíček ${s.soubor} (CI kiosk-balicky).`, make_latest: "false" }),
    });
    if (r.status === 401 || r.status === 403) throw odmitnuto(r.status);
    if (!r.ok) throw new Error(`registr: založení vydání ${s.tag} → ${r.status}`);
    v = await r.json();
  }
  const hotovo = uzTam(v.assets);
  if (hotovo) return hotovo;

  const nahrat = `${String(v.upload_url ?? "").replace(/\{.*\}$/, "")}?name=${encodeURIComponent(s.soubor)}`;
  const r = await f(nahrat, {
    method: "POST",
    headers: hlavicky(token, { "Content-Type": "application/vnd.android.package-archive" }),
    body: data,
  });
  if (r.status === 201) return { stav: "zverejneno", sha256, bajtu };
  if (r.status === 422) {
    // Souběh: asset téhož jména mezitím nahrál jiný běh — rozhodne jeho otisk.
    const znovu = await vydani({ s, token, f });
    const hotovoPoSoubehu = uzTam(znovu?.assets);
    if (hotovoPoSoubehu) return hotovoPoSoubehu;
  }
  if (r.status === 401 || r.status === 403) throw odmitnuto(r.status);
  throw new Error(`registr odpověděl ${r.status} na nahrání ${s.soubor}`);
}

/** Závěry check runu, které znamenají „neprošlo". */
const SPATNY_ZAVER = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"]);

/**
 * Počká, až CI dat instance na commitu PR doběhne ZELENĚ.
 *
 * ⛔ NAMĚŘENO 2026-09-25: repo dat nemá ochranu větve. Sloučení „po zelené"
 *    bez čekání by vzalo commit BEZ kontrol jako úspěšný a sloučilo HNED — dřív,
 *    než se CI vůbec rozběhne. Proto se slučuje až ve chvíli, kdy kontroly
 *    (check runy i commit statusy) EXISTUJÍ a všechny doběhly bez chyby;
 *    neobjeví-li se, nesloučí se nic a řekne se to nahlas.
 */
export async function pockejNaKontroly({ api, repo, sha, h, f, spi = (ms) => new Promise((r) => setTimeout(r, ms)), pokusu = 60, krokMs = 10_000 }) {
  let videno = false;
  for (let i = 0; i < pokusu; i++) {
    const rc = await f(`${api}/repos/${repo}/commits/${sha}/check-runs?per_page=100`, { headers: h });
    if (!rc.ok) throw new Error(`kontroly ${sha.slice(0, 9)}: ${rc.status}`);
    const rs = await f(`${api}/repos/${repo}/commits/${sha}/status`, { headers: h });
    if (!rs.ok) throw new Error(`stav kontrol ${sha.slice(0, 9)}: ${rs.status}`);
    const behy = (await rc.json())?.check_runs ?? [];
    const statusy = (await rs.json())?.statuses ?? [];
    if (behy.length + statusy.length > 0) {
      videno = true;
      const spatne = [
        ...behy.filter((b) => SPATNY_ZAVER.has(b?.conclusion)).map((b) => `${b.name}: ${b.conclusion}`),
        ...statusy.filter((x) => x?.state === "failure" || x?.state === "error").map((x) => `${x.context}: ${x.state}`),
      ];
      if (spatne.length) {
        throw new Error(`kontroly dat instance na ${sha.slice(0, 9)} selhaly (${spatne.join(", ")}) — nesloučeno`);
      }
      const dobehly = behy.every((b) => b?.status === "completed") && statusy.every((x) => x?.state === "success");
      if (dobehly) return "success";
    }
    await spi(krokMs);
  }
  throw new Error(
    videno
      ? `CI dat instance na ${sha.slice(0, 9)} nedoběhlo ani za ${(pokusu * krokMs) / 1000} s — nesloučeno (příští běh naváže)`
      : `CI dat instance se na ${sha.slice(0, 9)} nerozběhlo ani za ${(pokusu * krokMs) / 1000} s — nesloučeno`,
  );
}

/**
 * PR s artefakty do dat instance a sloučení po zelené. Idempotentní: táž
 * změna = táž větev; existující větev ani PR se nezakládají znovu.
 */
export async function deklaruj({ api, repo, cesta, puvodni, novy, polozky, token, beh, f = fetch, spi }) {
  if (novy === puvodni) return { stav: "beze_zmeny" };
  const h = hlavicky(token, { "Content-Type": "application/json" });
  // Tělo se čte jako text: některé odpovědi (DELETE ref, 204) jsou prázdné a
  // `r.json()` by na úspěchu spadl.
  const odpoved = async (r, co) => {
    const telo = await r.text();
    if (!r.ok) throw new Error(`${co}: ${r.status} ${telo.slice(0, 300)}`);
    return telo.trim() ? JSON.parse(telo) : null;
  };
  const cast = (x) => encodeURIComponent(x);

  const info = await odpoved(await f(`${api}/repos/${repo}`, { headers: h }), `repo dat ${repo}`);
  if (!info?.permissions?.push) throw new Error(`KIOSK_BALICKY_TOKEN nesmí zapisovat do ${repo} — PR s deklarací nevznikne`);
  const zaklad = info.default_branch;
  const vetev = vetevDeklarace(polozky);
  const zmeny = polozky.filter((p) => p.akce === "deklarovat");
  const titulek = `zařízení: ${zmeny.map((p) => `${p.balicek} ${p.versionName} (${p.versionCode})`).join(", ")}`;

  const b = await f(`${api}/repos/${repo}/branches/${cast(vetev)}`, { headers: h });
  if (b.status === 404) {
    // Větev z hlavní, pak zápis souboru s `sha` = verze souboru, ze které plán
    // vyšel. Změnil-li se mezitím v hlavní větvi, zápis selže (409) — příští
    // běh plánuje znovu nad novým stavem.
    const hlavni = await odpoved(await f(`${api}/repos/${repo}/git/ref/heads/${cast(zaklad)}`, { headers: h }), `hlavní větev ${zaklad}`);
    await odpoved(
      await f(`${api}/repos/${repo}/git/refs`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ ref: `refs/heads/${vetev}`, sha: hlavni.object.sha }),
      }),
      `založení větve ${vetev}`,
    );
    await odpoved(
      await f(`${api}/repos/${repo}/contents/${cesta.split("/").map(cast).join("/")}`, {
        method: "PUT",
        headers: h,
        body: JSON.stringify({
          branch: vetev,
          sha: blobSha(puvodni),
          content: Buffer.from(novy, "utf8").toString("base64"),
          message: `${titulek}\n\nArtefakty z registru (CI kiosk-balicky). ${beh ?? ""}`.trim(),
        }),
      }),
      `zápis deklarace do větve ${vetev}`,
    );
  } else if (!b.ok) {
    throw new Error(`větev ${vetev}: ${b.status}`);
  }

  const vlastnik = repo.split("/")[0];
  const otevrene = await odpoved(
    await f(`${api}/repos/${repo}/pulls?state=open&head=${cast(`${vlastnik}:${vetev}`)}&per_page=100`, { headers: h }),
    "seznam PR",
  );
  let pr = (otevrene ?? []).find((p) => p?.head?.ref === vetev);
  if (!pr) {
    const telo = [
      "Artefakty, které CI postavilo, podepsalo a zveřejnilo v registru. Mění se JEN pole artefaktu",
      "(otisk, velikost, zdroj; u appek verze, ke které patří).",
      "",
      ...zmeny.map((p) => `- \`${p.balicek}\` ${p.versionName} (${p.versionCode}) · sha256 \`${p.vRegistru.sha256}\` · ${p.vRegistru.bajtu} B · ${p.url}`),
      "",
      beh ? `Běh: ${beh}` : "",
    ].join("\n");
    pr = await odpoved(
      await f(`${api}/repos/${repo}/pulls`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ base: zaklad, head: vetev, title: titulek, body: telo }),
      }),
      "založení PR",
    );
  }
  await pockejNaKontroly({ api, repo, sha: pr.head.sha, h, f, ...(spi ? { spi } : {}) });
  // `sha` = hlava, nad kterou kontroly doběhly: přibyl-li mezitím commit, GitHub
  // sloučení odmítne (409) a nic nezměřeného se nesloučí.
  await odpoved(
    await f(`${api}/repos/${repo}/pulls/${pr.number}/merge`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ merge_method: "merge", sha: pr.head.sha }),
    }),
    `sloučení po zelené #${pr.number}`,
  );
  // Úklid větve je best-effort: sloučení už proběhlo a o tom se rozhoduje výš.
  await f(`${api}/repos/${repo}/git/refs/heads/${cast(vetev)}`, { method: "DELETE", headers: h }).catch((e) =>
    console.warn(`kiosk-balicky: větev ${vetev} po sloučení #${pr.number} nesmazána (úklid, ne vada): ${e?.message ?? e}`),
  );
  return { stav: "pr", cislo: pr.number, vetev };
}

// ─── příkazová řádka ────────────────────────────────────────────────────────

function argumenty(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) a[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
  }
  return a;
}

function povinne(nazev) {
  const v = process.env[nazev];
  if (!v) throw new Error(`${nazev} není nastavené`);
  return v;
}

function nactiData(adresar) {
  const cti = (c) => (existsSync(join(adresar, c)) ? readFileSync(join(adresar, c), "utf8") : null);
  const vJson = (d) => (existsSync(d) ? readdirSync(d).filter((x) => x.endsWith(".json")) : []);
  const profily = vJson(join(adresar, "profiles")).map((s) => ({
    soubor: `profiles/${s}`,
    obsah: readFileSync(join(adresar, "profiles", s), "utf8"),
  }));
  const povrchy = (existsSync(join(adresar, "surfaces")) ? readdirSync(join(adresar, "surfaces")) : [])
    .filter((p) => existsSync(join(adresar, "surfaces", p, "version.json")))
    .map((p) => ({ povrch: p, obsah: readFileSync(join(adresar, "surfaces", p, "version.json"), "utf8") }));
  return { cti, profily, povrchy };
}

/**
 * Registr z prostředí: repo z KIOSK_REGISTRY_REPO, server a API z běhu Actions.
 * Nic se nedosazuje — adresa `zdroj` jde do deklarace a dosazený host by tablety
 * poslal jinam (zadny-fallback-nad-identitou).
 */
export function registrZProstredi(env = process.env) {
  const chybi = ["KIOSK_REGISTRY_REPO", "GITHUB_SERVER_URL", "GITHUB_API_URL"].filter((k) => !env[k]);
  if (chybi.length) throw new Error(`${chybi.join(", ")} není nastavené`);
  return { repo: env.KIOSK_REGISTRY_REPO, server: env.GITHUB_SERVER_URL, api: env.GITHUB_API_URL };
}

async function planZProstredi(adresar) {
  const token = povinne("KIOSK_BALICKY_TOKEN");
  return naplanuj({
    ...nactiData(adresar),
    dotazRegistru: registrZFetch({ token }),
    registr: registrZProstredi(),
  });
}

function vystup(nazev, hodnota) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${nazev}=${hodnota}\n`);
}

async function hlavni(argv) {
  const [prikaz, ...zbytek] = argv;
  const a = argumenty(zbytek);
  if (!a.data) throw new Error("chybí --data <adresář dat instance>");

  if (prikaz === "over") {
    const v = overDeklaraci(nactiData(a.data));
    if (v.cesta === null) console.log("instance zařízení nedeklaruje — není co ověřovat");
    else console.log(`deklarace ${v.cesta} platná; appky: ${v.appky.map((x) => `${x.balicek} ← surfaces/${x.povrch}`).join(", ") || "žádné"}`);
    return;
  }

  if (prikaz === "plan") {
    const plan = await planZProstredi(a.data);
    if (plan.cesta === null) {
      console.log("instance zařízení nedeklaruje (profil bez zarizeni.hlidac) — nic k stavění");
    }
    for (const p of plan.polozky) {
      console.log(`${p.akce.padEnd(10)} ${p.druh.padEnd(11)} ${p.balicek} ${p.versionName} (${p.versionCode}) — ${p.duvod}`);
    }
    const appky = plan.polozky.filter((p) => p.druh === "appka" && p.akce === "postavit");
    // Úloha `appky` staví jen tyto (balíček + povrch, ze kterého se staví).
    vystup("appky", JSON.stringify(appky.map((p) => ({ balicek: p.balicek, povrch: p.povrch }))));
    const kiosk = plan.polozky.find((p) => p.druh === "kiosk-admin");
    vystup("cesta", plan.cesta ?? "");
    vystup("kiosk_admin", kiosk?.akce ?? "nic");
    vystup("deklarovat", plan.polozky.some((p) => p.akce === "deklarovat") ? "ano" : "ne");
    return;
  }

  if (prikaz === "zverejni") {
    // Kiosk Admin se vybírá DRUHEM: jméno jeho balíčku je instanční dato a
    // workflow ho neví. Appka jménem balíčku z plánu.
    if ((!a.balicek && a.druh !== "kiosk-admin") || !a.apk) {
      throw new Error("zverejni: chybí --apk nebo výběr položky (--balicek <b> | --druh kiosk-admin)");
    }
    const plan = await planZProstredi(a.data);
    const p = plan.polozky.find((x) => (a.balicek ? x.balicek === a.balicek : x.druh === a.druh));
    if (!p) throw new Error(`zverejni: ${a.balicek ?? a.druh} plán nezná`);
    const otisk = otiskZApksigneru(execFileSync(apksigner(), ["verify", "--print-certs", a.apk], { encoding: "utf8" }));
    overPodpis({ polozka: p, otisk });
    console.log(`podpis ${p.balicek}: ${otisk} = deklarace ✓`);
    const v = await zverejni({ data: readFileSync(a.apk), s: p, token: povinne("KIOSK_BALICKY_TOKEN") });
    console.log(`${v.stav}: ${p.soubor} · sha256 ${v.sha256} · ${v.bajtu} B → ${p.url}`);
    return;
  }

  if (prikaz === "deklaruj") {
    const plan = await planZProstredi(a.data);
    const zbyva = plan.polozky.filter((p) => p.akce === "postavit");
    for (const p of zbyva) console.log(`nedeklaruji ${p.balicek} ${p.versionName} (${p.versionCode}) — v registru není`);
    if (!plan.polozky.some((p) => p.akce === "deklarovat")) {
      console.log("deklarace uvádí vše, co registr má — PR netřeba");
      return;
    }
    const novy = upravDeklaraci(plan.text, plan.polozky, plan.cesta);
    const v = await deklaruj({
      ...repoDat(povinne("DATA_REPO")),
      cesta: plan.cesta,
      puvodni: plan.text,
      novy,
      polozky: plan.polozky,
      token: povinne("KIOSK_BALICKY_TOKEN"),
      beh: process.env.BEH_URL,
    });
    console.log(v.stav === "pr" ? `PR #${v.cislo} (${v.vetev}) — sloučí se po zelené` : v.stav);
    return;
  }

  throw new Error(`neznámý příkaz „${prikaz ?? ""}“ (plan | zverejni | deklaruj | over)`);
}

if (isDirectRun(import.meta.url)) {
  hlavni(process.argv.slice(2)).catch((e) => {
    console.error(`::error title=kiosk-balicky::${e.message}`);
    process.exit(1);
  });
}
