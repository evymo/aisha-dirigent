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
 *   · generic registr Forgejo — co je postavené a podepsané (MÁ). Neměnný:
 *     táž verze s jiným otiskem je chyba, ne přepis.
 *
 * ⛔ CI PÍŠE DO DEKLARACE JEN POLE ARTEFAKTU — otisk, velikost, zdroj a u appek
 *    verzi, ke které artefakt patří. Identitu, výbavu ani podpis nemění; ty
 *    patří člověku.
 *
 * Příkazy (volá je .github/workflows/kiosk-balicky.yml):
 *   plan      --data <adresář dat instance>    co postavit / deklarovat
 *   zverejni  --data <…> (--balicek <b> | --druh kiosk-admin) --apk <soubor>
 *                                               PUT do registru
 *   deklaruj  --data <…>                        PR s artefakty do dat instance
 *   over      --data <…>                        platnost deklarace (CI dat instance; bez tokenu)
 *
 * Prostředí: FORGEJO_URL (původ registru = týž, který storage-auth pouští ke
 * stahování), VLASTNIK_BALICKU (org registru), KIOSK_BALICKY_TOKEN, a pro
 * `deklaruj` ještě DATA_REPO (host/vlastník/repo[.git]) a BEH_URL.
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

/** Kde balíček v generic registru leží. Verze = `<versionName>-<versionCode>`. */
export function souradnice({ registr, vlastnik, balicek, versionName, versionCode }) {
  const verze = `${versionName}-${versionCode}`;
  for (const [co, x] of [["vlastník", vlastnik], ["balíček", balicek], ["verze", verze]]) {
    if (!SOUCAST.test(String(x))) throw new Error(`${co} „${x}“ nejde použít v adrese registru`);
  }
  const puvod = new URL(registr).origin;
  const soubor = `${balicek}-${verze}.apk`;
  return {
    verze,
    soubor,
    url: `${puvod}/api/packages/${vlastnik}/generic/${balicek}/${verze}/${soubor}`,
    seznam: `${puvod}/api/v1/packages/${vlastnik}/generic/${balicek}/${verze}/files`,
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
 * Odpověď `…/files` → {sha256, bajtu} našeho souboru, nebo null.
 *
 * ⛔ Forgejo vrací velikost jako `Size` (VELKÉ S; ostatní klíče malé:
 * `{"id":430,"Size":82740,"name":…,"sha256":…}`, naměřeno 2026-09-29 na prvním
 * artefaktu v registru). Čtení jen `size` dělalo z platného artefaktu „bez
 * velikosti“ a plán padl dřív, než cokoli postavil. Bere se `Size`, `size` jako
 * záloha pro jiné registry; chybí-li obojí, je to dál chyba (nic se nehádá).
 */
export function zeSeznamuSouboru(soubory, soubor) {
  if (!Array.isArray(soubory)) throw new Error("registr: seznam souborů není pole");
  const s = soubory.find((x) => x?.name === soubor);
  if (!s) return null;
  const bajtu = s.Size ?? s.size;
  if (!/^[0-9a-f]{64}$/.test(String(s.sha256)) || !Number.isInteger(bajtu)) {
    throw new Error(`registr: ${soubor} nemá otisk nebo velikost`);
  }
  return { sha256: s.sha256, bajtu };
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
 * @param {string} o.registr   původ registru (FORGEJO_URL)
 * @param {string} o.vlastnik  org registru
 */
export async function naplanuj({ cti, profily, povrchy, dotazRegistru, registr, vlastnik }) {
  const d = nactiDeklaraci({ cti, profily });
  if (d === null) return { cesta: null, text: null, polozky: [] };
  const { cesta, text, j } = d;

  const polozky = [];
  for (const a of j.appky ?? []) {
    const p = povrchAppky(povrchy, a.balicek);
    const cil = { versionName: p.versionName, versionCode: p.versionCode };
    const s = souradnice({ registr, vlastnik, balicek: a.balicek, ...cil });
    const vRegistru = await dotazRegistru(s);
    polozky.push({
      druh: "appka", balicek: a.balicek, povrch: p.povrch, ...cil, ...s, vRegistru, certSha256: a.certSha256 ?? null,
      ...rozhodni({ cil, deklarovano: a, vRegistru, url: s.url }),
    });
  }
  const cil = { versionName: j.versionName, versionCode: j.versionCode };
  const s = souradnice({ registr, vlastnik, balicek: j.applicationId, ...cil });
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

/** `host/vlastník/repo(.git)` (tvar INSTANCE_OVERLAY_REPO) → API a repo. */
export function repoDat(deklarace) {
  const m = /^(?:https:\/\/)?([^/@\s]+)\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(deklarace ?? "").trim());
  if (!m) throw new Error(`DATA_REPO „${deklarace}“ není ve tvaru host/vlastník/repo`);
  return { api: `https://${m[1]}/api/v1`, repo: `${m[2]}/${m[3]}` };
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

/** Dotaz registru. 404 = verze není; jiná chyba = NEDOSTUPNÝ, ne prázdný. */
export function registrZFetch({ token, f = fetch }) {
  return async (s) => {
    const r = await f(s.seznam, { headers: { Authorization: `token ${token}` } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`registr neodpověděl na ${s.verze}: ${r.status} — plán bez registru nevznikne`);
    return zeSeznamuSouboru(await r.json(), s.soubor);
  };
}

/**
 * PUT balíčku do registru. Registr je neměnný: 409 je v pořádku jen tehdy,
 * když tam leží TÝŽ soubor (opakovaný běh). Jiný otisk = dva buildy téže
 * verze, a to se nesmí vyřešit přepisem.
 */
export async function zverejni({ data, s, token, f = fetch }) {
  const sha256 = createHash("sha256").update(data).digest("hex");
  const bajtu = data.length;
  const r = await f(s.url, {
    method: "PUT",
    headers: { Authorization: `token ${token}`, "Content-Type": "application/vnd.android.package-archive" },
    body: data,
  });
  if (r.status === 201) return { stav: "zverejneno", sha256, bajtu };
  if (r.status === 409) {
    const tam = await registrZFetch({ token, f })(s);
    if (tam && tam.sha256 === sha256) return { stav: "uz_tam_je", sha256, bajtu };
    throw new Error(
      `registr už má ${s.soubor} s JINÝM otiskem (${tam?.sha256 ?? "?"} ≠ ${sha256}). Verze jsou neměnné — zvedni číslo verze.`,
    );
  }
  if (r.status === 401 || r.status === 403) {
    throw new Error(`registr odmítl zápis (${r.status}) — KIOSK_BALICKY_TOKEN nemá write:package`);
  }
  throw new Error(`registr odpověděl ${r.status} na PUT ${s.soubor}`);
}

/**
 * Počká, až CI dat instance ohlásí na commitu PR aspoň jednu kontrolu.
 *
 * ⛔ NAMĚŘENO 2026-09-25: repo dat nemá ochranu větve. Forgejo pak u
 *    `merge_when_checks_succeed` bere commit BEZ stavů jako úspěšný a sloučí
 *    HNED — dřív, než se CI vůbec rozběhne. „Po zelené" by platilo jen
 *    náhodou. Proto se o sloučení žádá až ve chvíli, kdy kontroly existují;
 *    neobjeví-li se, nesloučí se nic a řekne se to nahlas.
 */
export async function pockejNaKontroly({ api, repo, sha, h, f, spi = (ms) => new Promise((r) => setTimeout(r, ms)), pokusu = 30, krokMs = 10_000 }) {
  for (let i = 0; i < pokusu; i++) {
    const r = await f(`${api}/repos/${repo}/commits/${sha}/status`, { headers: h });
    if (!r.ok) throw new Error(`stav kontrol ${sha.slice(0, 9)}: ${r.status}`);
    const s = await r.json();
    if ((s?.statuses ?? []).length > 0) {
      if (s.state === "failure" || s.state === "error") {
        throw new Error(`kontroly dat instance na ${sha.slice(0, 9)} selhaly (${s.state}) — nesloučeno`);
      }
      return s.state;
    }
    await spi(krokMs);
  }
  throw new Error(`CI dat instance se na ${sha.slice(0, 9)} nerozběhlo ani za ${(pokusu * krokMs) / 1000} s — nesloučeno`);
}

/**
 * PR s artefakty do dat instance a sloučení po zelené. Idempotentní: táž
 * změna = táž větev; existující větev ani PR se nezakládají znovu.
 */
export async function deklaruj({ api, repo, cesta, puvodni, novy, polozky, token, beh, f = fetch, spi }) {
  if (novy === puvodni) return { stav: "beze_zmeny" };
  const h = { Authorization: `token ${token}`, "Content-Type": "application/json" };
  // Tělo se čte jako text: `…/merge` vrací 200 s PRÁZDNÝM tělem a `r.json()`
  // by na úspěchu spadl.
  const odpoved = async (r, co) => {
    const telo = await r.text();
    if (!r.ok) throw new Error(`${co}: ${r.status} ${telo.slice(0, 300)}`);
    return telo.trim() ? JSON.parse(telo) : null;
  };

  const info = await odpoved(await f(`${api}/repos/${repo}`, { headers: h }), `repo dat ${repo}`);
  if (!info?.permissions?.push) throw new Error(`KIOSK_BALICKY_TOKEN nesmí zapisovat do ${repo} — PR s deklarací nevznikne`);
  const zaklad = info.default_branch;
  const vetev = vetevDeklarace(polozky);
  const zmeny = polozky.filter((p) => p.akce === "deklarovat");
  const titulek = `zařízení: ${zmeny.map((p) => `${p.balicek} ${p.versionName} (${p.versionCode})`).join(", ")}`;

  const b = await f(`${api}/repos/${repo}/branches/${encodeURIComponent(vetev)}`, { headers: h });
  if (b.status === 404) {
    // `sha` = verze souboru, ze které plán vyšel. Změnil-li se mezitím v
    // hlavní větvi, zápis selže — příští běh plánuje znovu nad novým stavem.
    await odpoved(
      await f(`${api}/repos/${repo}/contents/${cesta.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT",
        headers: h,
        body: JSON.stringify({
          branch: zaklad,
          new_branch: vetev,
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

  const otevrene = await odpoved(await f(`${api}/repos/${repo}/pulls?state=open&limit=50`, { headers: h }), "seznam PR");
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
  await odpoved(
    await f(`${api}/repos/${repo}/pulls/${pr.number}/merge`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        Do: "merge",
        merge_when_checks_succeed: true,
        head_commit_id: pr.head.sha,
        delete_branch_after_merge: true,
      }),
    }),
    `sloučení po zelené #${pr.number}`,
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

async function planZProstredi(adresar) {
  const token = povinne("KIOSK_BALICKY_TOKEN");
  return naplanuj({
    ...nactiData(adresar),
    dotazRegistru: registrZFetch({ token }),
    registr: povinne("FORGEJO_URL"),
    vlastnik: povinne("VLASTNIK_BALICKU"),
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
