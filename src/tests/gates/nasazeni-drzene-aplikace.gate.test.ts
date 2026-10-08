/**
 * Brána: DEKLAROVANÉ DRŽENÍ aplikací — deklarace s plničem, čtená fail-closed
 *
 * ⛔ NAMĚŘENO 2026-10-02 (upstream dávka #1139, job 345483): vlna 10 web-render
 * bez WEB_RENDER_*_HOST_DIR padla preflightem a další vlny stály. web-render a
 * local-ingest přitom DRŽÍ rozhodnutí majitele (2026-09-28: Coolify převádí holý
 * `${VAR}` bind na prázdný svazek). Nasazení by bylo červené při KAŽDÉM běhu
 * a stálá červená by schovala skutečné chyby.
 *
 * Hlídá se:
 *   1. ČTENÍ (scripts/ci/drzene-z-overlaye.sh, job deploy-zacatek): instance bez
 *      overlaye = nic drženo; overlay deklarovaný a NEČITELNÝ = PÁD (držení chrání
 *      data — „nic drženo“ by bylo fail-open); neplatná deklarace = pád.
 *   2. PLNIČ v řetězu: deklaraci čte deploy-zacatek PŘED razítkem, každá vlnová
 *      úloha ji předá `nasad-podle-vln.sh --drzene`, verdikt ji vypíše. Držet lze
 *      jen vlny, které deklaraci dostanou (validace odmítne vlny 0–2 a přímé úlohy).
 *   3. DEKLARACE INSTANCE (lane overlay-gates): `nasazeni-drzene.json` overlaye
 *      projde validací nad skutečnými vlnami a ci.yml.
 *   4. JEDEN DOMOV MUTACE (od 2026-10-04). ⛔ ZMĚŘENO ČTENÍM, třemi nezávislými
 *      soupisy nad týmž mainem: deklaraci držení četlo jen nasazení z CI. Volání,
 *      které aplikaci v Coolify nasadí, restartuje, spustí nebo zastaví, žilo ve
 *      víc než dvaceti souborech a žádné se neptalo — studený start
 *      (`aisha-cold-start.sh --skip-create`, krok 5 = aisha-redeploy po vlnách)
 *      i ruční dispatch (deploy.yml) by drženou aplikaci přenasadily.
 *      Hlídá se VLASTNOST, ne výčet skriptů: mutaci aplikace smí odeslat jen
 *      `scripts/lib/coolify-mutace.mjs` (před každým voláním se ptá domova držení).
 *      Brána hledá VOLÁNÍ mutace (endpoint /deploy?…, /applications/<uuid>/
 *      restart|start|stop, /deployments/<uuid>/restart, i přes GET a i jako adresu
 *      uloženou do proměnné) v kódu repa mimo domov. Nález mimo domov = pád se
 *      souborem a řádkem; výjimka jen jmenovitě a s důvodem, seznam se smí jen
 *      zmenšovat (výjimka, která na skutečné volání už nesedí, bránu shodí).
 *      Samotest vzoru: v domově volání NAJDE — jinak NEZMĚŘENO, ne zelená.
 *   5. STUDENÝ START: čte deklaraci před prvním zásahem (nečitelná = STOP), žádné
 *      jeho mazání aplikací drženou nezasáhne a nástroje, které volá, drženou
 *      aplikaci nezakládají, nesrovnávají a nezapisují jí prostředí.
 *
 * Chování vlnového skriptu (přeskočení viditelně, další vlny jedou, nedeklarovaná
 * chyba dál padá) měří brána ci-nasazuje-podle-vln. CHOVÁNÍ cest mimo CI (redeploy,
 * sync env, ruční dispatch, studený start proti falešnému Coolify) a rozdílový test
 * „cesta CI × cesta studeného startu čtou týž seznam“ měří brána
 * drzeni-plati-mimo-ci (těžká dráha — spouští skutečné nástroje).
 *
 * Spouští se přes: npm run test:gates (instanční část v lane overlay-gates)
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { nactiDrzeniCestouCI as nacti } from "./_drzeni-ci-cteni";
import { overlayDirOrRequired } from "../../../scripts/lib/instance-overlay.mjs";
import { PRVNI_DRZITELNA_VLNA, primeAplikace, SOUBOR, validuj, vlnyZPoradi } from "../../../scripts/lib/nasazeni-drzene.mjs";

const ROOT = process.cwd();
const CI = ".forgejo/workflows/ci.yml";
const CI_TEXT = readFileSync(join(ROOT, CI), "utf8");
type Krok = { id?: string; name?: string; run?: string; uses?: string; env?: Record<string, string> };
type Uloha = { needs?: string[] | string; outputs?: Record<string, string>; steps?: Krok[] };
const J = (parse(CI_TEXT) as { jobs: Record<string, Uloha> }).jobs;
const kroky = (u: Uloha) => u.steps ?? [];
const volaniVln = (u: Uloha) => kroky(u).find((k) => /nasad-podle-vln\.sh/.test(k.run ?? ""));

const deklarace = (o: Record<string, unknown> = {}) => [
  { aplikace: "web-render", duvod: "Coolify převádí holý bind na prázdný svazek", rozhodnuti: { kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28" }, ...o },
];

describe("čtení deklarace z overlaye (drzene-z-overlaye.sh)", () => {
  const repo = "repo.example.test/vlastnik/data-instance";
  const tokeny: [string, string] = ["TAJNY-TOKEN-1", "TAJNY-TOKEN-2"];

  it("instance BEZ overlaye = nic drženo ([]), kód 0", () => {
    const r = nacti({});
    expect(r.rc, r.text).toBe(0);
    expect(r.drzene).toBe("[]");
  });

  it("⛔ overlay deklarovaný a NEČITELNÝ = pád bez výstupu (ne „nic drženo“ — to by bylo fail-open)", () => {
    const klon = nacti({ repo, tokeny, klonSelze: true });
    expect(klon.rc).toBe(1);
    expect(klon.drzene).toBeUndefined();
    expect(klon.text).toMatch(/deklarace držení NEČITELNÁ/);
    expect(klon.text, "důvod nezdaru klonu se vysloví (brána klon-nesmi-zahodit-duvod)").toMatch(/Could not resolve host/);
    expect(klon.text, "pověření z adresy se nevypíše").not.toMatch(/TAJNY-TOKEN/);
    const bezTokenu = nacti({ repo });
    expect(bezTokenu.rc).toBe(1);
    expect(bezTokenu.drzene).toBeUndefined();
  });

  it("overlay bez souboru deklarace = nic drženo", () => {
    const r = nacti({ repo, tokeny });
    expect(r.rc, r.text).toBe(0);
    expect(r.drzene).toBe("[]");
  });

  it("platná deklarace → JSON na jednom řádku + anotace DRŽENO s důvodem a stářím", () => {
    const r = nacti({ repo, tokeny, obsah: deklarace() });
    expect(r.rc, r.text).toBe(0);
    const d = JSON.parse(r.drzene ?? "null");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ aplikace: "web-render", datum: "2026-09-28", vlna: 10 });
    expect(r.text).toMatch(/::warning title=DRŽENO: web-render::Coolify převádí holý bind na prázdný svazek — rozhodnutí majitel 2026-09-28/);
  });

  it("⛔ neplatná deklarace (bez důvodu, aplikace přímé úlohy, nečitelný JSON) = pád bez výstupu", () => {
    for (const obsah of [deklarace({ duvod: "" }), deklarace({ aplikace: "core" }), "{nejde"]) {
      const r = nacti({ repo, tokeny, obsah });
      expect(r.rc, JSON.stringify(obsah)).toBe(1);
      expect(r.drzene).toBeUndefined();
    }
  });
});

describe("řetěz nasazení nese deklaraci od razítka po verdikt", () => {
  const Z = J["deploy-zacatek"];
  const R = J["deploy-razitko"];
  const vlnove = Object.entries(J).filter(([id, u]) => id.startsWith("deploy-stacky-") && volaniVln(u));

  it("⛔ deklaraci čte deploy-razitko jako PRVNÍ krok nasazení — dřív než se cokoli nasadí", () => {
    // Do 2026-10-03 ji četl až deploy-zacatek, tedy PO Kořeni, Core, Edge a Extranetu:
    // nečitelný overlay by zastavil jen vlny 3+ a nechal instanci napůl nasazenou.
    const kR = kroky(R);
    const i = kR.findIndex((k) => k.id === "drzeni");
    expect(i, "krok s id drzeni v deploy-razitko chybí").toBeGreaterThanOrEqual(0);
    const k = kR[i];
    expect(k.run?.trim()).toBe("bash scripts/ci/drzene-z-overlaye.sh");
    expect(k.env?.OVERLAY_REPO).toBe("${{ secrets.INSTANCE_OVERLAY_REPO }}");
    expect(R.outputs?.drzene).toBe("${{ steps.drzeni.outputs.drzene }}");
    // před čtením deklarace smí být jen checkout — žádný krok, který něco publikuje nebo nasazuje
    expect(kR.slice(0, i).every((x) => x.uses?.startsWith("actions/checkout@")), "před čtením deklarace je jiný krok než checkout").toBe(true);
    expect(kR.slice(0, i).some((x) => x.uses?.startsWith("actions/checkout@")), "bez checkoutu skript nepoběží").toBe(true);
    expect(kR.findIndex((x) => x.id === "razitko"), "razítko (stav pending) až PO ověřené deklaraci").toBeGreaterThan(i);
    // razítko je vstupní brána celého nasazení: bez jeho úspěchu se nespustí ŽÁDNÁ nasazovací úloha
    const nasazovaci = Object.entries(J).filter(([id]) => /^deploy-(koren|core|edge|extranet|zacatek|stacky-)/.test(id));
    expect(nasazovaci.length).toBeGreaterThanOrEqual(12);
    const mimo = nasazovaci
      .filter(([id, u]) => {
        const needs = ([] as string[]).concat((u as { needs?: string | string[] }).needs ?? []);
        const primo = needs.includes("deploy-razitko") && /needs\.deploy-razitko\.result == 'success'/.test(String((u as { if?: string }).if ?? ""));
        // vlnové úlohy visí na deploy-zacatek, který razítko vyžaduje sám
        const pres = needs.includes("deploy-zacatek") && /needs\.deploy-zacatek\.result == 'success'/.test(String((u as { if?: string }).if ?? ""));
        return !(primo || pres) && id !== "deploy-zacatek";
      })
      .map(([id]) => id);
    expect(mimo, "nasazovací úloha, která nečeká na úspěšné deploy-razitko (tedy na ověřenou deklaraci)").toEqual([]);
  });

  it("deploy-zacatek deklaraci jen PŘEDÁVÁ vlnám — a prázdný output je pád; razítko běhu je jediné", () => {
    expect(kroky(Z).some((k) => k.id === "razitko" || k.id === "drzeni"), "druhé razítko / druhé čtení deklarace v běhu").toBe(false);
    expect(Z.outputs?.razitko).toBe("${{ needs.deploy-razitko.outputs.razitko }}");
    expect(Z.outputs?.drzene).toBe("${{ needs.deploy-razitko.outputs.drzene }}");
    const k = kroky(Z).find((x) => x.env?.DRZENE !== undefined);
    expect(k?.env?.DRZENE).toBe("${{ needs.deploy-razitko.outputs.drzene }}");
    expect(k?.run ?? "", "prázdný output razítka = nevíme, co je drženo → pád").toMatch(/\[ -n "\$\{DRZENE:-\}" \] \|\| \{[^}]*exit 1/);
  });

  it("⛔ každá vlnová úloha předá deklaraci skriptu — jinak by držení tiše neplatilo", () => {
    expect(vlnove.length).toBeGreaterThanOrEqual(4);
    const bez = vlnove
      .filter(([, u]) => {
        const k = volaniVln(u)!;
        return k.env?.DRZENE !== "${{ needs.deploy-zacatek.outputs.drzene }}" || !/--drzene "\$DRZENE"/.test(k.run ?? "");
      })
      .map(([id]) => id);
    expect(bez).toEqual([]);
  });

  it("⛔ každé `needs.X.*` má X ve svých needs — jinak je hodnota PRÁZDNÁ a nic to neřekne", () => {
    // Forgejo vydá úloze jen kontext přímých závislostí. Úloha, která čte output úlohy mimo
    // své needs, dostane prázdný řetězec: `--drzene ""`, přeskočená podmínka, tichý fail-open.
    const vady: string[] = [];
    for (const [id, u] of Object.entries(J)) {
      const needs = new Set(([] as string[]).concat((u as { needs?: string | string[] }).needs ?? []));
      for (const m of JSON.stringify(u).matchAll(/needs\.([a-z0-9-]+)\.(outputs|result)/g)) {
        if (!needs.has(m[1])) vady.push(`${id} čte needs.${m[1]}.${m[2]}`);
      }
    }
    expect([...new Set(vady)]).toEqual([]);
  });

  it("⛔ frontend nikdy před backendem: Edge a Extranet čekají na Core", () => {
    // Do 2026-10-03 běžely Core, Edge a Extranet po Kořeni vedle sebe: nový web proti starému
    // jádru = rozbité volání, dokud Core nedoběhne (naměřený výpadek 25 min).
    const core = "(needs.deploy-core.result == 'success' || needs.deploy-core.result == 'skipped' || needs.deploy-core-pokracovani.result == 'success')";
    for (const id of ["deploy-edge", "deploy-extranet"]) {
      const u = J[id] as { needs?: string[]; if?: string };
      expect(u.needs, `${id}: needs`).toEqual(expect.arrayContaining(["deploy-core", "deploy-core-pokracovani"]));
      expect(String(u.if).replace(/\s+/g, " "), `${id}: podmínka nečeká na Core`).toContain(core);
    }
    // mutace: úloha bez podmínky Core by prošla jen jako nález
    expect(String((J["deploy-core"] as { if?: string }).if)).not.toContain("needs.deploy-edge");
  });

  it("držet lze přesně od první vlny, kterou řetěz za deploy-zacatek nasazuje", () => {
    const od = Math.min(...vlnove.map(([, u]) => Number(/--vlny (\d+)/.exec(volaniVln(u)!.run ?? "")?.[1])));
    expect(od).toBe(PRVNI_DRZITELNA_VLNA);
    expect(volaniVln(J["deploy-koren"])?.run ?? "", "Kořen běží před deploy-zacatek — deklaraci nemá").not.toContain("--drzene");
  });

  it("přímé úlohy, které validace odmítne držet, měřidlo opravdu vidí", () => {
    // tři vlastní úlohy nasazení + aplikace, kterou úloha n8n adresuje v Coolify přímo (restart)
    expect([...primeAplikace(CI_TEXT)].sort()).toEqual(["core", "edge", "extranet", "orchestration"]);
    // tvar přímého adresování se pozná i mimo dnešní ci.yml; komentář se nebere
    expect([...primeAplikace('          UUID=$(bash scripts/lib/coolify-resolve-uuid.sh "${APP_PREFIX}-model" 2>&1 || true)')]).toEqual(["model"]);
    expect([...primeAplikace('  # bash scripts/lib/coolify-resolve-uuid.sh "${APP_PREFIX}-model"')]).toEqual([]);
  });

  it("verdikt vypíše výjimky — zelená S VÝPISEM, ne mlčky", () => {
    const k = kroky(J["deploy-verdikt"]).find((x) => /deploy-verdikt/.test(x.run ?? ""))!;
    // z razítka, ne z deploy-zacatek: ten může být přeskočený a verdikt by výjimky neznal
    expect(k.env?.DRZENE).toBe("${{ needs.deploy-razitko.outputs.drzene }}");
    expect(k.run).toContain("drženo: ${DRZ}");
  });

  it("verdikt vyjmenuje a spočítá aplikace, které v Coolify nejsou — „ověřeno“ je neschová", () => {
    const k = kroky(J["deploy-verdikt"]).find((x) => /deploy-verdikt/.test(x.run ?? ""))!;
    const vlnoveVse = Object.entries(J).filter(([, u]) => volaniVln(u));
    expect(vlnoveVse.length).toBeGreaterThanOrEqual(6);
    for (const [id, u] of vlnoveVse) {
      expect(volaniVln(u)!.id, `${id}: krok vlnového skriptu nemá id`).toBe("vlny");
      expect((u as { outputs?: Record<string, string> }).outputs?.nenalezeno, `${id}: output nenalezeno`).toBe("${{ steps.vlny.outputs.nenalezeno }}");
      expect(String(k.env?.NEN), `verdikt nečte nenalezeno z ${id}`).toContain(`needs.${id}.outputs.nenalezeno`);
    }
    expect(k.run).toContain("v Coolify nenalezeno");
  });
});

describe("deklarace držení INSTANCE (overlay)", () => {
  it(`${SOUBOR} overlaye projde validací nad skutečnými vlnami a ci.yml`, (ctx) => {
    const dir = overlayDirOrRequired("nasazeni-drzene-aplikace");
    if (!dir) {
      console.warn("[nasazeni-drzene] bez overlaye — deklaraci instance NEMĚŘENO");
      ctx.skip();
      return;
    }
    const r = spawnSync(process.execPath, ["scripts/lib/nasazeni-drzene.mjs", "--soubor", join(dir, SOUBOR)], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    if (!existsSync(join(dir, SOUBOR))) console.warn(`[nasazeni-drzene] overlay ${SOUBOR} nemá — nic drženo`);
  });
});

// ── 4. JEDEN DOMOV MUTACE: volání deploy/restart/start/stop žije jen v něm ──────
const DOMOV_MUTACE = "scripts/lib/coolify-mutace.mjs";
/** Stromy s kódem, který se pouští nebo nasazuje (ne dokumentace, ne testy). */
const KORENY = [".forgejo", ".github", "scripts", "deploy", "infra", "services", "packages", "apps"];
const BEZ_ADRESARU = new Set(["node_modules", "dist", "build", ".git", "coverage", "trash", "tests", "__tests__"]);
const PRIPONA = /\.(sh|mjs|cjs|js|ts|ya?ml)$/;
const JE_TEST = /\.(test|spec)\.[a-z]+$|\.d\.ts$/;

