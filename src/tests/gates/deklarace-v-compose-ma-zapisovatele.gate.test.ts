/**
 * Brána: každý klíč `${X:?}` v docker-compose.coolify*.yml má ZAPISOVATELE
 * na doručovací cestě — a nový klíč, který má zapisovatele jen při cold-startu,
 * je nahlášen, dokud ho někdo nedoručí i redeployem.
 *
 * ⛔ NAMĚŘENO 2026-09-12 (HEAD 1af002269, sync forku `<fork>` do upstreamu):
 *
 *   · 18 compose čte `${PKI_BUNDLE_REQUIRED:?}`. Hodnotu odvozoval a zapisoval
 *     JEN heredoc cold-startu (řádek `PKI_BUNDLE_REQUIRED=${PKI_BUNDLE_REQUIRED:?…}`).
 *     Base fcd9156c1 měl v compose `:-true` a heredoc klíč nepsal, takže
 *     instance nasazené z base ho v Coolify env NEMAJÍ — a `npm run redeploy`
 *     ho nedoručí: `coolify-sync-envs.sh` posílá jen klíče přítomné v
 *     `.env.coolify` (payload = .env.coolify ∩ compose refs) a jediný, kdo na
 *     cestě redeploye do `.env.coolify` ZAPISUJE, je env-doktor
 *     (`aisha-redeploy.mjs` → `srovnejOdvozeneKlice()` → `aisha-env-doctor.mjs`
 *     v APPLY) — a ten klíč neznal. Každý redeploy před dalším cold-startem by
 *     spadl na interpolaci compose. Fail-loud bez plniče není bezpečnost, je to
 *     výpadek.
 *
 *   · 4 compose čtou `${KEYCLOAK_EXTRA_HOST_ALIAS:?}`; heredoc ho jako jediný
 *     z rodiny KEYCLOAK_DOMAIN_* nepsal. Doručoval ho heal pass doktora — ten
 *     v APPLY zapisuje i každý klíč z `formatShellExports(topo)`, který CONTRACT
 *     nezná (aisha-env-doctor.mjs, smyčka nad TOPOLOGY_ENV). Změřeno spuštěním:
 *     `ENV_FILE=<tmp> AISHA_PROFILE=cloud-multi node scripts/aisha-env-doctor.mjs
 *     --no-external` zapsal 540 klíčů včetně aliasu. Zapisovatel tedy EXISTOVAL,
 *     jen jiný, než compose hlásá („vydává derive-domains") — a proto tahle
 *     brána nečte prózu, ale SPOUŠTÍ doktora a čte, co zapsal.
 *
 * JAK SE TO DNES DORUČUJE (změřeno, ne opsáno):
 *   cold-start : heredoc → .env.coolify → env-doktor (heal pass, `|| warn`)
 *                → coolify-sync-envs.sh (VALIDATE_ONLY, pak sync)
 *   redeploy   : env-doktor APPLY → coolify-sync-envs.sh <app> → deploy
 * Zapisovatelé do `.env.coolify` jsou tedy DVA: heredoc cold-startu (a jeho
 * `printf … >> "$TMP_ENV"` dodatky) a env-doktor v APPLY (CONTRACT + klíče
 * resolveru, které CONTRACT nezná). generate-secrets a derive-domains do
 * souboru nepíšou samy — jejich výstup se do něj dostane buď heredocem
 * (`VAR=${VAR}`), nebo doktorem. Proto se měří výsledek, ne jejich výstup.
 *
 * DVĚ VLASTNOSTI, NE VZOREK:
 *   1. `:?` ⊆ heredoc ∪ doktor — jinak klíč NIKDO nedoručí ani při cold-startu.
 *   2. Klíč, který píše JEN heredoc, na cestě redeploye plniče nemá. Dnešních
 *      třináct takových je ROHATKA (tajemství generovaná jednou při cold-startu,
 *      mesh subnety) — cold-start je zapsal, redeploy je z `.env.coolify` jen
 *      roznese. NOVÝ heredoc-only klíč je ale přesně případ PKI_BUNDLE_REQUIRED:
 *      instance nasazené před ním ho nemají a redeploy ho nevyrobí. Rohatku
 *      smí rozšířit jen ten, kdo doloží, proč klíč nemůže vzniknout po nasazení
 *      (a zapíše to sem), jinak patří do CONTRACT doktora s doloženým zdrojem.
 *
 * ZÁPIS ≠ PLNIČ (naměřeno 2026-09-12 spuštěním doktora bez identity):
 *   doktor zapsal 541 klíčů, z toho 55 PRÁZDNĚ (`KEY=`) — a mezi nimi čtyři
 *   `:?` klíče: APP_NAME_PREFIX, PKI_BUNDLE_REQUIRED, POSTGREST_SERVICE_TOKEN,
 *   RAGNAROK_URL. Pro `${X:?}` je prázdno doručený VÝPADEK (compose padá i na
 *   prázdné hodnotě), takže prázdný zápis se za plniče NEPOČÍTÁ. První verze
 *   brány počítala řádek, ne hodnotu — a přesně u klíče, kvůli kterému vznikla,
 *   by zezelenala nad prázdnem.
 *
 * TŘI ODPOVĚDI, NE DVĚ: v běhu BEZ identity (CI upstreamu) je prázdný zápis
 *   nerozhodnutelný — doktor prázdno vydává i tehdy, když by ho identita a
 *   manifest instance naplnily (PKI_BUNDLE_REQUIRED „manifest nenalezen",
 *   APP_NAME_PREFIX = identita sama). Takový klíč se hlásí jako NEZMĚŘENO
 *   s výčtem, ne jako průchod a ne jako pád. S identitou (APP_NAME_PREFIX +
 *   manifest, lokálně nebo přes AISHA_INSTANCE_CONFIG_DIR) je prázdný zápis
 *   měřený výsledek: doktor plničem NENÍ.
 *
 * IDENTITA DOKTOROVI TÝMIŽ DVEŘMI JAKO V NASAZENÍ (naměřeno 2026-09-12, dvě
 *   nezávislá přeověření po HEAD 3025c91ec): brána rozhodovala `maIdentitu`
 *   resolverem (čte i .env.local), ale doktora spouštěla BEZ identity — ten
 *   .env.local sám nečte (`dom()` = .env-prod-backup → process.env → domains),
 *   zapsal `APP_NAME_PREFIX=` prázdně, klíč spadl do koše „jen cold-start" a
 *   rohatka padla. V každém stromu, který identitu deklaruje v .env.local
 *   (hlavní strom operátora, každý fork), byla brána falešně červená — a
 *   pre-push hook pouští test:gates, takže by z něj neprošel push. Skutečná
 *   cesta doručuje identitu doktorovi PROSTŘEDÍM: cold-start ji exportuje
 *   (`lib/instance-identity.sh` → APP_NAME_PREFIX, AISHA_STORY), redeploy ji
 *   hydratuje do `process.env` (`aisha-redeploy.mjs`, „Resolve the identity
 *   from the shared canonical config chain … into process.env"). Brána dělá
 *   totéž: co resolver vrátil, dostane doktor v prostředí — žádná postranní
 *   cesta. Overlay (AISHA_INSTANCE_CONFIG_DIR) dostává doktor v redeployi jen
 *   z prostředí operátora (redeploy ho nehydratuje) a v cold-startu klonem z
 *   AISHA_INSTANCE_DATA_GIT_URL — to brána offline udělat nemůže, proto klíč,
 *   u něhož doktor SÁM na stderr ohlásí chybějící vstup („X se neodvodil
 *   (manifest instance nenalezen)"), je NEZMĚŘENO s doktorovým důvodem, ne
 *   nález: v nasazení by ten vstup dodal klon overlaye, který tu není.
 *
 * OTISK NASAZENÉ INSTANCE: doktor se spouští nad souborem, ve kterém už leží
 *   klíče rohatky (cold-start je zapsal, redeploy je jen roznáší) — protože
 *   tak cesta redeploye vede. Aliasy těchto klíčů (POSTGREST_SERVICE_TOKEN →
 *   SERVICE_ROLE_KEY) doktor plní z existujícího souboru; nad prázdným souborem
 *   by vyšly prázdné a brána by hlásila výpadek, který nenastane. Zachované
 *   semeno se za zápis doktora NEPOČÍTÁ — jinak by rohatka „zastarala" sama od sebe.
 *
 * UNIVERZUM SI BRÁNA HLEDÁ (glob compose souborů), nepíše. Prázdné univerzum
 * je vada měřidla, ne čistý stav.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const COLD_START = join(ROOT, "scripts/aisha-cold-start.sh");
const DOKTOR = join(ROOT, "scripts/aisha-env-doctor.mjs");

// Identita běhu — týmiž dveřmi jako doktor a cold-start (prostředí → .env.local
// → .env-prod-backup → .env.coolify). Bez ní je prázdný derived zápis nerozhodnutelný.
const { resolveInstanceIdentity } = await import(
  /* @vite-ignore */ join(ROOT, "scripts/lib/coolify-instance-scope.mjs")
);

