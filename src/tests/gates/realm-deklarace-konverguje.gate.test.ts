/**
 * Brána: deklarace klientů realmu KONVERGUJE, ne jen jednou vznikne
 *
 * ⛔ NAMĚŘENO 2026-09-05 na produkci forku. `keycloak/aisha-realm.json` je
 * zdroj pravdy o klientech realmu — ale `--import-realm` importuje POUZE na
 * prázdný realm (první boot). Je to záměr (re-deploy nesmí přerazit admina,
 * který si změnil heslo), jenže důsledek je, že se deklarace ke KONZUMENTOVI
 * dostane JEDNOU. Každá pozdější změna je tichá: soubor tvrdí jedno, běžící
 * realm drží druhé, a nikdo ty dvě věci neporovnává.
 *
 * Konkrétní škoda: klient `aisha-bootstrap` dostal v šabloně
 * `"secret": "${AISHA_BOOTSTRAP_CLIENT_SECRET}"`, aby si realm předgenerovanou
 * hodnotu PŘEVZAL. Na instanci, kde realm už existoval, se nestalo NIC —
 * `netbird-peer-discover` dál hlásil „Pověření bootstrap uživatele chybí",
 * `edge` se odmítal nasadit bez `CORE_MESH_IP` a celý mesh stál.
 *
 * Táž třída jako všechno ostatní z toho nasazení: DEKLARACE, KTERÁ SE
 * K SPOTŘEBITELI NEDOSTANE. `mesh_default` bez konzumenta, manifest bez
 * topologie, doktor měřící šablonu místo hodnoty — a tady šablona realmu,
 * kterou po prvním bootu nikdo nečte.
 *
 * ── Co brána hlídá ───────────────────────────────────────────────────────
 *   1. reconciler existuje a je v image (jinak by ho compose nemohl spustit)
 *   2. compose ho SPOUŠTÍ a čeká na zdravý Keycloak
 *   3. běží proti VNITŘNÍ adrese — instance za NAT nemá Keycloak zvenčí
 *      dosažitelný dřív, než vznikne mesh, a mesh na ten smír sám čeká
 *   4. dostane KAŽDOU proměnnou, kterou šablona deklaruje — jinak by pro
 *      chybějící tiše nic neudělal (univerzum se odvozuje ze šablony, ne
 *      z ručního seznamu: ten tu už jednou byl a fork ho přerostl)
 *   5. secret po zápisu ZPĚTNĚ ČTE — některé verze Keycloaku update tiše
 *      ignorují (doloženo v scripts/provision-sso.sh)
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const RECONCILER = join(ROOT, "keycloak/reconcile-realm-clients.sh");
const COMPOSE = join(ROOT, "docker-compose.coolify-keycloak.yml");
const DOCKERFILE = join(ROOT, "Dockerfile.keycloak");
const SABLONA = join(ROOT, "keycloak/aisha-realm.json");

/**
 * Proměnné, které šablona deklaruje jako heslo SERVISNÍHO účtu.
 *
 * ⛔ UKAZATEL, NE HODNOTA. Šablona nese jen JMÉNO proměnné v atributu
 * `aisha.passwordFrom`. Inline `credentials: [{value: "${VAR}"}]` by Pass 2
 * dosadila SKUTEČNÝM heslem do souboru na disku — a navíc porušila bránu
 * netbird-account-owner, která u `aisha-bootstrap` inline credentials zakazuje.
 * (První verze tohohle testu to inline dělala; chytila ji ta brána.)
 */
function deklarovanaHesla(): string[] {
  const d = JSON.parse(readFileSync(SABLONA, "utf8")) as {
    users?: Array<{ attributes?: Record<string, string[] | string> }>;
  };
  const out = new Set<string>();
  for (const u of d.users ?? []) {
    const a = u.attributes?.["aisha.passwordFrom"];
    for (const v of Array.isArray(a) ? a : a ? [a] : []) {
      if (/^[A-Z_0-9]+$/.test(v)) out.add(v);
    }
  }
  return [...out].sort();
}

/** Proměnné, které šablona u klientů deklaruje jako zdroj secretu. */
function deklarovanePromenne(): string[] {
  const t = readFileSync(SABLONA, "utf8");
  const d = JSON.parse(t) as { clients?: Array<{ secret?: string }> };
  const out = new Set<string>();
  for (const c of d.clients ?? []) {
    const m = /^\$\{([A-Z_0-9]+)\}$/.exec(c.secret ?? "");
    if (m) out.add(m[1]);
  }
  return [...out].sort();
}

