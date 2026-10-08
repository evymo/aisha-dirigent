/**
 * Brána: IZOLACE PROSTŘEDÍ cold-startu — měří vlastnost CELÉHO běhu, ne text.
 *
 * NAMĚŘENO 2026-09-24 ve forku, staging na sdíleném Coolify:
 *
 *   AISHA_ENV=staging bash scripts/aisha-cold-start-env.sh --dry-run --wipe
 *
 * běžel NAOSTRO a mířil na PRODUKČNÍ projekt:
 *   RC1  záloha stažená z Coolify nesla DRY_RUN=0 a `load_env_file_keys … overwrite`
 *        jím přepsal příznak z příkazové řádky;
 *   RC2  discovery (generate-coolify-context.mjs) hledá projekt podle JMÉNA, fork má
 *        staging i produkci pod jedním jménem instance, a `eval` jejího výstupu
 *        připnuté stagingové UUID přepsal produkčním.
 * Zastavila to až pojistka zástupných hodnot těsně před wipem — náhodou.
 *
 * CO SE MĚŘÍ: skutečný obal + cold-start v dočasné kopii repa proti FALEŠNÉMU Coolify
 * (postroj _falesny-coolify.ts), a každý požadavek, který by v Coolify něco změnil
 * (POST/PUT/PATCH/DELETE + GET /deploy|start|stop|restart). Okno měření: od startu
 * po krok 2c (wipe) — běh se zastaví na značce kroku 2d; dál už se jen zakládá.
 *
 *   (a)  dry-run --wipe, záloha nese DRY_RUN=0 a WIPE=1        → 0 mutujících
 *   (b)  ostrý ne-produkční --wipe, jméno ukazuje na produkci  → 0 mimo vlastní projekt
 *   (b+) KONTROLA MĚŘIDLA: ostrý --wipe se správným jménem     → smaže PRÁVĚ své 2 aplikace
 *   (c)  dry-run --wipe, jméno projektu v Coolify není         → 0 mutujících (nic se nezakládá)
 *   PR2 (slot `<story>-staging`, identita jen v záloze — tvar forku):
 *   (d)  ostrý --wipe slotu → produkční `.env.coolify` bajtově beze změny, vlastní
 *        `.env.<slot>` bez produkčních tajemství i bez hodnot z `.env-prod-backup`,
 *        discovery nečte produkční deklarace serverů (COOLIFY_PROD_SERVER_NAME_*)
 *   (e)  ostrý --wipe, jméno ukazuje na PRODUKCI → pin vyhraje: běh dojde k wipu a smaže
 *        PRÁVĚ své 2 aplikace (dřív se zastavil na izolaci — bezpečné, ale staging nešel)
 *   (f)  JEDINÝ scénář s oknem až do kroku 3: v kořeni stromu leží záloha JINÉHO prostředí
 *        s jiným projektem a jinou adresou Forgeja → story-init zakládá ve SVÉM projektu
 *        a z repozitáře SVÉHO prostředí. Běh se zastaví po založení první aplikace.
 *        NAMĚŘENO 2026-10-04: story-init si prostředí skládá sám (lib/resolve-domains-env.sh)
 *        a četl napevno `.env-prod-backup` z kořene — zděděný projekt i adresu Forgeja tím
 *        přepsal produkčními. Scénáře (a)–(e) to vidět nemohly: končí na kroku 2d, tedy PŘED
 *        story-initem, a záloha v kořeni u nich projekt ani adresu nenese.
 *   (g)  záloha PROSTŘEDÍ nese GIT_BRANCH jinou než větev manifestu → běh se zastaví
 *        v kroku 2b2, PŘED wipem: 0 mutujících. Recenze 2026-10-04: rozpor znal jen
 *        story-init (krok 3), takže běh smazal aplikace a pak nic nezaložil.
 *
 * ČERVENÁ CESTA (ověřeno na d0609e93, před opravou): (a) smaže stagingové aplikace
 * i v dry-runu, (b) smaže PRODUKČNÍ aplikace, (c) založí projekt (POST /projects).
 * (b+) projde i tam — dokazuje, že postroj mutace vidí a zelená (a)–(c) není prázdná.
 * PR2 na 965a84372 (před opravou): (d) přepíše produkční `.env.coolify` a discovery
 * spadne na produkční deklaraci serveru; (e) se zastaví na izolaci po discovery.
 *
 * Spouští se přes: npm run test:gates -- cold-start-izolace-prostredi
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import {
  cilovyProjekt,
  falesnyCoolify,
  jeMutujici,
  pripravPostroj,
  scenarSdilenaJmena,
  spustObal,
  vycistiPriklady,
  zalozGitOrigin,
  zapisDomenyStagingu,
  type Scenar,
  FORGEJO_DOMENA_POSTROJE,
} from "./_falesny-coolify";
import { zManifestu } from "../../../scripts/lib/nasazovany-repozitar.mjs";

const ROOT = process.cwd();
const BEH_MS = 480_000;

const envSoubor = (kv: Record<string, string>) =>
  Object.entries(kv)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";

/**
 * Záloha stagingu jako ve forku 24. 9.: COOLIFY_PROJECT_UUID v ní NENÍ (změřeno
 * 25. 9.: 0 výskytů) — pin projektu přichází jen z konfigurace prostředí.
 */