function souboryKodu(): string[] {
  const out: string[] = [];
  const projdi = (rel: string) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const cesta = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!BEZ_ADRESARU.has(e.name)) projdi(cesta);
      } else if (PRIPONA.test(e.name) && !JE_TEST.test(e.name)) out.push(cesta);
    }
  };
  for (const k of KORENY) if (existsSync(join(ROOT, k))) projdi(k);
  return out.sort();
}

/**
 * Vzory VOLÁNÍ mutace aplikace v Coolify. Poznává se podle ENDPOINTU, ne podle
 * metody ani jména pomocníka: Coolify v4 mutuje i přes GET, a adresa uložená do
 * proměnné a zavolaná o řádek níž je pořád volání.
 */
// Identifikátor v cestě: buď `${…}` (uvnitř smí být mezery i uvozovky — volání funkce),
// nebo souvislý text bez mezer, lomítek, uvozovek a hvězdičky (glob není volání).
const ID = String.raw`(?:\$\{[^}\n]*\}|[^\s/*"'` + "`" + String.raw`])+`;
export const VZORY_MUTACE: Array<{ co: string; re: RegExp }> = [
  { co: "deploy", re: /\/deploy\?/ },
  { co: "deploy", re: /\/api\/v1\/deploy(?![a-z?-])/ },
  { co: "restart/start/stop aplikace", re: new RegExp(String.raw`\/applications\/${ID}\/(?:restart|start|stop)(?![a-z-])`) },
  { co: "restart/start/stop služby", re: new RegExp(String.raw`\/services\/${ID}\/(?:restart|start|stop)(?![a-z-])`) },
  { co: "návrat nasazení", re: new RegExp(String.raw`\/deployments\/${ID}\/restart(?![a-z-])`) },
];