const RC = existsSync(RECONCILER) ? readFileSync(RECONCILER, "utf8") : "";
const CMP = existsSync(COMPOSE) ? readFileSync(COMPOSE, "utf8") : "";
const DF = existsSync(DOCKERFILE) ? readFileSync(DOCKERFILE, "utf8") : "";

/** Blok služby `realm-sync` z compose. */
function blokRealmSync(): string {
  const i = CMP.indexOf("\n  realm-sync:");
  if (i < 0) return "";
  const j = CMP.indexOf("\n  ", CMP.indexOf("\n", i + 3));
  // konec = další služba na téže úrovni, nebo top-level klíč
  const konec = CMP.slice(i + 1).search(/\n(?:[a-z]| {2}[a-z][a-z0-9_-]*:\s*\n)/);
  return konec < 0 ? CMP.slice(i) : CMP.slice(i, i + 1 + konec + 200);
}

describe("deklarace realmu konverguje", () => {
  test("zdroje se našly (jinak brána nic neměří)", () => {
    expect(existsSync(SABLONA), "keycloak/aisha-realm.json chybí").toBe(true);
    expect(existsSync(COMPOSE), "docker-compose.coolify-keycloak.yml chybí").toBe(true);
    expect(
      deklarovanePromenne().length,
      "šablona nedeklaruje ANI JEDEN klientský secret z prostředí — brána by měřila prázdno",
    ).toBeGreaterThan(0);
  });

  test("reconciler existuje a je v image", () => {
    expect(
      existsSync(RECONCILER),
      `keycloak/reconcile-realm-clients.sh chybí. Bez něj se šablona realmu dostane\n` +
        `ke Keycloaku JEN při prvním bootu (--import-realm na prázdný realm) a každá\n` +
        `pozdější změna deklarace je tichá.`,
    ).toBe(true);
    expect(
      DF,
      "Dockerfile.keycloak reconciler nekopíruje — compose by ho neměl čím spustit",
    ).toContain("reconcile-realm-clients.sh");
  });

  test("compose ho spouští a čeká na ZDRAVÝ Keycloak", () => {
    const blok = blokRealmSync();
    expect(blok.length, "služba realm-sync v compose není").toBeGreaterThan(0);
    expect(blok, "realm-sync nespouští reconciler").toContain("reconcile-realm-clients.sh");
    expect(
      blok,
      "realm-sync nečeká na zdravý keycloak — smír proti startujícímu KC by selhal na přihlášení",
    ).toContain("service_healthy");
    expect(
      blok,
      "realm-sync není jednorázový (restart: \"no\") — smír má doběhnout, ne se točit",
    ).toMatch(/restart:\s*"no"/);
  });

  test("běží proti VNITŘNÍ adrese, ne přes veřejnou tvář", () => {
    // ⛔ Instance za NAT nemá Keycloak zvenčí dosažitelný dřív, než vznikne mesh
    // — a mesh na tenhle smír sám čeká (discovery potřebuje bootstrap secret).
    // Kdyby smír mířil na veřejnou doménu, kruh by se zavřel znovu.
    const blok = blokRealmSync();
    expect(
      blok,
      `realm-sync nemíří na vnitřní adresu Keycloaku. Veřejná tvář vede přes edge,\n` +
        `edge čeká na CORE_MESH_IP, ten na discovery a discovery právě na secret,\n` +
        `který tenhle smír srovnává — to je přesně ten kruh, kvůli kterému vznikl.`,
    ).toMatch(/KC_INTERNAL_URL:\s*\$\{KEYCLOAK_INTERNAL_URL/);
    // ⛔ A NESMÍ to být HOLÉ JMÉNO. První verze téhle brány tvrdila
    // `http://keycloak:8080` — tedy KODIFIKOVALA MOU VLASTNÍ CHYBU. Chytila ji
    // až brána jmeno-na-sdilene-siti-nese-identitu: `internal` i `coolify` jsou
    // SDÍLENÉ sítě, holé jméno na nich nárokuje i cizí nájemník a DNS mezi
    // stejnojmennými round-robinuje — smír by srovnával secrety cizího Keycloaku.
    expect(
      blok,
      "realm-sync míří na HOLÉ jméno služby; na sdílené síti to jméno nárokuje i cizí nájemník",
    ).not.toMatch(/KC_INTERNAL_URL:\s*https?:\/\/[a-z][a-z0-9-]*:/);
  });

  test("dostane KAŽDOU proměnnou, kterou šablona deklaruje", () => {
    // Univerzum se odvozuje ze šablony. Ručně držený seznam tu už jednou byl
    // a fork ho přerostl (openclaw-proxy) — viz render-realm-and-start.sh.
    const blok = blokRealmSync();
    const chybi = deklarovanePromenne().filter((v) => !blok.includes(`${v}:`));
    expect(
      chybi,
      `Tyhle proměnné šablona u klientů deklaruje, ale realm-sync je nedostane:\n` +
        chybi.map((v) => `  ${v}`).join("\n") +
        `\n\nPro chybějící by smír tiše neudělal nic — a přesně tak vypadá vada,\n` +
        `kterou má hlídat: deklarace, která se ke konzumentovi nedostane.`,
    ).toEqual([]);
  });

  test("srovnává i HESLA servisních účtů — druhou polovinu páru", () => {
    // ⛔ `netbird-peer-discover` se hlásí přes ROPC (grant_type=password), takže
    // potřebuje OBOJE: secret KLIENTA i heslo UŽIVATELE. Naměřeno 2026-09-05:
    // šablona měla u `aisha-bootstrap` `"credentials": []`, zatímco
    // AISHA_BOOTSTRAP_PASSWORD v .env.coolify celou dobu leželo. Oprava jen
    // secretu by nestačila — ROPC by padlo o krok dál a vypadalo by to jako
    // úplně jiná vada.
    const hesla = deklarovanaHesla();
    expect(
      hesla.length,
      "šablona nedeklaruje heslo ŽÁDNÉMU servisnímu účtu — druhá polovina páru chybí",
    ).toBeGreaterThan(0);
    // ⛔ MĚŘÍ SE PŘÍKAZOVÝ ŘÁDEK, NE VÝSKYT ŘETĚZCE. První verze hledala
    // `--temporary` kdekoli v souboru a matchla KOMENTÁŘ, který ten přepínač
    // cituje — zelená, a přitom neměřila nic.
    //
    // ⛔ A MĚŘÍ SE ZÁMĚR, NE TVAR. Druhá verze VYŽADOVALA `--temporary false`,
    // jenže `-t, --temporary` je v kcadm PŘEPÍNAČ BEZ HODNOTY (set-password
    // --help), takže `false` se předalo jako další argument a příkaz při prvním
    // ostrém běhu spadl. Brána tedy vynucovala tvar, který NEFUNGUJE.
    //
    // Trvalé heslo se dostane tím, že se přepínač VYNECHÁ. Hlídá se proto, že
    // tam NENÍ — dočasné heslo by ROPC odmítlo („Account is not fully set up“).
    // ⛔ VYBERE SE ŘÁDEK S VOLÁNÍM, NE KOMENTÁŘ. Komentáře výš ten přepínač
    // CITUJÍ, takže `/^.*set-password.*$/m` trefil dokumentaci — počtvrté týž
    // trap za dva dny. Rozlišuje se podle `$KCADM`: to je proměnná se skutečnou
    // cestou k binárce, kterou próza nepoužívá.
    const prikaz = (RC.match(/^[^#\n]*\$KCADM\s+set-password.*$/m) ?? [""])[0];
    expect(prikaz, "reconciler hesla vůbec nenastavuje").toContain("set-password");
    expect(
      prikaz,
      `Příkaz nastavuje heslo jako DOČASNÉ. \`-t, --temporary\` je přepínač bez\n` +
        `hodnoty, takže trvalé heslo znamená ho VYNECHAT; dočasné by ROPC odmítlo\n` +
        `(„Account is not fully set up“) a netbird discovery by se nepřihlásilo.`,
    ).not.toMatch(/--temporary|(?:^|\s)-t(?:\s|$)/);
    const blok = blokRealmSync();
    const chybi = hesla.filter((v) => !blok.includes(`${v}:`));
    expect(
      chybi,
      `Tahle hesla šablona deklaruje, ale realm-sync je nedostane:\n` +
        chybi.map((v) => `  ${v}`).join("\n"),
    ).toEqual([]);
  });

  test("zapíná SERVISNÍ ÚČTY klientům, kterým je šablona deklaruje", () => {
    // ⛔ NAMĚŘENO 2026-09-07 na produkci forku: secrety srovnané („shoda"),
    // a přesto client_credentials pro aisha-pki-issuer / netbird-backend /
    // aisha-user-admin končilo 401 `Client not enabled to retrieve service
    // account` — živý realm měl serviceAccountsEnabled=false, šablona true
    // (realm vznikl importem, který na 26.0.7 padal právě při zakládání
    // servisních účtů; 26.0.8 už existující klienty nepřepsal). Fáze B
    // bootstrapu tím stála a mesh se neměl jak přihlásit. Secret bez zapnutého
    // servisního účtu je klíč od dveří, které nejsou.
    const d = JSON.parse(readFileSync(SABLONA, "utf8")) as {
      clients?: Array<{ clientId?: string; serviceAccountsEnabled?: boolean }>;
    };
    const sa = (d.clients ?? []).filter((c) => c.serviceAccountsEnabled).map((c) => c.clientId);
    expect(sa.length, "šablona nedeklaruje servisní účet ŽÁDNÉMU klientovi — brána by hlídala prázdno").toBeGreaterThan(0);
    // ⛔ VYBÍRÁ SE ŘÁDEK S VOLÁNÍM (`$KCADM`), NE KOMENTÁŘ — táž past jako u hesel.
    const zapnuti = (RC.match(/^[^#\n]*\$KCADM\s+update\s+"clients\/\$UUID".*serviceAccountsEnabled=true.*$/m) ?? [""])[0];
    expect(
      zapnuti,
      "reconciler servisní účty NEZAPÍNÁ — secret bez servisního účtu je klíč od dveří, které nejsou (401 unauthorized_client)",
    ).toContain("serviceAccountsEnabled=true");
    const cteni = RC.match(/^[^#\n]*\$KCADM\s+get\s+"clients\/\$UUID".*--fields serviceAccountsEnabled.*$/gm) ?? [];
    expect(
      cteni.length,
      "příznak se před zapnutím i PO NĚM musí číst — update, který Keycloak tiše ignoruje, by jinak vypadal jako úspěch",
    ).toBeGreaterThanOrEqual(2);
    // Univerzum servisních účtů se odvozuje ze ŠABLONY, ne z ručního seznamu jmen.
    expect(RC, "seznam klientů se servisním účtem musí vzniknout ze šablony (awk nad serviceAccountsEnabled)").toMatch(
      /serviceAccountsEnabled"\[\[:space:\]\]\*:\[\[:space:\]\]\*true/,
    );
  });

  test("dorovnává servisním účtům ROLE, které jim šablona deklaruje", () => {
    // ⛔ NAMĚŘENO 2026-09-07 hned po zapnutí servisních účtů: uživatel
    // service-account-netbird-backend vznikl BEZ rolí realm-management
    // (manage-users/view-users/query-users), které mu šablona deklaruje. NetBird
    // management při validaci tokenu volá admin API (users/count) pod tímhle
    // účtem → 403 → každý token „invalid". Zapnutý servisní účet bez rolí je klíč
    // do prázdné místnosti; import role přiděluje jen při založení účtu.
    const d = JSON.parse(readFileSync(SABLONA, "utf8")) as {
      users?: Array<{ username?: string; clientRoles?: Record<string, string[]> }>;
    };
    const deklarovane = (d.users ?? []).filter(
      (u) => /^service-account-/.test(u.username ?? "") && (u.clientRoles?.["realm-management"] ?? []).length > 0,
    );
    expect(deklarovane.length, "šablona nedeklaruje role žádnému servisnímu účtu — brána by hlídala prázdno").toBeGreaterThan(0);
    // ⛔ VYBÍRÁ SE ŘÁDEK S VOLÁNÍM (`$KCADM`), NE KOMENTÁŘ.
    const pridani = (RC.match(/^[^#\n]*\$KCADM\s+add-roles\b.*--cclientid realm-management.*$/m) ?? [""])[0];
    expect(pridani, "reconciler role servisních účtů NEPŘIDÁVÁ — admin API by dál vracelo 403").toContain("add-roles");
    expect(pridani, "role se musí přidávat DEKLAROVANÉMU uživateli (--uusername), ne komukoli").toContain("--uusername");
    const cteni = RC.match(/^[^#\n]*\$KCADM\s+get\s+"users\/\$UID_S\/role-mappings\/clients\/\$RM_UUID".*$/gm) ?? [];
    expect(cteni.length, "role se před přidáním i PO NĚM musí číst — jinak by tichý neúspěch vypadal jako úspěch").toBeGreaterThanOrEqual(2);
    // Univerzum dvojic (účet, role) vzniká ze šablony (awk nad service-account-* + realm-management).
    expect(RC, "seznam rolí musí vzniknout ze šablony, ne z ručního seznamu").toMatch(/"username"\[\[:space:\]\]\*:\[\[:space:\]\]\*"service-account-/);
  });

  test("šablona nenese heslo SAMO, jen ukazatel na proměnnou", () => {
    // Inline hodnota by po Pass 2 skončila jako SKUTEČNÉ heslo v souboru na
    // disku kontejneru — a porušila by bránu netbird-account-owner.
    const raw = readFileSync(SABLONA, "utf8");
    const sUkazatelem = (JSON.parse(raw) as {
      users?: Array<{ username?: string; attributes?: Record<string, unknown>; credentials?: unknown[] }>;
    }).users?.filter((u) => u.attributes?.["aisha.passwordFrom"]) ?? [];
    expect(sUkazatelem.length, "žádný účet nemá ukazatel — brána měří prázdno").toBeGreaterThan(0);
    for (const u of sUkazatelem) {
      expect(
        u.credentials ?? [],
        `účet '${u.username}' má ukazatel A ZÁROVEŇ inline credentials — heslo by se ` +
          `dosadilo do souboru a brána netbird-account-owner by padla`,
      ).toEqual([]);
    }
  });

  test("hesla srovnává JEN u účtů, kterým je šablona deklaruje ukazatelem", () => {
    // Člověk (`__PLATFORM_ADMIN_PASSWORD__`, dosazený v Pass 1) se sem nikdy
    // nedostane — jeho heslo je literál a `temporary: true`. Původní záruka
    // „re-deploy nesmí přerazit admina, který si změnil heslo" tím platí dál.
    const d = JSON.parse(readFileSync(SABLONA, "utf8")) as {
      users?: Array<{
        username?: string;
        attributes?: Record<string, unknown>;
        credentials?: Array<{ value?: string }>;
      }>;
    };
    const sUkazatelem = (d.users ?? []).filter((u) => u.attributes?.["aisha.passwordFrom"]);
    const sLiteralem = (d.users ?? []).filter((u) =>
      (u.credentials ?? []).some((c) => c.value && !/^\$\{/.test(c.value)),
    );
    expect(sUkazatelem.length, "žádný účet s ukazatelem — brána měří prázdno").toBeGreaterThan(0);
    expect(
      sLiteralem.length,
      "v šabloně není žádný účet s literálním heslem — pak tenhle test nehlídá nic",
    ).toBeGreaterThan(0);
    // Ten s literálem NESMÍ být v univerzu smíru.
    for (const u of sLiteralem) {
      expect(
        sUkazatelem.map((x) => x.username),
        `účet '${u.username}' má literální heslo a přesto by ho smír přerazil`,
      ).not.toContain(u.username);
    }
  });

  test("secret po zápisu ZPĚTNĚ ČTE", () => {
    // Některé verze Keycloaku update secretu tiše ignorují (doloženo
    // v scripts/provision-sso.sh ř. 279–290). Bez read-backu by smír hlásil
    // úspěch a konzumenti by dostávali invalid_client.
    expect(
      RC,
      `Reconciler po zápisu secret nečte zpět. Keycloak ho umí TIŠE IGNOROVAT,\n` +
        `takže by smír hlásil úspěch a OIDC konzumenti by dostali invalid_client.`,
    ).toMatch(/client-secret/);
    expect(RC, "chybí hlasitý pád při neuloženém secretu").toMatch(/NEULOŽIL/);
  });

  test("nesahá na uživatele ani role — jen na deklarované klienty", () => {
    // Původní obava „re-deploy nesmí přerazit admina, který si změnil heslo"
    // platí dál. Smír ji neruší, jen ji zužuje na to, co skutečně chrání.
    expect(RC).not.toMatch(/\bkcadm[^\n]*\b(users|roles|groups)\b[^\n]*(update|create|delete)/);
    expect(RC, "smír musí pracovat s klienty").toMatch(/clients\//);
  });
});