const ZALOHA = {
  AISHA_PROFILE: "cloud-multi",
  APP_NAME_PREFIX: "inst",
  NOCODB_ADMIN_EMAIL: "admin@postroj.invalid",
  SMTP_ADMIN_EMAIL: "admin@postroj.invalid",
  FORGEJO_API_TOKEN: "postroj-falesny-forgejo",
  FORGEJO_TOKEN: "postroj-falesny-forgejo",
};

/** Produkční hodnota, která se do stagingu NESMÍ dostat (env-doctor ji bere jako externí klíč). */
const JEN_PRODUKCE = "prod-jen-produkce-postroj";

async function beh(opts: {
  args: string[];
  zaloha?: Record<string, string>;
  scenar?: Scenar;
  /** Prostředí běhu; `inst-staging` = slot forku (identita jen v záloze, v configu nic). */
  slot?: "staging" | "inst-staging";
  env?: Record<string, string>;
  /** Co navíc nese záloha JINÉHO prostředí v kořeni stromu (`.env-prod-backup`). */
  zalohaVKoreni?: Record<string, string>;
  /** Kde běh zastavit; výchozí je značka kroku 2d (okno měření do wipu). */
  zastavNa?: RegExp;
}) {
  const sc = opts.scenar ?? scenarSdilenaJmena();
  const slot = opts.slot ?? "staging";
  const coolify = await falesnyCoolify(sc);
  try {
    const p = pripravPostroj(ROOT);
    vycistiPriklady(p.repo, coolify.url);
    zapisDomenyStagingu(p.repo);
    if (slot !== "staging") cpSync(join(p.repo, "config", "domains-staging.env"), join(p.repo, "config", `domains-${slot}.env`));
    // Checkout operátora ukazuje na repozitář, ze kterého Coolify staví (krok 2b2 ho
    // hledá podle adresy, ne podle jména remote).
    const { repo: repoManifestu } = zManifestu(readFileSync(join(p.repo, "coolify", "manifests", "aisha.manifest"), "utf8"));
    zalozGitOrigin(p.repo, `https://${FORGEJO_DOMENA_POSTROJE}/${repoManifestu}.git`);
    writeFileSync(join(p.repo, `.env-${slot}-backup`), envSoubor({ COOLIFY_URL: coolify.url, ...ZALOHA, ...opts.zaloha }), {
      mode: 0o600,
    });
    // Produkční záloha na stanovišti obsluhy (sdílený pracovní strom): externí klíč,
    // který ve stagingu nemá co dělat.
    writeFileSync(
      join(p.repo, ".env-prod-backup"),
      envSoubor({ COHERE_API_KEY: JEN_PRODUKCE, APP_NAME_PREFIX: "inst", ...opts.zalohaVKoreni }),
      { mode: 0o600 },
    );
    // Produkční instance má na disku svůj .env.coolify (ve forku 24. 9. ano). Falešné hodnoty.
    writeFileSync(
      join(p.repo, ".env.coolify"),
      envSoubor({
        COOLIFY_URL: coolify.url,
        COOLIFY_PROJECT_UUID: "proj-prod",
        ANON_KEY: "postroj.anon.jwt",
        SERVICE_ROLE_KEY: "postroj.service.jwt",
        JWT_SECRET: "postroj-jwt-secret-postroj-jwt-secret-postroj",
        // Kontrola po env-doctoru čte napevno .env.coolify i ve stagingu (vada pro PR2);
        // skutečná produkce ten klíč nese, falešná musí taky.
        MESH_DNS_NETWORK: "inst-mesh-dns",
      }),
      { mode: 0o600 },
    );
    const prodEnvPred = readFileSync(join(p.repo, ".env.coolify"), "utf8");
    const px = slot === "staging" ? "COOLIFY_STAGING_" : "COOLIFY_INST_STAGING_";
    const r = await spustObal({
      ...p,
      env: {
        AISHA_ENV: slot,
        COOLIFY_API_TOKEN: "postroj-token",
        [`${px}URL`]: coolify.url,
        [`${px}PROJECT_UUID`]: "proj-stg",
        [`${px}ENVIRONMENT`]: "production",
        [`${px}PROFILE`]: "cloud-multi",
        // Holý staging má soubor domén v configu; slot ho deklaruje obsluha (jako ve forku).
        ...(slot === "staging" ? {} : { [`${px}DOMAINS_FILE`]: `config/domains-${slot}.env` }),
        // Operátor má vlastní zálohu trezoru — tahle brána neměří zálohování.
        AISHA_WIPE_SKIP_VAULT_BACKUP: "1",
        ...opts.env,
      },
      args: opts.args,
      timeoutMs: BEH_MS,
      zastavNa: opts.zastavNa ?? /={5,} 2d\./,
    });
    const mutujici = coolify.pozadavky.filter(jeMutujici).map((q) => ({ ...q, projekt: cilovyProjekt(q, sc) }));
    const diagnoza = () =>
      `mutující: ${JSON.stringify(mutujici.map((m) => `${m.method} ${m.path} → ${m.projekt}`))}\n` +
      `konec výstupu:\n${stripVTControlCharacters(r.vystup).split("\n").slice(Number(process.env.POSTROJ_TAIL ?? -25)).join("\n")}`;
    expect(r.vyprselo, `běh překročil ${BEH_MS} ms\n${diagnoza()}`).toBe(false);
    const cti = (f: string) => (existsSync(join(p.repo, f)) ? readFileSync(join(p.repo, f), "utf8") : null);
    return { r, mutujici, diagnoza, prodEnvPred, prodEnvPo: cti(".env.coolify"), slotEnv: cti(`.env.${slot}`) };
  } finally {
    await coolify.zavri();
  }
}

