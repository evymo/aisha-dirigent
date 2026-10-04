/**
 * Jména instancí, která do stacku nepatří — JEDEN domov pravidla.
 *
 * PROČ SDÍLENÝ MODUL (naměřeno 2026-09-12, HEAD 239361626)
 * ---------------------------------------------------------
 * Brána `stack-nesmi-znat-jmeno-instance` odvozovala množinu jmen ze čtyř
 * kanálů (instances/, remoty, identita stromu, registr forků na Forgejo) —
 * a vedle ní dvě n8n brány (tři asserce) měřily totéž pravidlo VLASTNÍM literálem
 * `/aisha-|<fork>-/`: jménem JEDNÉ skutečné instance. To je vzorek, ne
 * vlastnost — sedmá instance tudy projde zeleně, a generická brána přitom
 * nese jméno instance, které sama zakazuje. Odvození jmen tedy žije tady a
 * obě třídy bran ho importují; `aisha` je jméno PLATFORMY (třída squattingu
 * #163) a měří se vždy, i když o instancích není známo nic.
 *
 * TVAR NÁLEZU JE HRANICE PŘED JMÉNEM, NE PÍSMENO ZA POMLČKOU
 * ----------------------------------------------------------
 * ⛔ NAMĚŘENO 2026-09-12 (kopie stromu 239361626, registr ze souboru):
 * `(<jméno>)-[a-z]` bylo VZOREK. Holé `<jméno>-` následované `/`, `` ` ``,
 * `"`, `|` prošlo zeleně — sondy `/<fork>-/`, `` `<fork>-` ``, `"<fork>-"`,
 * `|<fork>-|` v README nehlášeny — a `m<fork>-x` naopak hlášeno bylo, ačkoli
 * jméno tam je jen uvnitř cizího slova. Vlastnost, o kterou jde, je „token
 * `<jméno>-` ZAČÍNÁ tady": hostname `<jméno>-auth`, kontejner
 * `<jméno>-keycloak`, próza `` `<jméno>-` ``. Co za pomlčkou následuje, je
 * jedno; rozhoduje, že před jménem NENÍ písmeno ani číslice (velké písmeno
 * je taky písmeno: `M<fork>-x` je slovo, ne jméno — a písmeno s diakritikou
 * taky: `ě<fork>-x` je slovo, proto `\p{L}\p{N}`, ne `a-zA-Z0-9`, které by
 * sedmý případ, českou prózu, četlo jako hranici). Mez: ROZLOŽENÁ diakritika
 * (NFD, `e` + U+0301 — třída `\p{M}`, ne `\p{L}`) by se počítala jako hranice,
 * takže `ériq-x` v NFD by byl nález. Próza repa je NFC; a falešně pozitivní
 * padne nahlas, ne potichu — proto se to tu jen přiznává, ne obchází. Delší jméno obsahující
 * kratší (`<org>-<jméno>` × `<jméno>`) dá na jednom řádku jeden nález —
 * měří se řádek, ne počet shod.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Git s `cwd: root` BEZ git lokace volajícího: pod hookem by zděděný GIT_DIR
// změřil repo, ze kterého hook běží, ne `root` (kopii stromu). Brána git-v-testech-bez-prostredi.
import { envWithoutGitLocation } from "../../../../scripts/lib/git-worktree-health.mjs";

/** Kořen repa — `src/tests/gates/lib` → 4 úrovně výš. */
export const ROOT = join(__dirname, "../../../..");

/** Jméno PLATFORMY (výchozí stack). Není to fork — v registru se nepočítá, ale jako literál se v adresách měří vždy. */
export const JMENO_PLATFORMY = "aisha";

/**
 * Jména instancí z LOKÁLNÍCH kanálů: `instances/`, cíle remotů a deklarovaná
 * identita stromu — ne vyjmenováno: nová instance se pod bránu dostane sama.
 *
 * `aisha` je jméno UPSTREAMU (výchozí stack), ne fork — to se nepočítá.
 */