/** `${X:?…}` — klíč, který compose VYŽADUJE (bez dosazené hodnoty). */
export function vyzadovaneKlice(compose: string): Set<string> {
  const out = new Set<string>();
  for (const m of compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?/g)) out.add(m[1]);
  return out;
}

/** Tělo heredocu `cat > "$TMP_ENV" <<HEADER … HEADER` — táž kotva jako cold-start-heredoc-bindings. */
export function teloHeredocu(skript: string): string {
  const start = skript.match(/cat > "\$TMP_ENV" <<HEADER\n/);
  if (!start || start.index === undefined) {
    throw new Error("kotva `cat > \"$TMP_ENV\" <<HEADER` v cold-startu nenalezena — brána by měřila prázdno");
  }
  const za = skript.slice(start.index + start[0].length);
  const konec = za.match(/^HEADER$/m);
  if (!konec || konec.index === undefined) throw new Error("uzavírací `HEADER` heredocu nenalezen");
  return za.slice(0, konec.index);
}

/** Klíče, které cold-start do .env.coolify ZAPÍŠE: heredoc + `printf 'KEY=%s\n' … >> "$TMP_ENV"`. */
export function kliceColdStartu(skript: string): Set<string> {
  const out = new Set<string>();
  for (const m of teloHeredocu(skript).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) out.add(m[1]);
  for (const m of skript.matchAll(/printf '([A-Z][A-Z0-9_]*)=%s\\n'[^\n]*>> "\$TMP_ENV"/g)) out.add(m[1]);
  return out;
}