/** Je řádek komentář? (shell/YAML `#`, JS/TS `//` a řádky blokového komentáře) */
const jeKomentar = (rel: string, radek: string) => (/\.(sh|ya?ml)$/.test(rel) ? /^\s*#/ : /^\s*(\/\/|\*|\/\*)/).test(radek);

/** Volání mutace v souboru: číslo řádku + druh. Komentáře se neberou. */
export function volaniMutace(rel: string, text: string, vzory = VZORY_MUTACE): Array<{ radek: number; co: string; text: string }> {
  const out: Array<{ radek: number; co: string; text: string }> = [];
  text.split("\n").forEach((r, i) => {
    if (jeKomentar(rel, r)) return;
    const v = vzory.find((x) => x.re.test(r));
    if (v) out.push({ radek: i + 1, co: v.co, text: r.trim().slice(0, 140) });
  });
  return out;
}

/**
 * Jmenovité výjimky — volání mutace MIMO domov, které tahle větev nepřevedla.
 * Seznam se smí jen ZMENŠOVAT. Každá položka nese důvod; `cile` navíc říká, že
 * spouštěč sahá jen na vyjmenované role, které validace držet NEDOVOLÍ — a to se
 * u každé role měří nad skutečnými vlnami a ci.yml (ne tvrdí).
 * `volani` je strop počtu volání v souboru (dnešní stav): výjimka platí na ta volání,
 * ne na soubor — nové volání ve vyňatém souboru bránu shodí stejně jako jinde.
 */
export type Vyjimka = { duvod: string; volani: number; cile?: string[] };
const NEPREVEDENO = "nepřevedeno — operátorský nástroj mimo konvergenci studeného startu";
const VYJIMKY: Record<string, Vyjimka> = {
  // ── CI: přímé úlohy. Pravidlo vln se tu NEMĚNÍ: validátor deklarace takové aplikace držet nedovolí. ──
  "scripts/ci/deploy-and-verify.sh": {
    volani: 2,
    duvod:
      "CI: pomocník nasazení JEDNÉ aplikace. Volají ho vlny (nasad-podle-vln.sh --drzene drženou přeskočí PŘED voláním) a přímé úlohy Core/Edge/Extranet — " +
      "aplikaci s přímou úlohou validátor deklarace držet nedovolí (primeAplikace), takže na drženou nedosáhne. Volající měří test níž.",
  },
  ".forgejo/workflows/ci.yml": {
    volani: 1,
    cile: ["orchestration"],
    duvod: "CI: přímá úloha — po vydání uzlů n8n restartuje jen stack orchestration; validátor (primeAplikace) ho držet nedovolí",
  },
  ".forgejo/workflows/staging-deploy.yml": {
    volani: 3,
    cile: ["staging"],
    duvod: `${NEPREVEDENO}: nasazuje a zastavuje jen stagingovou aplikaci PR, kterou WAVES neznají`,
  },
  // ── Operátorské nástroje s pevným cílem, který držet nejde (měřeno) ──
  "scripts/aisha-mesh-toggle.mjs": { volani: 1, cile: ["edge"], duvod: `${NEPREVEDENO}: přepíná mesh a přenasazuje jen edge` },
  "scripts/pki-bridge-deploy.mjs": { volani: 1, cile: ["pki"], duvod: `${NEPREVEDENO}: nastaví HMAC a restartuje jen pki` },
  "scripts/n8n-release.mjs": { volani: 1, cile: ["orchestration"], duvod: `${NEPREVEDENO}: po vydání uzlů restartuje jen n8n (stack orchestration)` },
  // ── Nepřevedeno a drženou aplikaci nasadit UMÍ — přiznaná díra, ne souhlas ──
  ".github/workflows/deploy.yml": { volani: 2, duvod: `${NEPREVEDENO}: zrcadlo ručního dispatche pro GitHub (Forgejo dispatch převeden je)` },
  "deploy/connectors/coolify.mjs": { volani: 2, duvod: `${NEPREVEDENO}: konektor aisha-ctl — nasadí nebo restartuje libovolnou aplikaci manifestu` },
  "infra/pki/pki-renewer.sh": { volani: 2, duvod: `${NEPREVEDENO}: běhový sidecar — po obnově certifikátu restartuje konzumenta (RENEW_SERVICES)` },
  "scripts/aisha-deploy-all.sh": { volani: 1, duvod: `${NEPREVEDENO}: starý hromadný spouštěč s pevným výčtem stacků` },
  "scripts/blue-green-deploy.sh": { volani: 3, duvod: `${NEPREVEDENO}: ruční B/G přepnutí — nasazuje sloty <aplikace>-blue/-green` },
  "scripts/blue-green-switch.mjs": { volani: 1, duvod: `${NEPREVEDENO}: B/G protokol autonomního nasazení — nasazuje cílový slot` },
  "scripts/deploy-oauth-coolify.mjs": { volani: 1, duvod: `${NEPREVEDENO}: přenasadí aplikace podle UUID z prostředí obsluhy (které to jsou, z kódu poznat nejde)` },
  "scripts/lib/coolify-resolve-uuid.mjs": { volani: 1, duvod: `${NEPREVEDENO}: pomocník „--redeploy <jméno>“ — restartuje libovolnou jmenovanou aplikaci` },
  "scripts/lib/coolify-resolve-uuid.sh": { volani: 1, duvod: `${NEPREVEDENO}: pomocník „--redeploy <jméno>“ — restartuje libovolnou jmenovanou aplikaci` },
  "scripts/pki-issue-internal-cert.sh": { volani: 1, duvod: `${NEPREVEDENO}: po vydání certifikátu přenasadí jeho konzumenta (výchozí TRIGGER_DEPLOY=1)` },
  "scripts/verify-shared-redis-acl-fresh.mjs": { volani: 1, duvod: `${NEPREVEDENO}: ověřovací skript — s --heal přenasadí shared-redis a opozdilé konzumenty (přes GET)` },
  "services/gateway/src/routes/deployment-executor.ts": { volani: 2, duvod: `${NEPREVEDENO}: běhová služba autonomního nasazení — restartuje aplikaci nebo službu podle UUID z požadavku` },
};

/** Vady seznamu výjimek: bez důvodu, mrtvé (na skutečné volání už nesedí), zbytečné (domov). */
export function vadyVyjimek(vyjimky: Record<string, Vyjimka>, nalezy: Map<string, unknown[]>): string[] {
  const vady: string[] = [];
  for (const [rel, v] of Object.entries(vyjimky)) {
    if (typeof v?.duvod !== "string" || v.duvod.trim().length < 30) vady.push(`${rel}: výjimka bez důvodu`);
    if (!nalezy.has(rel)) vady.push(`${rel}: mrtvá výjimka — soubor mutaci (už) nevolá nebo neexistuje; smaž ji`);
    else if (!Number.isInteger(v?.volani) || v.volani < 1) vady.push(`${rel}: výjimka bez stropu volání`);
    else {
      const n = nalezy.get(rel)!.length;
      if (n > v.volani) vady.push(`${rel}: ${n} volání mutace, výjimka kryje ${v.volani} — nové volání pošli přes domov`);
      if (n < v.volani) vady.push(`${rel}: ${n} volání mutace, strop ${v.volani} — sniž ho (seznam se smí jen zmenšovat)`);
    }
    if (rel === DOMOV_MUTACE) vady.push(`${rel}: domov mutace výjimku nepotřebuje`);
  }
  return vady;
}

describe("jeden domov mutace: aplikaci v Coolify nasadí, restartuje, spustí nebo zastaví jen coolify-mutace.mjs", () => {
  const SOUBORY = souboryKodu();
  const texty = new Map(SOUBORY.map((rel) => [rel, readFileSync(join(ROOT, rel), "utf8")] as const));
  const nalezy = new Map<string, ReturnType<typeof volaniMutace>>();
  for (const rel of SOUBORY) {
    const n = volaniMutace(rel, texty.get(rel)!);
    if (n.length) nalezy.set(rel, n);
  }

  it("⛔ SAMOTEST vzoru: v domově mutace volání NAJDE — jinak je brána NEZMĚŘENO, ne zelená", () => {
    expect(SOUBORY.length, "prázdné univerzum by vlastnost splnilo triviálně").toBeGreaterThan(500);
    const vDomove = nalezy.get(DOMOV_MUTACE) ?? [];
    expect(vDomove.length, `NEZMĚŘENO: vzor v ${DOMOV_MUTACE} nenašel jediné volání mutace — hledá něco, co v repu není`).toBeGreaterThanOrEqual(5);
    // každý druh akce domova vzor vidí (deploy, restart, start, stop, návrat nasazení)
    const radky = vDomove.map((n) => n.text).join("\n");
    for (const kus of ["/deploy?uuid=", "/restart", "/start`", "/stop`", "/deployments/"]) expect(radky, `vzor v domově nevidí „${kus}“`).toContain(kus);
    // …a domov se na držení PTÁ dřív, než cestu sestaví a odešle
    const domov = texty.get(DOMOV_MUTACE)!;
    const telo = domov.slice(domov.indexOf("export async function mutujAplikaci("), domov.indexOf("export function adresaWebhooku("));
    expect(telo.indexOf("drzenaPolozka(z, k)")).toBeGreaterThan(-1);
    expect(telo.indexOf("drzenaPolozka(z, k)")).toBeLessThan(telo.indexOf("k.volej("));
    expect(domov).toMatch(/from "\.\/nasazeni-drzene\.mjs"/);
  });

  it("kontrolní vzorky tvarů: každý tvar volání, který v repu je, vzor POZNÁ (i GET a adresu v proměnné)", () => {
    const tvary: Array<[string, string]> = [
      ["x.yml", '              -X POST "${BASE_URL}/api/v1/deploy?uuid=${UUID}&force=${FORCE}" \\'],
      ["x.sh", '    "$COOLIFY_API/deploy?uuid=$uuid" 2>&1 | tr -d \'\\000-\\037\')'],
      ["x.sh", 'if ! api POST "/deploy?uuid=${TARGET_UUID}&force=true" >/dev/null; then'],
      ["x.mjs", '    const r = await coolify(`/deploy?uuid=${uuid}&force=true`, { method: "POST" });'],
      ["x.mjs", '    const deployRes = await coolify("POST", `/deploy?uuid=${targetUuid}&force=true`, null);'],
      ["x.mjs", "      path: `/api/v1/deploy?uuid=${uuid}&force=true`,"],
      // mutace přes GET (Coolify v4): metoda nerozhoduje
      ["x.mjs", '        const res = await coolify(`/deploy?uuid=${uuid}&force=true`, { method: "GET" });'],
      ["x.sh", '  curl -sS "$COOLIFY_URL/api/v1/deploy?uuid=$UUID"'],
      // adresa složená do proměnné, volání o řádek níž
      ["x.yml", '          DEPLOY_URL="${COOLIFY_URL}/api/v1/deploy?uuid=${UUID}&force=true"'],
      ["x.sh", '    WEBHOOK_URL="${COOLIFY_URL}/api/v1/deploy?uuid=${UUID_WEB}&force=false"'],
      ["x.sh", '  curl -X POST "$COOLIFY_URL/api/v1/deploy" -d "{\\"uuid\\":\\"$U\\"}"'],
      // restart / start / stop a návrat nasazení
      ["x.mjs", "    const result = await api(\"POST\", `/applications/${pkiApp.uuid}/restart`);"],
      ["x.yml", '            -X POST "${COOLIFY_URL}/api/v1/applications/${UUID}/stop" \\'],
      ["x.sh", '    "${COOLIFY_API}/applications/$1/restart" 2>/dev/null || true'],
      ["x.mjs", "  await request(base, token, `/applications/${uuid}/start`, { method: \"GET\" });"],
      ["x.mjs", "    await coolify(`/deployments/${deploymentUuid}/restart?force=true`, { method: \"POST\" });"],
      ["x.mjs", "    await coolify(`/applications/${appUuid}/restart?deployment_uuid=${d}&force=true`, { method: \"POST\" });"],
      ["x.ts", "    ? `${coolifyUrl}/api/v1/services/${targetId}/restart`"],
      // identifikátor jako volání funkce uvnitř `${…}` (mezery, uvozovky)
      ["x.mjs", '  const cesta = `/applications/${overUuid(z.uuid, "uuid aplikace")}/stop`;'],
    ];
    const nepoznane = tvary.filter(([rel, radek]) => volaniMutace(rel, radek).length !== 1).map(([, r]) => r);
    expect(nepoznane, "tvar volání mutace, který vzor nevidí — nový spouštěč v tomhle tvaru by bránou prošel").toEqual([]);
  });

  it("…a co volání NENÍ, nehlásí: komentář, čtení nasazení, zápis env, výčet cest s globem", () => {
    const neni: Array<[string, string]> = [
      ["x.sh", '  # curl -X POST "$API/deploy?uuid=$UUID"'],
      ["x.mjs", "// await coolify(`/applications/${uuid}/restart`)"],
      ["x.mjs", " * POST /api/v1/deploy vrátil 2xx"],
      ["x.sh", "    /deploy|/applications/*/start|/applications/*/stop|/applications/*/restart) return 0 ;;"],
      ["x.sh", '  "${COOLIFY_URL}/api/v1/deployments/${NASAZENI}" \\'],
      ["x.sh", '  KOD=$(curl "${COOLIFY_URL}/api/v1/deployments/applications/${UUID}?skip=0&take=50")'],
      ["x.sh", '      "${COOLIFY_API}/applications/${uuid}/envs/bulk"'],
      ["x.mjs", "  const a = await coolify(`/applications/${uuid}`);"],
    ];
    expect(neni.filter(([rel, radek]) => volaniMutace(rel, radek).length > 0).map(([, r]) => r)).toEqual([]);
  });

  it("⛔ volání mutace MIMO domov = pád se souborem a řádkem (výjimka jen jmenovitě)", () => {
    const mimo: string[] = [];
    for (const [rel, n] of nalezy) {
      if (rel === DOMOV_MUTACE || VYJIMKY[rel]) continue;
      for (const v of n) mimo.push(`${rel}:${v.radek} (${v.co}) ${v.text}`);
    }
    expect(
      mimo,
      "Volání, které aplikaci v Coolify nasadí / restartuje / spustí / zastaví, MIMO jediný domov mutace.\n" +
        "Takové volání se neptá na deklarované držení — drženou aplikaci by nasadilo (odpojení dat) nebo zastavilo.\n" +
        `Pošli ho přes ${DOMOV_MUTACE} (mutujAplikaci; v shellu scripts/lib/coolify-mutace.sh → coolify_mutace).\n` +
        "Výjimka jen jmenovitě v VYJIMKY s důvodem — a jen pro nástroj, který tahle konvergence nespouští.",
    ).toEqual([]);
  });

  it("nové volání kdekoli mimo domov bránu SHODÍ a jmenuje řádek (kontrolní vzorek červené)", () => {
    const novy = ["#!/usr/bin/env bash", "set -euo pipefail", "# nasadí aplikaci", 'curl -sS -X POST "$COOLIFY_URL/api/v1/deploy?uuid=$1&force=true"'].join("\n");
    expect(volaniMutace("scripts/novy-spoustec.sh", novy)).toEqual([expect.objectContaining({ radek: 4, co: "deploy" })]);
    expect(VYJIMKY["scripts/novy-spoustec.sh"], "kontrolní vzorek nesmí být ve výjimkách").toBeUndefined();
    // měřidlo zúžené na `deploy` by restart a stop nevidělo — proto se měří i ony
    const jenDeploy = VZORY_MUTACE.filter((v) => v.co === "deploy");
    expect(volaniMutace("x.sh", 'curl -X POST "$API/applications/$U/restart"', jenDeploy)).toEqual([]);
    expect(volaniMutace("x.sh", 'curl -X POST "$API/applications/$U/restart"')).toHaveLength(1);
    expect(volaniMutace("x.sh", 'curl -X POST "$API/applications/$U/stop"')).toHaveLength(1);
  });

  it("cesty, které studený start spouští, a ruční dispatch volání mutace NEOBSAHUJÍ — jdou přes domov", () => {
    const prevedene = [
      "scripts/aisha-cold-start.sh",
      "scripts/aisha-redeploy.mjs",
      "scripts/coolify-sync-envs.sh",
      "scripts/coolify-deploy-init.sh",
      "scripts/coolify-story-init.sh",
      "scripts/coolify-domain-doctor.mjs",
      "scripts/provision-surfaces.sh",
      "scripts/netbird-bootstrap.sh",
      "scripts/aisha-bootstrap-user-init.sh",
      "scripts/coolify-mesh-sync.mjs",
      "scripts/pki-bootstrap-jwks-sync.mjs",
      ".forgejo/workflows/deploy.yml",
    ];
    for (const rel of prevedene) {
      expect(texty.has(rel), `${rel} neexistuje — seznam převedených cest je mrtvý`).toBe(true);
      expect(nalezy.get(rel) ?? [], `${rel} volá mutaci mimo domov`).toEqual([]);
      expect(VYJIMKY[rel], `${rel} má být převedený, ne vyňatý`).toBeUndefined();
    }
    // kdo nasazuje nebo restartuje, volá domov: import + mutujAplikaci( / obal + coolify_mutace
    for (const rel of ["scripts/aisha-redeploy.mjs", "scripts/coolify-domain-doctor.mjs"]) {
      expect(texty.get(rel)!, rel).toMatch(/from "\.\/lib\/coolify-mutace\.mjs"/);
      expect(texty.get(rel)!, rel).toMatch(/\bmutujAplikaci\(/);
    }
    for (const rel of ["scripts/coolify-sync-envs.sh", "scripts/coolify-deploy-init.sh", "scripts/provision-surfaces.sh"]) {
      expect(texty.get(rel)!, rel).toMatch(/\n\s*\.\s+"[^"\n]*\/lib\/coolify-mutace\.sh"/);
      expect(texty.get(rel)!, rel).toMatch(/\bcoolify_mutace (deploy|webhook) /);
    }
    // soubor prostředí instance se čtenáři předává výslovně (revize cb N3): deklarace overlaye
    // může ležet jen v něm, a bez ní by čtenář overlay neviděl → „nic drženo“
    expect(texty.get("scripts/aisha-cold-start.sh")!).toMatch(/drzeni_nacti "aisha-cold-start" "\$\{ENV_COOLIFY:-\}"/);
    expect(texty.get("scripts/coolify-story-init.sh")!).toMatch(/drzeni_nacti "coolify-story-init" "\$\{ENV_FILE:-\}"/);
    expect(texty.get("scripts/provision-surfaces.sh")!).toMatch(/coolify_mutace deploy [^\n]*\$\{ENV_FILE:\+--env-soubor "\$ENV_FILE"\}/);
    expect(texty.get(".forgejo/workflows/deploy.yml")!).toMatch(/node scripts\/lib\/coolify-mutace\.mjs --akce deploy [\s\S]*?--drzene "\$\{DRZENE:-\}"/);
    expect(texty.get(".forgejo/workflows/deploy.yml")!).toMatch(/node scripts\/lib\/coolify-mutace\.mjs --akce restart [\s\S]*?--drzene "\$\{DRZENE:-\}"/);
    // shellový obal je obal TÉŽE logiky: spouští CLI domova a sám žádnou cestu neskládá
    const obal = readFileSync(join(ROOT, "scripts/lib/coolify-mutace.sh"), "utf8");
    expect(obal).toMatch(/node "\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)" && pwd\)\/coolify-mutace\.mjs"/);
    expect(volaniMutace("scripts/lib/coolify-mutace.sh", obal)).toEqual([]);
    const kodObalu = obal.split("\n").filter((r) => !jeKomentar("scripts/lib/coolify-mutace.sh", r)).join("\n");
    expect(kodObalu, "obal nesmí volat Coolify sám").not.toMatch(/\b(curl|wget|fetch)\b/);
  });

  it("⛔ výjimky: každá nese důvod, žádná není mrtvá — a výjimka bez důvodu neprojde", () => {
    expect(vadyVyjimek(VYJIMKY, nalezy)).toEqual([]);
    // kontrolní vzorky ČERVENÉ: měřidlo výjimek umí říct „vada“
    const vzorek = new Map([["scripts/a.sh", [1]]]);
    expect(vadyVyjimek({ "scripts/a.sh": { duvod: "", volani: 1 } }, vzorek)).toEqual(["scripts/a.sh: výjimka bez důvodu"]);
    expect(vadyVyjimek({ "scripts/a.sh": { duvod: "protože", volani: 1 } }, vzorek)).toEqual(["scripts/a.sh: výjimka bez důvodu"]);
    expect(vadyVyjimek({ "scripts/a.sh": { volani: 1 } as Vyjimka }, vzorek)).toEqual(["scripts/a.sh: výjimka bez důvodu"]);
    expect(vadyVyjimek({ "scripts/zmizel.sh": { duvod: NEPREVEDENO, volani: 1 } }, vzorek)).toEqual([expect.stringMatching(/mrtvá výjimka/)]);
    // strop volání: výjimka kryje volání, ne soubor
    expect(vadyVyjimek({ "scripts/a.sh": { duvod: NEPREVEDENO, volani: 1 } }, vzorek)).toEqual([]);
    expect(vadyVyjimek({ "scripts/a.sh": { duvod: NEPREVEDENO, volani: 1 } }, new Map([["scripts/a.sh", [1, 2]]]))).toEqual([expect.stringMatching(/2 volání mutace, výjimka kryje 1/)]);
    expect(vadyVyjimek({ "scripts/a.sh": { duvod: NEPREVEDENO, volani: 3 } }, vzorek)).toEqual([expect.stringMatching(/strop 3 — sniž ho/)]);
    expect(vadyVyjimek({ "scripts/a.sh": { duvod: NEPREVEDENO } as Vyjimka }, vzorek)).toEqual(["scripts/a.sh: výjimka bez stropu volání"]);
    // seznam se smí jen ZMENŠOVAT: strop je dnešní počet (nová výjimka = vědomé zvýšení tady)
    expect(Object.keys(VYJIMKY).length).toBeLessThanOrEqual(18);
  });

  it("⛔ přeskočit vlastní čtení deklarace (`--drzene` / `drzene:`) smí jen ruční dispatch, kterému deklaraci čte jeho vlastní krok", () => {
    // Domov s předaným seznamem držení deklaraci nečte — `--drzene '[]'` by drženou aplikaci nasadil.
    // Smí ho proto předat jen volající, kterému seznam dodal krok, jenž deklaraci ověřeně četl (deploy.yml → drzene-z-overlaye.sh).
    const SMI = [".forgejo/workflows/deploy.yml"];
    const kod = (rel: string) => texty.get(rel)!.split("\n").filter((r) => !jeKomentar(rel, r)).join("\n");
    const predava = (rel: string, t: string) =>
      (/coolify[-_]mutace/.test(t) && /--drzene\b/.test(t)) || (/\b(mutujAplikaci|drzenaPolozka)\(/.test(t) && /\bdrzene\s*:/.test(t));
    const kdo = SOUBORY.filter((rel) => rel !== DOMOV_MUTACE && rel !== "scripts/lib/coolify-mutace.sh" && predava(rel, kod(rel)));
    expect(kdo, "nový volající předává domovu seznam držení místo vlastního čtení deklarace").toEqual(SMI);
    // kontrolní vzorky: měřidlo vidí obě cesty
    expect(predava("x.sh", 'coolify_mutace deploy "$N" "$U" --kdo x --drzene \'[]\'')).toBe(true);
    expect(predava("x.mjs", "await mutujAplikaci(z, { kdo: 'x', drzene: [] });")).toBe(true);
    expect(predava("x.sh", 'coolify_mutace deploy "$N" "$U" --kdo x')).toBe(false);
  });

  it("⛔ výjimka „na drženou nedosáhne“ se MĚŘÍ: každou její roli validace držet nedovolí", () => {
    const poradi = spawnSync(process.execPath, ["scripts/aisha-redeploy.mjs", "--print-waves"], { cwd: ROOT, encoding: "utf8" });
    expect(poradi.status, poradi.stderr).toBe(0);
    const kontext = { vlny: vlnyZPoradi(poradi.stdout), prime: primeAplikace(CI_TEXT), dnes: "2026-10-04" };
    const jdeDrzet = (aplikace: string) =>
      validuj([{ aplikace, duvod: "měření výjimky", rozhodnuti: { kdo: "brána", datum: "2026-10-04", odkaz: "měření" } }], kontext).chyby.length === 0;
    // kontrolní vzorek: měřidlo umí říct ANO (jinak by „nejde držet“ platilo pro cokoli)
    expect(jdeDrzet("web-render")).toBe(true);
    const drzitelne: string[] = [];
    for (const [rel, v] of Object.entries(VYJIMKY)) for (const role of v.cile ?? []) if (jdeDrzet(role)) drzitelne.push(`${rel} → ${role}`);
    expect(drzitelne, "výjimka tvrdí „drženou aplikaci nezasáhne“, ale tuhle roli držet JDE — spouštěč ji nasadí bez čtení deklarace").toEqual([]);
  });

  it("⛔ CI pomocník nasazení jedné aplikace: volá ho jen vlnový skript (za stráží držení) a přímé úlohy ci.yml", () => {
    const bezKomentaru = (rel: string) => texty.get(rel)!.split("\n").filter((r) => !jeKomentar(rel, r)).join("\n");
    const volajici = SOUBORY.filter((rel) => rel !== "scripts/ci/deploy-and-verify.sh" && /deploy-and-verify\.sh/.test(bezKomentaru(rel)));
    expect(volajici, "nový volající deploy-and-verify.sh — pomocník se na držení neptá, musí se ptát volající").toEqual([".forgejo/workflows/ci.yml", "scripts/ci/nasad-podle-vln.sh"]);
    const vlny = bezKomentaru("scripts/ci/nasad-podle-vln.sh");
    const straz = vlny.indexOf('if drzena "$app"; then');
    expect(straz, "vlnový skript nemá stráž držení").toBeGreaterThan(-1);
    expect(vlny.indexOf('bash scripts/ci/deploy-and-verify.sh "$app"')).toBeGreaterThan(straz);
    // přímé úlohy ci.yml: každou aplikaci, kterou nasazují mimo vlny, validace držet odmítne
    const primo = [...bezKomentaru(CI).matchAll(/bash scripts\/ci\/deploy-and-verify\.sh ([a-z0-9-]+)\b/g)].map((m) => m[1]);
    expect(primo.length).toBeGreaterThanOrEqual(3);
    expect(primo.filter((a) => !primeAplikace(CI_TEXT).has(a))).toEqual([]);
  });
});

// ── 5. STUDENÝ START: čte před prvním zásahem, nic drženého nesmaže ani nezapíše ──
describe("studený start a nástroje, které volá: držená aplikace je zmrazená celá", () => {
  const bezKom = (rel: string) => {
    const t = readFileSync(join(ROOT, rel), "utf8");
    return t.split("\n").filter((r) => !jeKomentar(rel, r)).join("\n");
  };
  const CS = bezKom("scripts/aisha-cold-start.sh");
  const RD = bezKom("scripts/aisha-redeploy.mjs");

  /** Tělo shellové funkce `jmeno() { … }` (první `}` na začátku řádku). */
  const teloSh = (zdroj: string, jmeno: string) => {
    const od = zdroj.indexOf(`\n${jmeno}() {`);
    expect(od, `funkce ${jmeno} chybí`).toBeGreaterThan(-1);
    return zdroj.slice(od, zdroj.indexOf("\n}\n", od));
  };

  it("⛔ cold-start: deklarace se čte PŘED doktorem (krok 0) a nečitelná = konec běhu", () => {
    const nacti = teloSh(CS, "cs_nacti_drzeni");
    expect(nacti).toMatch(/if ! drzeni_nacti "aisha-cold-start" "\$\{ENV_COOLIFY:-\}"; then[\s\S]*?\bexit 1\b/);
    const volani = CS.indexOf("\ncs_nacti_drzeni\n");
    expect(volani, "cs_nacti_drzeni se na nejvyšší úrovni nevolá").toBeGreaterThan(-1);
    expect(volani).toBeLessThan(CS.indexOf('step "0. PREFLIGHT DOCTOR'));
    // overlay, který dorazí až během kroku 2, deklaraci čte znovu — první čtení o něm nevědělo
    expect(CS).toMatch(/\n\s*_fetch_instance_overlay\n\s*if \[ -n "\$\{AISHA_INSTANCE_CONFIG_DIR:-\}" \]; then\n\s*cs_nacti_drzeni\n/);
  });

  it("⛔ cold-start: KAŽDÉ mazání aplikace je za stráží držení (wipe, rewarmup) nebo cílí jen na warmup", () => {
    const mazani = [...CS.matchAll(/coolify_api DELETE "\/applications\/\$\{([a-z_]+)[^"]*"/g)].map((m) => m[1]);
    // tři místa: wipe (uuid), rewarmup (_rw_uuids), úklid warmupu (uuid) — čtvrté musí dostat stráž a přijít sem
    expect(mazani).toEqual(["uuid", "_rw_uuids", "uuid"]);

    const wipe = teloSh(CS, "wipe_orphan_apps");
    const strazWipe = wipe.indexOf('if drzena "$(cs_role_aplikace "$name")"; then');
    expect(strazWipe, "wipe nemá stráž držení").toBeGreaterThan(-1);
    expect(wipe.slice(strazWipe, wipe.indexOf("\n    fi", strazWipe)), "držená aplikace se do mazaných nesmí dostat").toMatch(/\bcontinue\b/);
    expect(strazWipe).toBeLessThan(wipe.indexOf('_uuids+=("$uuid")'));
    expect(wipe.indexOf('_uuids+=("$uuid")')).toBeLessThan(wipe.indexOf("coolify_api DELETE"));

    expect(teloSh(CS, "cs_rewarmup_nesmi_drzenou")).toMatch(/drzena "\$\(cs_role_aplikace "\$_cil"\)"[\s\S]*?\bexit 1\b/);
    const krok2d = CS.indexOf('step "2d. REWARMUP');
    const strazRw = CS.indexOf("\ncs_rewarmup_nesmi_drzenou\n", krok2d);
    expect(strazRw, "krok 2d nemá stráž držení před mazáním").toBeGreaterThan(krok2d);
    expect(strazRw).toBeLessThan(CS.indexOf('coolify_api DELETE "/applications/${_rw_uuids'));

    // úklid warmupu maže jen <prefix>-netinit-* (vlna 0) — a tu validace držet nedovolí (měřeno v testech domova)
    expect(teloSh(CS, "remove_warmup_apps")).toMatch(/case "\$name" in "\$\{APP_NAME_PREFIX\}-netinit-"\*\)/);
  });

  it("cold-start: držená aplikace se nezakládá, nedostane seed compose — a souhrn ji JMENUJE", () => {
    expect(CS).toMatch(/if drzena "\$_id"; then info "[^"]*DRŽENO[^"]*"; continue; fi/);
    const seed = CS.slice(CS.indexOf("Pre-seeding docker_compose_raw"), CS.indexOf('done <<< "$SCOPED_APPS"'));
    expect(seed.indexOf('if drzena "$(cs_role_aplikace "$name")"; then')).toBeGreaterThan(-1);
    expect(seed.indexOf('if drzena "$(cs_role_aplikace "$name")"; then')).toBeLessThan(seed.indexOf("coolify_api PATCH"));
    const souhrn = CS.slice(CS.indexOf('step "7. SUMMARY"'));
    expect(souhrn).toMatch(/if \[ -n "\$DRZENI_APLIKACE" \]; then\n\s*warn "DRŽENÉ APLIKACE[\s\S]*?drzeni_vypis/);
  });

  it("⛔ nástroje kroků 3 a 4 a zápis pověření: deklaraci čtou před prvním zápisem a drženou vynechají", () => {
    // tvar čtenáře v shellu: zdrojuje lib/drzeni.sh, načte (jinak konec) a ptá se `drzena`
    for (const [rel, kdo] of [
      ["scripts/coolify-story-init.sh", "coolify-story-init"],
      ["scripts/coolify-deploy-init.sh", "coolify-deploy-init"],
      ["scripts/coolify-sync-envs.sh", "coolify-sync-envs"],
      ["scripts/aisha-bootstrap-user-init.sh", "aisha-bootstrap-user-init"],
    ] as const) {
      const kod = bezKom(rel);
      expect(kod, `${rel}: nezdrojuje čtenáře držení`).toMatch(/\n\s*\.\s+"[^"\n]*\/lib\/drzeni\.sh"/);
      expect(kod, `${rel}: nenačte deklaraci nebo po neúspěchu pokračuje`).toMatch(new RegExp(`if ! drzeni_nacti "${kod.includes(`"${kdo}"`) ? kdo : "CHYBÍ"}"[^\\n]*; then\\n[\\s\\S]*?\\bexit 1\\b`));
      expect(kod, `${rel}: na držení se neptá`).toMatch(/\bdrzena\s+["$a-z]/);
    }
    // story-init: stráž je ve smyčce aplikací PŘED zápisem (reconcile i založení)
    const SI = bezKom("scripts/coolify-story-init.sh");
    const smycka = SI.slice(SI.indexOf('for app_spec in "${APPS[@]}"; do'));
    expect(smycka.indexOf('if drzena "$role"; then')).toBeGreaterThan(-1);
    expect(smycka.indexOf('if drzena "$role"; then')).toBeLessThan(smycka.indexOf("reconcile_app_config "));
    expect(smycka.indexOf('if drzena "$role"; then')).toBeLessThan(smycka.indexOf('coolify_api POST "/applications/public"'));
    // deploy-init: držený stack vypadne ze VŠECH smyček dřív, než první začne; webhook vydává domov mutace
    const DI = bezKom("scripts/coolify-deploy-init.sh");
    const filtr = DI.indexOf('bez_drzenych "$SELECTED_STACKS"; SELECTED_STACKS="$BEZ_DRZENYCH"');
    expect(filtr).toBeGreaterThan(-1);
    expect(DI.indexOf('bez_drzenych "$ALL_STACKS";')).toBeGreaterThan(-1);
    expect(filtr).toBeLessThan(DI.indexOf("for stack in $SELECTED_STACKS; do"));
    expect(filtr).toBeLessThan(DI.indexOf("for stack in $ALL_STACKS; do"));
    expect(DI).toMatch(/WEBHOOK_URL="\$WEBHOOK_SESTAVENY"/);
    expect(DI).toMatch(/if \[ -n "\$UUID_WEB" \] && \[ "\$WEBHOOK_DRZENO" = "0" \]; then/);
    // sync-envs: stráž je první věc ve smyčce aplikací, před sestavením i odesláním payloadu
    const SE = bezKom("scripts/coolify-sync-envs.sh");
    const sync = SE.slice(SE.indexOf('banner "Sync"'), SE.indexOf('banner "Souhrn"'));
    expect(sync.indexOf('if drzena "${NAME#"${PREFIX}"-}"; then')).toBeGreaterThan(-1);
    expect(sync.indexOf('if drzena "${NAME#"${PREFIX}"-}"; then')).toBeLessThan(sync.indexOf("build_app_payload"));
    // doktor: neplatná deklarace je FAIL, držené aplikace informace
    const DR = bezKom("scripts/cold-start-doctor.sh");
    expect(DR).toMatch(/if drzeni_nacti "cold-start-doctor" 2>"\$_dr_chyby"; then[\s\S]*?\binfo "[^"]*\$\{_dr_hlaska\}[\s\S]*?else\n\s*fail "deklarace držení aplikací je NEČITELNÁ nebo NEPLATNÁ/);
  });

  it("⛔ redeploy: deklarace se čte před výběrem cílů; výběr drženou vyřadí; --only a --canary ji ODMÍTNOU kódem DRŽENO", () => {
    const main = RD.slice(RD.indexOf("async function main()"));
    const cteni = main.indexOf("nactiDrzeni();");
    expect(cteni, "main deklaraci nenačte").toBeGreaterThan(-1);
    expect(cteni, "--status smí odpovědět i bez deklarace; cokoli dál ne").toBeGreaterThan(main.indexOf("if (STATUS_ONLY) return;"));
    for (const prvni of ["mapaInstance()", "filterWaveApps(", "runCanary(", "pripravHlidani()"]) {
      expect(cteni, `deklarace se čte až po ${prvni}`).toBeLessThan(main.indexOf(prvni));
    }
    expect(RD, "výběr cílů vlny drženou nevyřadí").toMatch(/apps\.has\(n\) && !vypnute\.has\(n\) && !DRZENE\.has\(n\)/);
    // nečitelná deklarace = konec s kódem 2, ne „nic drženo“
    expect(RD.slice(RD.indexOf("function nactiDrzeni()"), RD.indexOf("function filterWaveApps("))).toMatch(/catch \(e\) \{[\s\S]*process\.exit\(2\);/);
    // tatáž (jednou načtená) deklarace, které se ptá domov mutace
    expect(RD).toMatch(/drzeniProcesu\(MUTACE\.kdo, \{ envSoubory: MUTACE\.envSoubory \}\)/);
    // výslovné cílení: žádný přepínač, který by držení přebil — jen odmítnutí
    expect(RD).toMatch(/if \(DRZENE\.has\(fullName\)\) \{[\s\S]*?process\.exit\(KOD_DRZENO\);/);
    expect(RD).toMatch(/if \(jmenovane && drzeneVBehu\.length > 0\) \{[\s\S]*?process\.exit\(KOD_DRZENO\);/);
    const registr = /const ZNAME_PREPINACE = new Set\(\[([\s\S]*?)\]\);/.exec(RD)?.[1] ?? "";
    expect(registr).toContain('"--only"');
    for (const obchvat of ["--force", "--i-drzene", "--ignore-hold", "--no-hold"]) expect(registr, `přepínač ${obchvat} by držení přebil`).not.toContain(`"${obchvat}"`);
  });
});