export async function jmenaInstanci(root: string = ROOT): Promise<string[]> {
  const soubory = execFileSync("git", ["ls-files", "instances/"], { cwd: root, encoding: "utf-8", env: envWithoutGitLocation() })
    .split("\n")
    .filter(Boolean);
  const jmena = new Set<string>();
  for (const cesta of soubory) {
    const m = cesta.match(/^instances\/([a-z][a-z0-9-]*)\//);
    if (m && m[1] !== "_default" && !m[1].startsWith("_")) jmena.add(m[1]);
  }
  // Fork, ve kterém tenhle strom leží, se pozná z remote — `instances/` nese jen
  // `_default` (data instance odešla do vlastního repa, #163), takže sama o sobě
  // identitu nedá.
  //
  // ⛔ NAMĚŘENO 2026-08-18 v CI: první verze se ptala JEDNOHO remote jménem `<fork>`.
  // Na vývojářském stroji existuje, v CI ne — `actions/checkout` zakládá `origin`.
  // Brána tam tedy neměla co měřit a tvrdě spadla, ačkoli strom byl čistý. Ptát se
  // konkrétního JMÉNA remote je táž třída jako ptát se konkrétního jména klíče:
  // rozhoduje, kam ten remote MÍŘÍ, ne jak se mu doma říká.
  let remotes: string[] = [];
  try {
    remotes = execFileSync("git", ["remote"], { cwd: root, encoding: "utf-8", env: envWithoutGitLocation() }).split("\n").filter(Boolean);
  } catch {
    // ne-git strom (tarball, vendored kopie) — pak se měří jen podle instances/
  }
  for (const r of remotes) {
    let url = "";
    try {
      url = execFileSync("git", ["remote", "get-url", r], { cwd: root, encoding: "utf-8", env: envWithoutGitLocation() });
    } catch {
      continue;
    }
    const m = url.match(/\/([a-z][a-z0-9-]*)-orchestrator(?:\.git)?\s*$/);
    // `evymo-ai` je UPSTREAM, ne fork — jeho jméno není instanční identita.
    // Totéž jméno PLATFORMY: veřejné zrcadlo upstreamu je `<platforma>-orchestrator`
    // (github.com/evymo/aisha-orchestrator) a bez téhle výjimky vyrobilo z `aisha`
    // „instanci" — 7 399 nálezů ve vlastním kódu platformy. Kanály identity
    // a registru forků (níž) platformu vylučují už teď; remote byl jediný bez.
    if (m && m[1] !== "evymo-ai" && m[1] !== JMENO_PLATFORMY) jmena.add(m[1]);
  }
  // ⛔ NAMĚŘENO 2026-09-12: fork pojmenovaný `<org>-<fork>` (ne `<fork>-orchestrator`)
  // nese identitu `<prefix>` (APP_NAME_PREFIX) a `<story>` (AISHA_STORY), která
  // se z jeho remote NEPOZNÁ: jméno repa není jméno instance. Remote je jen
  // JEDEN z kanálů, kudy identita do stromu vstupuje; ten závazný je deklarace,
  // kterou čte i nasazení. Proto se brána ptá téhož resolveru, kterým se ptá
  // cold-start a doktor (coolify-instance-scope.mjs): prostředí → .env.local →
  // .env-prod-backup → .env.coolify. Rozporná deklarace tam padá — a padne i
  // tady, což je správně: brána nemá hádat, kdo strom je, když to neví ani
  // nasazení. `required: false` — čistý upstream (bez deklarace) nemá co říct
  // a nepadá.
  const { resolveInstanceIdentity } = await import(
    /* @vite-ignore */ join(root, "scripts/lib/coolify-instance-scope.mjs")
  );
  const identita = resolveInstanceIdentity({ root, required: false }) as { prefix: string; story: string };
  for (const jmeno of [identita.prefix, identita.story]) {
    if (/^[a-z][a-z0-9-]*$/.test(jmeno) && jmeno !== JMENO_PLATFORMY) jmena.add(jmeno);
  }
  return [...jmena];
}

/**
 * Registr forků — organizace na Forgejo, kam míří `origin`.
 *
 * ⛔ NAMĚŘENO 2026-09-12 (upstream, HEAD 1af002269): všechny tři kanály výš
 * jsou LOKÁLNÍ. V CI upstreamu (checkout zakládá jen `origin` → upstream, bez
 * `instances/`, bez `.env*`) je množina jmen PRÁZDNÁ a brána se přeskočí —
 * takže identitu žádného forku tam nikdy nezměří a je zelená-protože-neviditelná.
 * Přitom repo NEMÁ registr forků (config/, docs/, coolify/manifests: 0 nálezů);
 * jediné místo, které o forcích ví, je organizace na Forgejo: `GET
 * /api/v1/orgs/<org>/repos` vrací u forku `fork: true` a `parent.full_name`
 * = upstream (změřeno: 5 forků + `<jméno>-instance-data` repa instancí),
 * ⛔ ale organizace je PRIVÁTNÍ: anonymní dotaz vrací HTTP 200 a PRÁZDNÉ pole
 * (naměřeno: 0 rep bez tokenu, 49 s tokenem). Kód odpovědi tedy NENÍ měření;
 * prázdný registr je vada měřidla a hlásí se, ne „čistý stav".
 *
 * ODKUD SE REGISTR BERE (v tomhle pořadí, první, který odpoví):
 *   0. `AISHA_FORK_REGISTRY_NEZMERENO` — krok CI, který registr stahuje, sám
 *      řekl, PROČ nic nestáhl (secret chybí, API vrátilo jiný kód než 200,
 *      síť). Důvod se přebírá doslova; bez něj by se tady hádalo.
 *   1. soubor `AISHA_FORK_REGISTRY` — v CI ho stáhne SAMOSTATNÝ krok
 *      (.forgejo/workflows/ci.yml, „Registr forků"), který má token a spouští
 *      jen curl. Token se do procesu testů NEDÁVÁ: tenhle job běží kód z PR
 *      a plný token organizace by z něj šel vynést.
 *   2. token v prostředí (`REPO_API_TOKEN` / `FORGEJO_API_TOKEN`), nebo
 *      `git credential fill` NEINTERAKTIVNĚ (lokálně: keychain) — jen GET.
 *   3. nic z toho → NEZMĚŘENO s důvodem.
 *
 * TVAR, NE VZOREK: jméno instance se odvozuje z tvaru repa —
 *   · fork upstreamu (`fork:true`, `parent` = origin repo): `<jméno>-orchestrator`
 *     → `<jméno>`; `<org>-<jméno>` → `<jméno>` i `<org>-<jméno>`;
 *   · `<jméno>-instance-data` → `<jméno>` (data instance nesou její jméno).
 *
 * ⛔ IDENTITA FORKU JE DEKLARACE, NE TVAR REPA (naměřeno 2026-09-12): fork
 * `<org>-<jméno>` nasazuje pod prefixem, který se z jména repa nepozná —
 * sonda `<prefix>-x` bránou prošla, ačkoli prefix je v produkci. Deklarace
 * leží v instance-data repu forku: `profiles/*.json` → `domain.subdomain_prefix`,
 * a bez prefixu `domain.public_tld` (tam obojí čte derive-domains). Registr
 * proto u každého `*-instance-data` nese i `jmena_z_profilu` (krok CI je
 * stáhne přes `contents/profiles` a odvodí jq filtrem; lokální kanál 2 dělá
 * totéž funkcí `jmenoZProfilu` — a negativní sonda v bráně oba domovy pravidla
 * srovnává nad touž fixturou, protože krok CI repo kód spouštět NESMÍ: běží
 * s tokenem) a brána měří i tato jména — bez koncového oddělovače, protože
 * hostname ho nese jako `<prefix>-auth`, tedy týmž tvarem `<jméno>-`.
 * Repo bez `profiles/` nebo profil bez prefixu i zóny nepřidá nic — nic, ne
 * pád; chyba API je NEZMĚŘENO, protože částečný registr by byl tichý přeskok.
 * Co tudy pořád NEJDE změřit: prefix/story deklarované JEN v necommitovaném
 * `.env.local` forku. To zůstává na kanálu identity stromu — a říká se to
 * tady, ne že by se to zamlčelo.
 *
 * NEZMĚŘENO se hlásí, nezamlčuje: `AISHA_SKIP_ONLINE=1` (lokální běhy bez
 * sítě) kanál vědomě vynechá a test to ohlásí jako přeskočený s důvodem;
 * chyba sítě/API při ZAPNUTÉM měření je pád — HTTP 000 není „žádné forky".
 */
export type Repo = {
  name: string;
  fork?: boolean;
  parent?: { full_name?: string } | null;
  /** Jména z `profiles/*.json` instance-data repa (`jmenoZProfilu`) — doplňuje registr, ne API. */
  jmena_z_profilu?: unknown[];
};

/**
 * Prefix z profilu → jméno, jak ho nese hostname. derive-domains prefix
 * normalizuje NA oddělovač (`tenant` → `tenant-`, `<fork>-` zůstane); tady se
 * oddělovač naopak sundá, protože brána hledá tvar `<jméno>-` sama.
 */
export function jmenoZPrefixu(prefix: unknown): string {
  return typeof prefix === "string" ? prefix.trim().toLowerCase().replace(/[-.]+$/, "") : "";
}

/**
 * Jméno instance z JEDNOHO profilu instance-data — týmž pravidlem, jakým
 * derive-domains skládá hostname (prefixProZonu): má-li profil
 * `domain.subdomain_prefix`, fork sdílí veřejnou zónu s někým a identitu nese
 * PREFIX (`<prefix>-auth.<sdílená zóna>`); bez prefixu je veřejnou zónou vlastní
 * doména instance a identitu nese její první label (`auth.<jméno>.<tld>`).
 * Label sdílené zóny u forku S prefixem jménem NENÍ (naměřeno 2026-09-12:
 * byl by to `staging` — prostředí, ne instance).
 *
 * ⚠️ DRUHÝ DOMOV TÉHOŽ PRAVIDLA je jq filtr `JQ_JMENO_Z_PROFILU` v kroku CI
 * „Registr forků" (.forgejo/workflows/ci.yml) — krok běží s tokenem a repo kód
 * spouštět nesmí. Sonda v bráně oba domovy srovnává nad touž fixturou.
 */
export function jmenoZProfilu(profil: unknown): string {
  const domain = (profil as { domain?: { subdomain_prefix?: unknown; public_tld?: unknown } } | null)?.domain;
  const prefix = jmenoZPrefixu(domain?.subdomain_prefix);
  if (prefix) return prefix;
  const tld = typeof domain?.public_tld === "string" ? domain.public_tld.trim().toLowerCase() : "";
  return tld.split(".")[0] ?? "";
}

/** Jména instancí z tvaru repozitářů organizace a z jejich deklarací — čistá funkce, měřitelná fixturou. */
export function jmenaZRepozitaru(repa: Repo[], org: string, upstreamRepo: string): string[] {
  const jmena = new Set<string>();
  const pridej = (jmeno: string) => {
    if (/^[a-z][a-z0-9-]*$/.test(jmeno) && jmeno !== org && jmeno !== JMENO_PLATFORMY && jmeno !== "evymo-ai") jmena.add(jmeno);
  };
  for (const r of repa) {
    const jeFork = r.fork === true && r.parent?.full_name === `${org}/${upstreamRepo}`;
    const jeData = /-instance-data$/.test(r.name);
    if (!jeFork && !jeData) continue;
    const zaklad = r.name.replace(/-instance-data$/, "").replace(/-orchestrator$/, "");
    pridej(zaklad);
    if (zaklad.startsWith(`${org}-`)) pridej(zaklad.slice(org.length + 1));
    // Deklarovaná identita: jména z profilů instance-data (jméno repa ≠ jméno instance).
    if (jeData) for (const jmeno of r.jmena_z_profilu ?? []) pridej(jmenoZPrefixu(jmeno));
  }
  return [...jmena].sort();
}

function tokenProOrigin(server: string, root: string): string {
  const zEnv = process.env.REPO_API_TOKEN || process.env.FORGEJO_API_TOKEN || "";
  if (zEnv) return zEnv;
  try {
    const out = execFileSync("git", ["-c", "credential.interactive=never", "credential", "fill"], {
      cwd: root,
      encoding: "utf-8",
      input: `url=${server}\n\n`,
      env: envWithoutGitLocation({ ...process.env, GIT_TERMINAL_PROMPT: "0" }),
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 10_000,
    });
    return out.match(/^password=(.*)$/m)?.[1] ?? "";
  } catch {
    return ""; // žádný helper / žádné pověření — to je stav, ne chyba měřidla
  }
}

/** GET přes API Forgejo. `null` = HTTP 404 (věc neexistuje — stav, ne chyba měřidla); jiný ne-2xx je pád. */
async function apiJson(url: string, token: string): Promise<unknown | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `token ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`NEZMĚŘENO: registr forků (${url}) neodpověděl: ${(e as Error).message} — mlčení sítě není „žádné forky"`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`NEZMĚŘENO: registr forků ${url} → HTTP ${res.status}`);
  return res.json();
}