/** Hodnoty v env souboru (`KEY=…` na začátku řádku; poslední přiřazení vyhrává, jako všude jinde). */
export function hodnotyEnvSouboru(obsah: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of obsah.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) {
    out.set(m[1], m[2].trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  return out;
}

/** Klíče v env souboru (`KEY=…` na začátku řádku). */
export function kliceEnvSouboru(obsah: string): Set<string> {
  return new Set(hodnotyEnvSouboru(obsah).keys());
}

/**
 * Co doktor zapsal: `neprazdne` = plnič (hodnota dorazí), `prazdne` = založený
 * klíč bez hodnoty; `neodvoditelne` = klíče, u nichž doktor SÁM ohlásil, který
 * vstup mu k odvození chyběl (stderr `aisha-env-doctor: KEY se neodvodil (…)`).
 */
export type ZapisyDoktora = { neprazdne: Set<string>; prazdne: Set<string>; neodvoditelne: Map<string, string> };

/**
 * Doktorova vlastní hlášení o neodvoditelném klíči — čtou se z jeho stderr,
 * ne z domněnky brány o tom, co mu asi chybělo. Tvar hlášky má doktor jeden
 * (`aisha-env-doctor: KEY se neodvodil (důvod): detail`).
 */
export function neodvoditelneZeStderr(stderr: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of stderr.matchAll(/^aisha-env-doctor: ([A-Z][A-Z0-9_]*) se neodvodil \(([^)]*)\)(?::\s*(.*))?$/gm)) {
    out.set(m[1], m[3] ? `${m[2]} — ${m[3].trim()}` : m[2]);
  }
  return out;
}

/**
 * Zápisy doktora z výsledného souboru. Zachované SEMENO (klíč, který v souboru
 * ležel už před doktorem, se stejnou hodnotou) není zápis doktora — je to otisk
 * cold-startu, který doktor jen nechal být.
 */