describe("cold-start: izolace prostředí (skutečný běh proti falešnému Coolify)", () => {
  test("(a) dry-run se zálohou nesoucí DRY_RUN=0 a WIPE=1 nic nezmění", async () => {
    const { r, mutujici, diagnoza } = await beh({
      args: ["--dry-run", "--wipe"],
      zaloha: { COOLIFY_PROJECT_NAME: "inst-staging", DRY_RUN: "0", WIPE: "1" },
    });
    expect(mutujici, diagnoza()).toEqual([]);
    // Neprázdnost: běh opravdu došel k rozhodnutí o wipu a zvolil náhled.
    expect(r.vystup, diagnoza()).toMatch(/\[DRY RUN\] Would DELETE 2 app/);
  });

  test("(b) ostrý ne-produkční wipe nesáhne mimo svůj projekt, ani když jméno ukazuje na produkci", async () => {
    const { mutujici, diagnoza } = await beh({ args: ["--wipe", "--skip-doctor"] });
    expect(mutujici.filter((m) => m.projekt === "proj-prod"), diagnoza()).toEqual([]);
    expect(mutujici.filter((m) => m.projekt !== "proj-stg"), diagnoza()).toEqual([]);
  });

  test("(b+) kontrola měřidla: se správným jménem smaže PRÁVĚ své dvě aplikace", async () => {
    const { mutujici, diagnoza } = await beh({
      args: ["--wipe", "--skip-doctor"],
      zaloha: { COOLIFY_PROJECT_NAME: "inst-staging" },
    });
    expect(mutujici.filter((m) => m.projekt !== "proj-stg"), diagnoza()).toEqual([]);
    const smazane = mutujici
      .filter((m) => m.method === "DELETE")
      .map((m) => m.path.split("?")[0])
      .sort();
    expect(smazane, diagnoza()).toEqual(["/api/v1/applications/app-stg-core", "/api/v1/applications/app-stg-netinit"]);
  });

  test("(d) slot <story>-staging: produkční soubory nedotčené, discovery nečte produkční deklarace", async () => {
    const { r, mutujici, diagnoza, prodEnvPred, prodEnvPo, slotEnv } = await beh({
      slot: "inst-staging",
      args: ["--wipe", "--skip-doctor"],
      zaloha: { COOLIFY_PROJECT_NAME: "inst-staging" },
      // Produkční deklarace stroje, který v (falešném) Coolify není: staging ji číst NESMÍ.
      // AISHA_STORY: slot `inst-staging` by si jinak odvodil příběh `inst` (manifest v repu není).
      env: { COOLIFY_PROD_SERVER_NAME_FRONTEND: "produkcni-stroj", AISHA_STORY: "aisha" },
    });
    // Neprázdnost NAPŘED: běh musí dojít přes generování až k wipu, jinak by kontroly
    // souborů níž prošly naprázdno (kontrola měřidla 2026-09-27: spadlý start = „nedotčeno").
    expect(r.zastaveno, `běh nedošel k wipu\n${diagnoza()}`).toBe(true);
    expect(r.vystup, diagnoza()).not.toMatch(/COOLIFY_PROD_SERVER_NAME_FRONTEND/);
    expect(prodEnvPo, "stagingový běh přepsal PRODUKČNÍ .env.coolify").toBe(prodEnvPred);
    expect(slotEnv, `slot nemá vlastní .env.inst-staging\n${diagnoza()}`).not.toBeNull();
    expect(slotEnv, "do stagingu tekla hodnota z .env-prod-backup (env-doctor heal)").not.toContain(JEN_PRODUKCE);
    expect(slotEnv, "staging převzal produkční tajemství z .env.coolify (preserve_or_gen)").not.toContain(
      "postroj-jwt-secret-postroj-jwt-secret-postroj",
    );
    expect(mutujici.filter((m) => m.projekt !== "proj-stg"), diagnoza()).toEqual([]);
  });

  test("(e) jméno ukazuje na produkci → pin vyhraje a běh smaže PRÁVĚ své dvě aplikace", async () => {
    const { r, mutujici, diagnoza } = await beh({ args: ["--wipe", "--skip-doctor"] });
    expect(r.zastaveno, `běh nedošel k wipu — pin nevyhrál\n${diagnoza()}`).toBe(true);
    expect(r.vystup, diagnoza()).toMatch(/platí připnutý/);
    expect(mutujici.filter((m) => m.projekt !== "proj-stg"), diagnoza()).toEqual([]);
    const smazane = mutujici
      .filter((m) => m.method === "DELETE")
      .map((m) => m.path.split("?")[0])
      .sort();
    expect(smazane, diagnoza()).toEqual(["/api/v1/applications/app-stg-core", "/api/v1/applications/app-stg-netinit"]);
  });

  test("(f) záloha jiného prostředí v kořeni nezmění projekt ani repozitář, se kterými story-init pracuje", async () => {
    const CIZI_FORGEJO = "repo.jine-prostredi.invalid";
    const { r, mutujici, diagnoza } = await beh({
      args: ["--wipe", "--skip-doctor"],
      zaloha: { COOLIFY_PROJECT_NAME: "inst-staging" },
      // Záloha v kořeni patří JINÉMU prostředí (na sdíleném stanovišti produkci).
      zalohaVKoreni: { COOLIFY_PROJECT_UUID: "proj-prod", FORGEJO_URL: `https://${CIZI_FORGEJO}` },
      // Okno až do kroku 3: po založení první aplikace (nebo na konci story-initu) stop.
      zastavNa: /Created: inst-[\w-]+ → |━━━ Summary ━━━/,
    });
    const zalozeni = mutujici.filter((m) => m.method === "POST" && m.path.split("?")[0] === "/api/v1/applications/public");
    // Neprázdnost NAPŘED: běh musí dojít až k založení aplikace story-initem, jinak se neměří nic.
    expect(zalozeni.length, `story-init nezaložil žádnou aplikaci — okno měření nedošlo ke kroku 3\n${diagnoza()}`).toBeGreaterThan(0);
    expect(r.vystup, diagnoza()).toMatch(/Created: inst-[\w-]+ → /);
    // Projekt: vše, co běh v Coolify změnil (wipe i založení), je v JEHO projektu.
    expect(mutujici.filter((m) => m.projekt !== "proj-stg"), diagnoza()).toEqual([]);
    // Repozitář: aplikace se zakládá z Forgeja SVÉHO prostředí, ne ze zálohy v kořeni.
    for (const z of zalozeni) {
      const telo = JSON.parse(z.body) as { project_uuid: string; git_repository: string; git_branch: string };
      expect(telo.project_uuid, diagnoza()).toBe("proj-stg");
      expect(telo.git_repository, diagnoza()).toContain(`${FORGEJO_DOMENA_POSTROJE}/`);
      expect(telo.git_repository, diagnoza()).not.toContain(CIZI_FORGEJO);
      expect(telo.git_branch, diagnoza()).toBe("main");
    }
  });

  test("(g) GIT_BRANCH v záloze prostředí jiná než větev manifestu zastaví běh PŘED wipem", async () => {
    const { r, mutujici, diagnoza } = await beh({
      args: ["--wipe", "--skip-doctor"],
      zaloha: { COOLIFY_PROJECT_NAME: "inst-staging", GIT_BRANCH: "jina-nez-manifest" },
    });
    // Neprázdnost: běh došel ke kroku 2b2 a zastavil se na rozporu — ne dřív na něčem jiném.
    expect(r.vystup, diagnoza()).toMatch(/GIT_BRANCH v prostředí tvrdí větev 'jina-nez-manifest', manifest deklaruje 'main'/);
    expect(r.vystup, diagnoza()).toMatch(/Zastavuji PŘED wipem/);
    expect(r.zastaveno, `běh pokračoval ke kroku 2d — rozpor ho nezastavil\n${diagnoza()}`).toBe(false);
    expect(r.kod, diagnoza()).not.toBe(0);
    // A hlavně: nic se nesmazalo ani nezaložilo.
    expect(mutujici, diagnoza()).toEqual([]);
  });

  test("(c) dry-run nezaloží projekt, když jméno v Coolify není — ohlásí, co hledal", async () => {
    const { r, mutujici, diagnoza } = await beh({
      args: ["--dry-run", "--wipe"],
      zaloha: { COOLIFY_PROJECT_NAME: "neexistujici-projekt" },
    });
    expect(mutujici, diagnoza()).toEqual([]);
    expect(r.vystup, diagnoza()).toMatch(/project 'neexistujici-projekt' not found/);
  });
});