/** Jména deklarovaná v `profiles/*.json` instance-data repa — totéž, co dělá krok CI. */
async function jmenaZInstanceData(server: string, org: string, repo: string, token: string): Promise<string[]> {
  const seznam = await apiJson(`${server}/api/v1/repos/${org}/${repo}/contents/profiles`, token);
  if (seznam === null) return []; // repo bez profiles/ — nic, ne pád
  if (!Array.isArray(seznam)) throw new Error(`NEZMĚŘENO: ${repo}/contents/profiles nevrátil seznam souborů`);
  const out: string[] = [];
  for (const polozka of seznam as { name?: string; type?: string }[]) {
    if (polozka.type !== "file" || !/\.json$/.test(polozka.name ?? "")) continue;
    const profil = await apiJson(`${server}/api/v1/repos/${org}/${repo}/raw/profiles/${polozka.name}`, token);
    if (profil === null) throw new Error(`NEZMĚŘENO: ${repo}/profiles/${polozka.name} byl v seznamu, ale raw vrátil 404`);
    const jmeno = jmenoZProfilu(profil);
    if (jmeno) out.push(jmeno);
  }
  return out;
}

export type Registr = { jmena: string[]; nezmereno: string | null };

export async function jmenaZRegistruForku(root: string = ROOT): Promise<Registr> {
  // 0. krok CI, který registr stahuje, sám řekl, proč nic nestáhl — důvod se přebírá.
  const duvodZCi = (process.env.AISHA_FORK_REGISTRY_NEZMERENO ?? "").trim();
  if (duvodZCi) return { jmena: [], nezmereno: `krok CI „Registr forků": ${duvodZCi}` };
  let origin = "";
  try {
    origin = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf-8", env: envWithoutGitLocation() }).trim();
  } catch {
    return { jmena: [], nezmereno: "remote `origin` není — strom bez gitu nebo bez původu" };
  }
  const m = origin.match(/^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return { jmena: [], nezmereno: `origin není HTTP(S) URL tvaru <server>/<org>/<repo>: ${origin}` };
  const [, server, org, upstreamRepo] = m;

  let repa: Repo[] = [];
  const soubor = process.env.AISHA_FORK_REGISTRY;
  if (soubor) {
    // 1. registr stažený samostatným krokem CI — bez tokenu v tomhle procesu
    const obsah = JSON.parse(readFileSync(soubor, "utf8"));
    if (!Array.isArray(obsah)) throw new Error(`NEZMĚŘENO: ${soubor} (AISHA_FORK_REGISTRY) není pole repozitářů`);
    repa = obsah as Repo[];
  } else {
    if (process.env.AISHA_SKIP_ONLINE === "1") return { jmena: [], nezmereno: "AISHA_SKIP_ONLINE=1 — registr forků je online kanál" };
    // 2. token z prostředí nebo z git credential helperu
    const token = tokenProOrigin(server, root);
    if (!token) return { jmena: [], nezmereno: `organizace ${org} na ${server} je privátní a token není (REPO_API_TOKEN / git credential)` };
    for (let page = 1; page <= 20; page++) {
      const url = `${server}/api/v1/orgs/${org}/repos?limit=50&page=${page}`;
      const davka = await apiJson(url, token);
      if (!Array.isArray(davka)) throw new Error(`NEZMĚŘENO: ${url} nevrátil pole repozitářů`);
      repa.push(...(davka as Repo[]));
      if (davka.length < 50) break;
    }
    // Deklarovaná identita forků: totéž, co stahuje krok CI do `jmena_z_profilu`.
    for (const r of repa) {
      if (/-instance-data$/.test(r.name)) r.jmena_z_profilu = await jmenaZInstanceData(server, org, r.name, token);
    }
  }
  return { jmena: jmenaZRepozitaru(repa, org, upstreamRepo), nezmereno: null };
}

/**
 * Sjednocená odpověď pro každou bránu, která se ptá „která jména instancí
 * znám?": lokální kanály + registr. `registr.nezmereno` nese důvod, proč
 * online kanál nic nedal — brána ho má VYSLOVIT (skip s důvodem), ne zamlčet.
 */
export type ZnamaJmena = { jmena: string[]; lokalni: string[]; registr: Registr };

export async function znamaJmenaInstanci(root: string = ROOT): Promise<ZnamaJmena> {
  const [lokalni, registr] = await Promise.all([jmenaInstanci(root), jmenaZRegistruForku(root)]);
  return { jmena: [...new Set([...lokalni, ...registr.jmena])].sort(), lokalni, registr };
}

/**
 * Důvod, proč brána nemůže měřit jména instancí — text do názvu přeskočeného
 * testu. `null` = jména jsou, měří se.
 */
export function duvodNezmereno(z: ZnamaJmena): string | null {
  if (z.jmena.length > 0) return null;
  return z.registr.nezmereno ?? "registr forků odpověděl bez jediného jména a lokální kanály (instances/, remoty, identita stromu) mlčí";
}

/**
 * Vzor „tady začíná token `<jméno>-`": hranice PŘED jménem, ne písmeno za
 * pomlčkou (viz hlavičku). `null` pro prázdnou množinu — bez jmen není co
 * měřit, a volající to má říct, ne měřit prázdno.
 *
 * ⛔ BEZ `\b`: `git grep -E` ji nezná a tiše nenajde nic — na tom se napálilo
 * první měření (2026-08-18). Tady je to JS RegExp, ale hranice je vypsaná
 * výslovně i proto, aby byla čitelná: `\b` by navíc brala `_` jako slovo a
 * `Mriq` by rozdělila jinak, než chceme.
 */
export function vzorJmen(jmena: string[]): RegExp | null {
  if (jmena.length === 0) return null;
  const alternativy = jmena.map((j) => j.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Hranice = začátek řádku nebo cokoli, co není písmeno ani číslice — v Unicode,
  // protože próza tohoto repa je česká a `ě<jméno>-` je slovo, ne jméno.
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${alternativy})-`, "u");
}

/** Literál PLATFORMY v adrese (`aisha-<služba>`) — třída squattingu #163: měří se vždy, i bez znalosti instancí. */
export const VZOR_PLATFORMY = vzorJmen([JMENO_PLATFORMY]) as RegExp;

/** Řádky, které jmenují instanci tvarem `<jméno>-` — čistá funkce, měřitelná fixturou. Prázdná množina jmen → nic. */
export function najdiJmena(obsah: string, jmena: string[]): { radek: number; text: string }[] {
  const vzor = vzorJmen(jmena);
  if (!vzor) return [];
  const out: { radek: number; text: string }[] = [];
  obsah.split("\n").forEach((text, i) => {
    if (vzor.test(text)) out.push({ radek: i + 1, text });
  });
  return out;
}