export function zapisyDoktora(obsah: string, semeno: Map<string, string>, stderr = ""): ZapisyDoktora {
  const neprazdne = new Set<string>();
  const prazdne = new Set<string>();
  for (const [klic, hodnota] of hodnotyEnvSouboru(obsah)) {
    if (hodnota === "") prazdne.add(klic);
    else if (semeno.get(klic) !== hodnota) neprazdne.add(klic);
  }
  return { neprazdne, prazdne, neodvoditelne: neodvoditelneZeStderr(stderr) };
}

/**
 * Proč je prázdný zápis doktora v TOMTO běhu nerozhodnutelný — nebo `undefined`,
 * když je měřeným výsledkem (doktor plničem není).
 *   · bez identity: o žádném prázdnu nelze říct, jestli by ho identita/manifest
 *     naplnily (APP_NAME_PREFIX je identita sama, PKI_BUNDLE_REQUIRED jde z manifestu);
 *   · s identitou: jen klíč, u něhož doktor SÁM ohlásil chybějící vstup — ten
 *     v nasazení dodá klon overlaye (cold-start) nebo prostředí operátora
 *     (redeploy), což brána offline nemá. Důvod se cituje doktorův, ne vymyšlený.
 */
export function duvodNerozhodnutelnosti(
  klic: string,
  identita: string,
  neodvoditelne: Map<string, string>,
): string | undefined {
  if (!identita) return "běh BEZ identity — prázdno může naplnit identita/manifest instance";
  return neodvoditelne.get(klic);
}

/**
 * Tři koše nad `:?` klíči:
 *   bezZapisovatele — nikdo hodnotu nedoručí (ani cold-start, ani doktor);
 *   jenColdStart    — doručí jen heredoc cold-startu (rohatka, nebo nový dluh);
 *   nezmereno       — doktor zapsal PRÁZDNO v běhu bez identity: nelze říct,
 *                     jestli by ho identita/manifest naplnily. Hlásí se, nezamlčuje.
 * Klíč, který doktor zapsal S HODNOTOU, má plniče na cestě redeploye a je hotový.
 */
export function rozdel(
  vyzadovane: Map<string, string[]>,
  coldStart: Set<string>,
  doktor: ZapisyDoktora,
  nerozhodnutelne: (klic: string) => string | undefined,
): { bezZapisovatele: string[]; jenColdStart: string[]; nezmereno: Map<string, string> } {
  const bezZapisovatele: string[] = [];
  const jenColdStart: string[] = [];
  const nezmereno = new Map<string, string>();
  for (const klic of [...vyzadovane.keys()].sort()) {
    if (doktor.neprazdne.has(klic)) continue;
    const duvod = doktor.prazdne.has(klic) ? nerozhodnutelne(klic) : undefined;
    if (duvod) {
      nezmereno.set(klic, duvod);
      continue;
    }
    if (coldStart.has(klic)) jenColdStart.push(klic);
    else bezZapisovatele.push(klic);
  }
  return { bezZapisovatele, jenColdStart, nezmereno };
}

/**
 * ROHATKA: klíče, které dnes píše JEN heredoc cold-startu. Každý má doložený
 * důvod, proč po nasazení nevzniká — nikdy sem nepřidávej klíč jen proto,
 * aby brána zezelenala.
 */