// ⛔ NAMĚŘENO 2026-09-25 (fork, pre-push): postroj volal git se zděděným prostředím a v git
// hooku (GIT_DIR/GIT_INDEX_FILE) tak zapsal do SKUTEČNÉHO repa — 4 commity „postroj",
// přepsaný index, core.bare=true, pokus o `git push origin main`. Tahle brána ten tvar
// hooku napodobí a měří, že oběť zůstane beze změny.
describe("postroj: git nezasáhne cizí repo ani uvnitř git hooku", () => {
  test("s GIT_DIR a GIT_INDEX_FILE z hooku zůstane oběť nedotčená a kopie dostane vlastní repo", () => {
    const g = (cwd: string, ...a: string[]) =>
      execFileSync("git", a, { cwd, env: envWithoutGitLocation(), encoding: "utf8" }).trim();
    const stav = (repo: string) => ({
      head: g(repo, "rev-parse", "HEAD"),
      bare: g(repo, "config", "--get", "core.bare"),
      refs: g(repo, "for-each-ref", "--format=%(refname) %(objectname)"),
      remotes: g(repo, "remote", "-v"),
    });

    const obet = mkdtempSync(join(tmpdir(), "postroj-obet-"));
    writeFileSync(join(obet, "a.txt"), "a\n");
    g(obet, "init", "-q", "-b", "main");
    g(obet, "add", "-A");
    g(obet, "-c", "user.email=o@invalid", "-c", "user.name=o", "commit", "-q", "--no-verify", "-m", "obet");
    const pred = stav(obet);

    const kopie = mkdtempSync(join(tmpdir(), "postroj-kopie-"));
    writeFileSync(join(kopie, "b.txt"), "b\n");
    const puvodni = { dir: process.env.GIT_DIR, index: process.env.GIT_INDEX_FILE };
    process.env.GIT_DIR = join(obet, ".git");
    process.env.GIT_INDEX_FILE = join(obet, ".git", "index");
    try {
      zalozGitOrigin(kopie);
    } finally {
      if (puvodni.dir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = puvodni.dir;
      if (puvodni.index === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = puvodni.index;
    }

    expect(stav(obet)).toEqual(pred);
    expect(g(kopie, "log", "-1", "--format=%s")).toBe("postroj"); // kontrola měřidla: kopie repo dostala
    expect(g(kopie, "ls-remote", `${kopie}-origin.git`, "refs/heads/main")).not.toBe("");
  });
});