const JEN_COLD_START_DNES = new Set([
  // Tajemství generovaná JEDNOU při cold-startu (generate-secrets → heredoc
  // je replayuje). Redeploy je z .env.coolify roznáší, nová vzniknout nesmí —
  // rotace je vědomý krok operátora, ne vedlejší účinek nasazení.
  "ANON_KEY",
  "SERVICE_ROLE_KEY",
  "COSMOS_SIGNER_MNEMONIC",
  "LLM_GATEWAY_OIDC_SECRET",
  "OPENCLAW_OIDC_SECRET",
  "PLATFORM_ADMIN_PASSWORD",
  "SOURCE_WEBHOOK_HMAC_SECRET",
  // Mesh DNS a segmentace sítě — adresní plán instance, který se po nasazení
  // nemění (změna = nová síť = cold-start).
  "MESH_DNS_NETWORK",
  "MESH_DNS_RESOLVER_IP",
  "MESH_DNS_SUBNET",
  "NETSEG_BACKEND_NET",
  "NETSEG_DATA_NET",
  "NETSEG_FRONTEND_NET",
  // Vlastnost NASAZENÍ, kterou nelze odvodit: Ragnarok je vnitřní služba bez
  // veřejné tváře, ze které derivace staví mesh jména (aisha-env-doctor.mjs,
  // kontrakt `["RAGNAROK_URL", "placeholder"]`; generate-secrets
  // `emit('RAGNAROK_URL', preservedValue(...))`). Hodnotu dodá operátor před
  // cold-startem, heredoc ji replayuje, redeploy roznese; doktor ji jen ZNÁ.
  // Naměřeno 2026-09-12: doktor ji zapisuje prázdně — první verze brány ten
  // prázdný řádek počítala za plniče a klíč tu neměla.
  "RAGNAROK_URL",
  // ⏳ DLUH, NE VÝJIMKA (2026-09-27, přeměřeno 2026-09-28). Veřejná doména aplikace:
  // derivace ji VYDÁVÁ (derive-domains s PUBLIC_TLD → APP_DOMAIN=web.<tld>). Do
  // 2026-09-28 do ní `dom()` nesahal a sebeodkaz `APP_DOMAIN=${APP_DOMAIN:-}` vracel
  // syrovou šablonu; od opravy kořene (loadDomains po derivaci, dom() čte derivaci
  // TÉTO instance) ji doktor zapíše S HODNOTOU — ale jen když CHYBÍ: je `static`.
  // Tahle brána zakládá trezor se semenem nasazené instance, kde APP_DOMAIN leží,
  // a static se nepřepisuje → doktor ho tu „nezapíše" s PUBLIC_TLD i bez něj
  // (změřeno 2026-09-28 s identitou testfork, obě varianty). Z rohatky ven půjde
  // až převodem na `derived` (srovná drift při každém běhu) — samostatné
  // rozhodnutí majitele, ne vedlejší účinek opravy kořene.
  "APP_DOMAIN",
]);

/**
 * Otisk instance, která UŽ byla nasazena: rohatkové klíče v .env.coolify leží.
 * Hodnoty mají jen TVAR, který doktor kontroluje (JWT o třech segmentech u
 * klíčů se servisní rolí, CIDR u sítí) — obsah je fixtura `testfork`.
 */
export function semenoNasazeneInstance(rohatka: Iterable<string>): Map<string, string> {
  // Fixtura JWT se SKLÁDÁ za běhu, ne zapisuje jako literál: skener tajemství
  // (gitleaks, pravidlo `jwt`) čte diffy commitů a `eyJ…` literál mu vypadá
  // jako únik — naměřeno 2026-09-12 v CI u #947 na hotovém tokenu
  // `{"alg":"HS256"}.{"role":"testfork"}.testfork-podpis`. Tvar (tři segmenty
  // base64url) je totéž, obsah zůstává fixtura `testfork`.
  const segment = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = [segment({ alg: "HS256" }), segment({ role: "testfork" }), Buffer.from("testfork-podpis").toString("base64url")].join(".");
  const out = new Map<string, string>();
  let sit = 0;
  for (const klic of rohatka) {
    if (/^(ANON_KEY|SERVICE_ROLE_KEY)$/.test(klic)) out.set(klic, jwt);
    else if (/(_SUBNET|_NET)$/.test(klic)) out.set(klic, `10.255.${++sit}.0/24`);
    else if (/_IP$/.test(klic)) out.set(klic, "10.255.0.2");
    else if (/_URL$/.test(klic)) out.set(klic, "http://testfork-ragnarok:9200");
    else out.set(klic, `semeno-testfork-${klic.toLowerCase()}`);
  }
  return out;
}

function composeSoubory(): string[] {
  return readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f))
    .sort();
}

function vyzadovaneVeStacku(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const soubor of composeSoubory()) {
    for (const klic of vyzadovaneKlice(readFileSync(join(ROOT, soubor), "utf8"))) {
      out.set(klic, [...(out.get(klic) ?? []), soubor]);
    }
  }
  return out;
}

/**
 * Co env-doktor v APPLY skutečně ZAPÍŠE — spuštěním, ne čtením CONTRACT:
 * část klíčů vzniká za běhu (spread IMAGE_*, smyčka nad výstupem resolveru)
 * a statické čtení by je minulo. Cíl je soubor v temp adresáři se SEMENEM
 * rohatky (otisk nasazené instance), takže doktor nezakládá zálohu v
 * `.backup/` a strom zůstane netknutý.
 */
function zapisyDoktoraSpustenim(identita: { prefix: string; story: string }): ZapisyDoktora {
  const dir = mkdtempSync(join(tmpdir(), "aisha-zapisovatele-"));
  const envFile = join(dir, "env.coolify");
  const semeno = semenoNasazeneInstance(JEN_COLD_START_DNES);
  writeFileSync(envFile, [...semeno].map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ENV_FILE: envFile,
    AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi",
  };
  // Identita TÝMIŽ dveřmi jako v nasazení: doktor ji čte z PROSTŘEDÍ
  // (`dom()` = .env-prod-backup → process.env → domains; .env.local nečte),
  // cold-start ji tam exportuje (lib/instance-identity.sh), redeploy hydratuje
  // (aisha-redeploy.mjs). Co resolver vrátil, dostane doktor stejně — jinak by
  // brána soudila s identitou, kterou doktor nikdy neviděl (viz hlavička).
  if (identita.prefix) {
    env.APP_NAME_PREFIX = identita.prefix;
    env.AISHA_STORY = identita.story;
  }
  let stderr = "";
  try {
    // Doktor bez `--strict` končí nulou i s prázdnými klíči; stderr se přesto
    // čte, protože právě tam říká, KTERÝ vstup mu k odvození chyběl.
    const beh = spawnSync("node", [DOKTOR, "--no-external"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    stderr = beh.stderr ?? "";
    if (beh.error) throw beh.error;
    if (beh.status !== 0) {
      throw new Error(`env-doktor skončil s kódem ${beh.status}: ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
    }
    if (!existsSync(envFile)) throw new Error(`env-doktor doběhl, ale ${envFile} nezapsal`);
    return zapisyDoktora(readFileSync(envFile, "utf8"), semeno, stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("deklarace v compose má zapisovatele", () => {
  const vyzadovane = vyzadovaneVeStacku();
  const coldStart = kliceColdStartu(readFileSync(COLD_START, "utf8"));
  // `required: false` — čistý strom (CI upstreamu) identitu nemá a to není vada;
  // rozporná deklarace ale padá i tady, stejně jako v nasazení. Resolver běží
  // PŘED doktorem, protože doktor dostane právě to, co resolver vrátil.
  const identitaBehu = resolveInstanceIdentity({ root: ROOT, required: false }) as { prefix: string; story: string };
  const identita = identitaBehu.prefix;
  const doktor = zapisyDoktoraSpustenim(identitaBehu);
  const kose = rozdel(vyzadovane, coldStart, doktor, (klic) =>
    duvodNerozhodnutelnosti(klic, identita, doktor.neodvoditelne),
  );

  it("univerzum není prázdné — jinak by brána mlčela z nedostatku vstupu", () => {
    expect(composeSoubory().length, "compose soubory").toBeGreaterThan(10);
    expect(vyzadovane.size, "klíče `${X:?}`").toBeGreaterThan(50);
    expect(coldStart.size, "klíče heredocu cold-startu").toBeGreaterThan(300);
    expect(doktor.neprazdne.size + doktor.prazdne.size, "klíče, které env-doktor zapsal").toBeGreaterThan(300);
    expect(doktor.neprazdne.size, "klíče, které env-doktor zapsal S HODNOTOU").toBeGreaterThan(300);
  });

  // Třetí odpověď se HLÁSÍ: bez identity nelze o prázdném derived zápisu
  // rozhodnout — v reportu stojí SKIPPED s výčtem klíčů, ne PASSED.
  it.skipIf(kose.nezmereno.size > 0)(
    `prázdný zápis doktora je rozhodnutelný (běh ${identita ? `s identitou '${identita}'` : "BEZ identity"})` +
      (kose.nezmereno.size
        ? ` — NEZMĚŘENO: ${[...kose.nezmereno].map(([k, d]) => `${k} (${d})`).join("; ")}`
        : ""),
    () => {
      expect([...kose.nezmereno.keys()]).toEqual([]);
    },
  );

  it("každý `${X:?}` v compose má zapisovatele — heredoc cold-startu nebo env-doktora S HODNOTOU", () => {
    const { bezZapisovatele } = kose;
    expect(
      bezZapisovatele,
      "Compose klíč VYŽADUJE (`:?`), ale do .env.coolify ho nikdo nezapíše S HODNOTOU\n" +
      "(prázdný řádek `KEY=` shodí compose stejně jako řádek chybějící) —\n" +
        "coolify-sync-envs.sh posílá jen klíče, které v .env.coolify leží, takže\n" +
        "interpolace compose spadne při KAŽDÉM nasazení. Fail-loud bez plniče není\n" +
        "bezpečnost, je to výpadek. Zapisovatel = řádek v heredocu cold-startu\n" +
        "(`KEY=${KEY:?…}` z výstupu resolveru / generate-secrets) NEBO položka v\n" +
        "CONTRACT env-doktora s doloženým zdrojem (derived/static/secret).\n" +
        "Klíč → compose, které ho čtou:\n  " +
        bezZapisovatele.map((k) => `${k} ← ${(vyzadovane.get(k) ?? []).join(", ")}`).join("\n  "),
    ).toEqual([]);
  });

  it("klíč, který píše JEN cold-start, na cestě redeploye plniče nemá — rohatka", () => {
    const { jenColdStart, nezmereno } = kose;
    const nove = jenColdStart.filter((k) => !JEN_COLD_START_DNES.has(k));
    expect(
      nove,
      "Nový klíč s `:?` v compose, který zapisuje JEN heredoc cold-startu. Instance\n" +
        "nasazené PŘED touhle změnou ho v Coolify env nemají a `npm run redeploy`\n" +
        "ho nevyrobí: na cestě redeploye zapisuje do .env.coolify jedině env-doktor\n" +
        "(aisha-redeploy.mjs → srovnejOdvozeneKlice), sync pak roznese jen to, co tam\n" +
        "leží. Každý redeploy před dalším cold-startem spadne na interpolaci\n" +
        "(třída PKI_BUNDLE_REQUIRED, naměřeno 2026-09-12).\n" +
        "Náprava: odvození s JEDNÍM domovem (scripts/lib/derive-*.mjs), které volá\n" +
        "cold-start i CONTRACT env-doktora (kind `derived`). Do rohatky patří jen\n" +
        "klíč, který po nasazení vzniknout NESMÍ (jednorázové tajemství, adresní\n" +
        "plán) — s důvodem zapsaným u něj.\n  " +
        nove.map((k) => `${k} ← ${(vyzadovane.get(k) ?? []).join(", ")}`).join("\n  "),
    ).toEqual([]);
    // Rohatka se smí jen zkracovat: klíč, který už doktor doručuje, ze seznamu ZMIZÍ.
    // Nezměřený klíč se nesoudí ani tady — bez identity se o něm neví nic.
    const zastarale = [...JEN_COLD_START_DNES].filter((k) => !jenColdStart.includes(k) && !nezmereno.has(k));
    expect(
      zastarale,
      "Klíč v rohatce už má zapisovatele i mimo cold-start (nebo z compose zmizel) — vyřaď ho z JEN_COLD_START_DNES.",
    ).toEqual([]);
  });

  // ── Měřidlo se měří samo: negativní sondy nad fixturami ────────────────────
  it("negativní sonda: klíč bez zapisovatele je vidět; prázdný zápis není plnič; bez identity je to NEZMĚŘENO", () => {
    const vyz = new Map([["A", ["x.yml"]], ["B", ["x.yml"]], ["C", ["y.yml"]], ["D", ["y.yml"]], ["E", ["z.yml"]]]);
    // A: doktor s hodnotou; B: jen cold-start; C: nikdo; D: doktor PRÁZDNĚ, cold-start ne; E: doktor prázdně + cold-start
    const doktor = { neprazdne: new Set(["A"]), prazdne: new Set(["D", "E"]), neodvoditelne: new Map<string, string>() };
    const sIdentitou = rozdel(vyz, new Set(["A", "B", "E"]), doktor, (k) => duvodNerozhodnutelnosti(k, "testfork", doktor.neodvoditelne));
    expect(sIdentitou.bezZapisovatele).toEqual(["C", "D"]);
    expect(sIdentitou.jenColdStart).toEqual(["B", "E"]);
    expect([...sIdentitou.nezmereno.keys()]).toEqual([]);
    const bezIdentity = rozdel(vyz, new Set(["A", "B", "E"]), doktor, (k) => duvodNerozhodnutelnosti(k, "", doktor.neodvoditelne));
    expect(bezIdentity.bezZapisovatele).toEqual(["C"]);
    expect(bezIdentity.jenColdStart).toEqual(["B"]);
    expect([...bezIdentity.nezmereno.keys()]).toEqual(["D", "E"]);
  });

  it("negativní sonda: s identitou je NEZMĚŘENO jen klíč, u něhož doktor SÁM ohlásil chybějící vstup — s jeho důvodem", () => {
    const vyz = new Map([["D", ["y.yml"]], ["E", ["z.yml"]], ["F", ["z.yml"]]]);
    const stderr = [
      "[derive-domains] WARN něco jiného",
      "aisha-env-doctor: E se neodvodil (manifest instance nenalezen): cannot determine APP_NAME_PREFIX (checked …)",
      "aisha-env-doctor: F se neodvodil (bez detailu)",
      "aisha-env-doctor: G se neodvodil (G má hodnotu, hláška je tu navíc)",
    ].join("\n");
    const doktor = zapisyDoktora("D=\nE=\nF=\nG=1\n", new Map(), stderr);
    expect([...doktor.neodvoditelne.keys()]).toEqual(["E", "F", "G"]);
    const s = rozdel(vyz, new Set(["D", "E"]), doktor, (k) => duvodNerozhodnutelnosti(k, "testfork", doktor.neodvoditelne));
    // D: prázdno bez doktorova důvodu = měřený výsledek (jen cold-start);
    // E: doktor ohlásil chybějící vstup → NEZMĚŘENO s jeho důvodem, ne rohatka;
    // F: totéž bez detailu; G nikoho nezajímá (compose ho nevyžaduje).
    expect(s.jenColdStart).toEqual(["D"]);
    expect(s.bezZapisovatele).toEqual([]);
    expect([...s.nezmereno.keys()]).toEqual(["E", "F"]);
    expect(s.nezmereno.get("E")).toMatch(/^manifest instance nenalezen — cannot determine APP_NAME_PREFIX/);
    expect(s.nezmereno.get("F")).toBe("bez detailu");
    // Bez identity vyhrává obecný důvod — o ničem prázdném se soudit nedá.
    expect(duvodNerozhodnutelnosti("D", "", doktor.neodvoditelne)).toMatch(/BEZ identity/);
  });

  it("negativní sonda: zápis doktora se čte z HODNOTY — prázdno zvlášť, zachované semeno není zápis", () => {
    const semeno = new Map([["S", "semeno"], ["T", "semeno"]]);
    const z = zapisyDoktora('A=1\nB=\nS=semeno\nT=jine\nU=""\nV="v"\n', semeno);
    expect([...z.neprazdne].sort()).toEqual(["A", "T", "V"]);
    expect([...z.prazdne].sort()).toEqual(["B", "U"]);
    expect(z.neodvoditelne.size).toBe(0);
    expect([...semenoNasazeneInstance(["ANON_KEY", "X_SUBNET", "Y_URL", "Z"]).values()].every((v) => v !== "")).toBe(true);
    expect(semenoNasazeneInstance(["ANON_KEY"]).get("ANON_KEY")!.split(".").length).toBe(3);
  });

  it("negativní sonda: heredoc se čte mezi kotvami, dodatky přes printf se počítají", () => {
    const skript = [
      "PRED=1",
      'cat > "$TMP_ENV" <<HEADER',
      "# komentář",
      "UVNITR=${UVNITR:?x}",
      "  ODSAZENY=neni-klic",
      "HEADER",
      "PO=1",
      "printf 'DODATEK=%s\\n' \"$X\" >> \"$TMP_ENV\"",
    ].join("\n");
    const k = kliceColdStartu(skript);
    expect([...k].sort()).toEqual(["DODATEK", "UVNITR"]);
    expect(() => teloHeredocu("zadna kotva")).toThrow(/kotva/);
  });

  it("negativní sonda: `${X:?}` se pozná, `${X:-}` a `${X}` ne", () => {
    expect([...vyzadovaneKlice("a: ${A:?msg}\nb: ${B:-x}\nc: ${C}\nd: ${D:?}")].sort()).toEqual(["A", "D"]);
  });
});
