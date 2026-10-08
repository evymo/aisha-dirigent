/**
 * Brána: stack, který se z tohohle repa STAVÍ, musí mít cestu, kterou ho CI nasadí.
 *
 * PROČ (naměřeno POČTVRTÉ, pokaždé se opravil jen ten jeden výskyt)
 * ----------------------------------------------------------------
 * 2026-07-29 — „Deploy: Web" volal `/restart` místo `/deploy`.
 * 2026-07-30 — extranet nebyl v ŽÁDNÉ pipeline.
 * 2026-08-08 — všechny deploy úlohy zelené, extranet servíroval starý bundle.
 * 2026-08-09 — `<prefix>-edge` nebyl v ŽÁDNÉ pipeline. Web servíroval bundle
 *   s `last-modified: Fri, 07 Aug 2026 12:37:17 GMT`, tedy DVA DNY starý,
 *   zatímco se toho dne do mainu slilo deset PR.
 *
 * `deploy-job-nesmi-lhat` hlídá, že úloha, která nasazuje, taky ČEKÁ na výsledek.
 * Nehlídá ale to, co selhalo teď: že cesta k nasazení vůbec EXISTUJE. Appka bez
 * úlohy nemá jak zezelenat ani zčervenat — v pipeline prostě není.
 *
 * ⭐ ZDROJ PRAVDY JE MANIFEST, NE TAHLE BRÁNA
 * ------------------------------------------
 * `coolify/manifests/aisha.manifest` deklaruje `app: <jméno>:<vrstva>:<compose>`
 * pro všech 28 stacků a čte ho ČTRNÁCT skriptů — cold-start, doctor, redeploy,
 * sync-envs, drift-check, verify-topology. Jméno appky ze jména compose souboru
 * NEPLYNE (`-prebuilt.yml` → `edge`, `-n8n.yml` → `orchestration`,
 * `-langfuse.yml` → `observability`, `-cosmos.yml` → `ledger`,
 * `-matrix.yml` → `messaging`, `-observability.yml` → `observability-stack`) —
 * a právě ta neznalost tu vadu držela.
 *
 * ⛔ První verze téhle brány si tu mapu psala do vlastní baseline. To byla
 * KOPIE existující pravdy: manifest ji obsahoval celou dobu, včetně řádku
 * `app: edge:frontend:docker-compose.coolify-prebuilt.yml`. Duplikát by navíc
 * mohl driftovat proti tomu, podle čeho se doopravdy nasazuje.
 *
 * ROHATKA: `bez_deploy_ulohy` je dluh, ne whitelist — brána padne i tehdy, když
 * v seznamu zůstane stack, který už cestu MÁ. Seznam smí jen smršťovat a zmizí
 * úplně, až bude deploy v CI řízený manifestem jako zbytek platformy.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import yaml from "js-yaml";
import { vyhodnotit, type Hodnota } from "./lib/ci-vyraz";

const ROOT = process.cwd();
const CI = join(ROOT, ".github/workflows/ci.yml");
const MANIFEST = join(ROOT, "coolify/manifests/aisha.manifest");
const BASELINE = join(__dirname, "stack-bez-deploy-ulohy.baseline.json");

interface Baseline {
  $comment: string;
  /** stavějící compose, které manifest (zatím) nezná — dluh, smí jen ubývat */
  mimo_manifest: string[];
  /** stacky, které dnes žádná CI úloha nenasazuje (dluh — smí jen ubývat) */
  bez_deploy_ulohy: string[];
}

const baseline: Baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const wf = yaml.load(readFileSync(CI, "utf8")) as {
  jobs: Record<string, { name?: string; if?: string; steps?: Array<{ run?: string; if?: string }> }>;
};

/**
 * `app: <jméno>:<vrstva>:<compose>[:tagy]` → Map<compose, jména[]>
 *
 * ⛔ NAMĚŘENO 2026-09-03: mapa byla Map<compose, jméno> a `set()` druhý zápis
 * PŘEPSAL. Jeden compose ale smí nést VÍC aplikací — manifest forku nesl dvě
 * aplikace nad jedním docker-compose.coolify-<fork>.yml
 * — a ta dříve zapsaná z `mapa.values()` prostě zmizela. Brána pak tvrdila, že dluh
 * mluví o stacku, „který manifest nezná", ačkoli manifest ho deklaruje o dva řádky
 * výš. Tichá ztráta v opačném směru je horší: stack bez deploy cesty by se skryl.
 */
function manifestMapa(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const radek of readFileSync(MANIFEST, "utf8").split("\n")) {
    const m = radek.match(/^app:\s*([a-z0-9_-]+):([a-z0-9_-]+):(\S+?\.yml)(?::(\S+))?\s*$/i);
    if (m) out.set(m[3], [...(out.get(m[3]) ?? []), m[1]]);
  }
  return out;
}

/** Všechna jména aplikací z manifestu — plochý pohled na mapu výš. */
function jmenaZManifestu(mapa: Map<string, string[]>): Set<string> {
  return new Set([...mapa.values()].flat());
}

/** Compose soubory v kořeni, které něco STAVÍ (mají `build:`). */
function stavejiciCompose(): string[] {
  return readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f))
    .filter((f) => /^\s+build:\s*$/m.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
}

/**
 * Stacky, které NĚJAKÁ deploy úloha opravdu nasazuje.
 *
 * ⛔ ÚZKO ZÁMĚRNĚ. První verze brala jakoukoli zmínku `${APP_PREFIX}-<jméno>`,
 * tedy i z `printf`/`echo`. Mutační test to odhalil: vrácení cíle na neexistující
 * `-n8n` prošlo ZELENĚ, protože o kus níž zůstala HLÁŠKA se správným jménem.
 * Brána měřila, co je v úloze NAPSÁNO, ne co úloha DĚLÁ — a text v logu nikdy
 * nic nenasadil. Uznává se jen volání, které appku vyhledá nebo nasadí.
 */
function nasazovaneStacky(): Set<string> {
  const out = new Set<string>();
  for (const [, job] of Object.entries(wf.jobs ?? {})) {
    if (!String(job.name ?? "").startsWith("Deploy: ")) continue;
    for (const step of job.steps ?? []) {
      const run = step.run ?? "";
      for (const m of run.matchAll(/deploy-and-verify\.sh\s+([a-z0-9-]+)/g)) out.add(m[1]);
      for (const m of run.matchAll(/coolify-resolve-uuid\.sh\s+"?\$\{APP_PREFIX\}-([a-z0-9-]+)"?/g)) {
        out.add(m[1]);
      }
      for (const v of volaniPodleVln(run)) for (const app of v.nasadi) out.add(app);
    }
  }
  return out;
}

/**
 * Pořadí vln z TÉHOŽ zdroje, ze kterého ho čte skript v CI i cold-start.
 * (Bez identity a pověření — `--print-waves` je vlastnost repa.)
 */
const PORADI_VLN: Array<{ vlna: number; app: string }> = execFileSync(
  process.execPath,
  [join(ROOT, "scripts/aisha-redeploy.mjs"), "--print-waves"],
  { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
)
  .trim()
  .split("\n")
  .map((r) => {
    const [vlna, app] = r.split("\t");
    return { vlna: Number(vlna), app };
  });

/**
 * Volání `nasad-podle-vln.sh` v kroku: které appky NASADÍ (rozsah vln minus
 * `--vynech`). ⭐ 2026-09-16: CI nasazuje po vlnách podle detektoru, takže
 * jedna úloha pokrývá každou appku svého rozsahu — ne jen vyjmenované.
 */
function volaniPodleVln(run: string): Array<{ od: number; do: number; vynech: string[]; nasadi: string[] }> {
  const out: Array<{ od: number; do: number; vynech: string[]; nasadi: string[] }> = [];
  const text = run.replace(/\\\n\s*/g, " ");
  for (const m of text.matchAll(/(?:bash|sh)\s+scripts\/ci\/nasad-podle-vln\.sh([^\n]*)/g)) {
    const argy = m[1];
    const vlny = /--vlny\s+(\d+)-(\d*)/.exec(argy);
    const od = vlny ? Number(vlny[1]) : 0;
    const d = vlny && vlny[2] ? Number(vlny[2]) : Number.MAX_SAFE_INTEGER;
    const vynech = (/--vynech\s+([a-z0-9,-]+)/.exec(argy)?.[1] ?? "").split(",").filter(Boolean);
    const nasadi = PORADI_VLN.filter((p) => p.vlna >= od && p.vlna <= d && !vynech.includes(p.app)).map((p) => p.app);
    out.push({ od, do: d, vynech, nasadi });
  }
  return out;
}

describe("stack bez deploy úlohy (brána)", () => {
  const mapa = manifestMapa();
  const composy = stavejiciCompose();
  const nasazovane = nasazovaneStacky();

  /**
   * KROK A JEHO ÚLOHA SE MUSÍ SHODNOUT NA TOM, CO JE SPOUŠTÍ.
   *
   * ⛔ NAMĚŘENO 2026-08-22 mutací. Smazání `|| contains(deploy_apps, ',shared-redis,')`
   * z podmínky úlohy `deploy-infra` nezčervenalo ANI JEDNU bránu — přestože by
   * `shared-redis` přestal být nasazován úplně. Krok uvnitř nespustitelné úlohy
   * je v CI vidět jako „skipped", tedy zeleně, a stack tiše zůstane na starém
   * artefaktu. Táž třída jako #184, jen o patro výš.
   *
   * Měří se KOHERENCE, ne přítomnost: ptá se jen kroků, které samy klíčují na
   * `deploy_apps`. Krok klíčovaný na příznak (`infra_integration`) tomuhle
   * tvrzení nepodléhá — o těch mluví brána `deploy-se-nesmi-preskocit`.
   */
  test("krok spouštěný appkou sedí v úloze, kterou TÁŽ appka spustí", () => {
    const rozpor: string[] = [];
    for (const [id, job] of Object.entries(wf.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        const podminka = String(step.if ?? "");
        for (const m of podminka.matchAll(/deploy_apps\s*,\s*['"],([a-z0-9-]+),['"]/g)) {
          const appka = m[1];
          // Svět, ve kterém je JEDINÝM důvodem právě tahle appka.
          const svet: Record<string, Hodnota> = {
            "github.event_name": "push",
            "github.ref": "refs/heads/main",
            "needs.detect.outputs.deploy_apps": `,${appka},`,
          };
          for (const d of String(job.if ?? "").matchAll(/needs\.detect\.outputs\.([A-Za-z0-9_]+)/g)) {
            if (d[1] !== "deploy_apps") svet[`needs.detect.outputs.${d[1]}`] = "false";
          }
          for (const j of Object.keys(wf.jobs ?? {})) svet[`needs.${j}.result`] = "success";
          if (!vyhodnotit(String(job.if ?? "true"), svet)) {
            rozpor.push(`${id}: krok nasazuje '${appka}', ale úloha se kvůli té appce NESPUSTÍ`);
          }
        }
      }
    }
    expect(
      rozpor,
      "krok je klíčovaný na appku, kterou jeho úloha nezná:\n  " +
        rozpor.join("\n  ") +
        "\n\nCO TO ZNAMENÁ: v CI se to jeví jako přeskočený krok — zeleně — a stack\n" +
        "zůstane na starém artefaktu. Doplň do podmínky ÚLOHY tutéž appku:\n" +
        "  || contains(needs.detect.outputs.deploy_apps, ',<appka>,')",
    ).toEqual([]);
  });

  test("úlohy po vlnách pokryjí VŠECHNY vlny beze mezery a bez překryvu", () => {
    const volani = Object.values(wf.jobs ?? {})
      .filter((j) => String(j.name ?? "").startsWith("Deploy: "))
      .flatMap((j) => (j.steps ?? []).flatMap((st) => volaniPodleVln(st.run ?? "")))
      .sort((a, b) => a.od - b.od);
    expect(volani.length, "žádná úloha nevolá nasad-podle-vln.sh — CI nenasazuje po vlnách").toBeGreaterThan(0);
    expect(volani[0].od, "první rozsah musí začínat vlnou 0").toBe(0);
    for (let i = 1; i < volani.length; i++) {
      expect(volani[i].od, `rozsahy vln se rozcházejí: ${volani[i - 1].od}-${volani[i - 1].do} → ${volani[i].od}-`).toBe(volani[i - 1].do + 1);
    }
    const posledni = Math.max(...PORADI_VLN.map((p) => p.vlna));
    expect(volani[volani.length - 1].do, `poslední rozsah nedosáhne na vlnu ${posledni}`).toBeGreaterThanOrEqual(posledni);
  });

  test("`--vynech` = přesně appky, které nasazuje VLASTNÍ úloha (nic navíc, nic chybí)", () => {
    const vlastni = new Set<string>();
    for (const [, job] of Object.entries(wf.jobs ?? {})) {
      if (!String(job.name ?? "").startsWith("Deploy: ")) continue;
      for (const step of job.steps ?? []) {
        for (const m of (step.run ?? "").matchAll(/deploy-and-verify\.sh\s+([a-z0-9-]+)/g)) vlastni.add(m[1]);
      }
    }
    const volani = Object.values(wf.jobs ?? {}).flatMap((j) => (j.steps ?? []).flatMap((st) => volaniPodleVln(st.run ?? "")));
    for (const v of volani) {
      const vRozsahu = [...vlastni].filter((app) => PORADI_VLN.some((p) => p.app === app && p.vlna >= v.od && p.vlna <= v.do));
      expect(
        [...v.vynech].sort(),
        `rozsah ${v.od}-: vynechané appky musí odpovídat vlastním úlohám v tom rozsahu — ` +
          "vynechaná appka bez vlastní úlohy se nenasadí vůbec, nevynechaná s vlastní úlohou dvakrát",
      ).toEqual(vRozsahu.sort());
    }
  });

  test("univerzum není prázdné — jinak je všechno níž vakuové", () => {
    expect(mapa.size, "manifest nevydal ANI JEDEN `app:` řádek — parser přestal sedět na jeho tvar")
      .toBeGreaterThan(0);
    expect(composy.length, "nenašel se ANI JEDEN stavějící docker-compose.coolify*.yml")
      .toBeGreaterThan(0);
    expect(nasazovane.size, "v ci.yml nebyla nalezena ANI JEDNA nasazovaná appka").toBeGreaterThan(0);
  });

  test("každý stavějící compose je v manifestu (nebo je přiznaný jako dluh)", () => {
    const nedeklarovane = composy.filter((c) => !mapa.has(c) && !baseline.mimo_manifest.includes(c));
    expect(
      nedeklarovane,
      `tyhle compose soubory něco staví, ale manifest o nich neví.\n` +
        `Manifest čte 14 skriptů (cold-start, doctor, redeploy, sync-envs, drift-check…),\n` +
        `takže stack mimo něj je neviditelný pro CELOU platformu, nejen pro CI —\n` +
        `a v ` + "`aisha-redeploy.mjs`" + ` je navíc „wave orphan": cold-start ho nezvedne\n` +
        `a ani --only=<app> na něj nedosáhne.\n` +
        `Doplň 'app: <jméno>:<vrstva>:<compose>' do coolify/manifests/aisha.manifest A vlnu\n` +
        `do WAVES — obojí, jinak appka jen vypadá zavedeně.`
    ).toEqual([]);
  });

  test("dluh mimo-manifest smí jen ubývat", () => {
    const splaceno = baseline.mimo_manifest.filter((c) => mapa.has(c));
    expect(
      splaceno,
      "tyhle compose jsou vedené jako neznámé manifestu, ale manifest je UŽ ZNÁ — vyškrtni je"
    ).toEqual([]);
    const neexistujici = baseline.mimo_manifest.filter((c) => !composy.includes(c));
    expect(
      neexistujici,
      "dluh mluví o compose souborech, které v repu nejsou nebo nic nestaví — seznam zestárl"
    ).toEqual([]);
  });

  test("stavějící stack má cestu, kterou ho CI nasadí (nebo je přiznaný jako dluh)", () => {
    const siroty: string[] = [];
    for (const compose of composy) {
      const jmena = mapa.get(compose);
      if (!jmena?.length) continue; // hlásí test výš
      for (const jmeno of jmena) {
        if (nasazovane.has(jmeno)) continue;
        if (baseline.bez_deploy_ulohy.includes(jmeno)) continue;
        siroty.push(`${compose} → <prefix>-${jmeno}`);
      }
    }
    expect(
      siroty,
      `tyhle stacky se z repa STAVÍ, ale ŽÁDNÁ deploy úloha je nenasazuje.\n` +
        `Přesně tak byl 2026-08-09 web dva dny starý: appka existovala, běžela, byla zdravá —\n` +
        `jen do ní nikdy nedotekl merge. Buď přidej deploy cestu, nebo (nasazuje-li se ručně)\n` +
        `přiznej jméno v ${BASELINE} → bez_deploy_ulohy.`
    ).toEqual([]);
  });

  test("deploy úloha nesmí mířit na stack, který manifest nezná", () => {
    const znama = jmenaZManifestu(mapa);
    const duchove = [...nasazovane].filter((s) => !znama.has(s)).sort();
    expect(
      duchove,
      `tyhle cíle CI nasazuje, ale manifest je nezná — appka <prefix>-<cíl> neexistuje.\n` +
        `Resolver vrátí ::notfound::, krok napíše warning a skončí ZELENĚ, aniž co nasadil.\n` +
        `Naměřeno 2026-08-09: ci.yml mířilo na '-n8n' a '-langfuse', zatímco manifest deklaruje\n` +
        `'orchestration' a 'observability'. Jméno ber z manifestu, neodhaduj ze jména souboru.`
    ).toEqual([]);
  });

  test("dluh smí jen ubývat — přiznaný stack, který už cestu MÁ, musí ze seznamu pryč", () => {
    const splaceno = baseline.bez_deploy_ulohy.filter((s) => nasazovane.has(s));
    expect(
      splaceno,
      "tyhle stacky jsou vedené jako ručně nasazované, ale deploy úloha pro ně UŽ EXISTUJE — " +
        "vyškrtni je, ať je seznam poctivý dluh a ne whitelist"
    ).toEqual([]);
  });

  test("dluh nesmí obsahovat stack, který manifest nezná", () => {
    const znama = jmenaZManifestu(mapa);
    const neznamy = baseline.bez_deploy_ulohy.filter((s) => !znama.has(s));
    expect(
      neznamy,
      "dluh mluví o stacích, které manifest nedeklaruje — seznam zestárl proti manifestu"
    ).toEqual([]);
  });

  test("web SPA (edge) se nasazuje z CI — regrese, kvůli které brána vznikla", () => {
    expect(
      mapa.get("docker-compose.coolify-prebuilt.yml"),
      "manifest musí říkat, že prebuilt compose patří appce `edge`"
    ).toContain("edge");
    expect(
      nasazovane.has("edge"),
      "žádná úloha nenasazuje <prefix>-edge — a to je ta appka, která staví bundle, jaký vidí uživatel"
    ).toBe(true);
    expect(
      baseline.bez_deploy_ulohy,
      "edge nesmí být mezi ručně nasazovanými — na tom stojí celá tahle brána"
    ).not.toContain("edge");
  });
  // ⛔ NAMĚŘENO 2026-09-27: 16 appek z WAVES (mezi nimi local-ingest a domain-services)
  // nemělo v deploy.yml volbu. Po merge, který je nenasadil (posun submodulu šel do
  // `jen_kontrakt`), je nešlo dohnat přes CI — jen ručně v Coolify. Ruční dispatch je
  // druhá CI cesta a musí znát KAŽDOU appku z téhož zdroje, ze kterého nasazují vlny.
  test("ruční dispatch (deploy.yml) zná každou appku z WAVES a umí z ní složit jméno", () => {
    const dispatch = yaml.load(readFileSync(join(ROOT, ".github/workflows/deploy.yml"), "utf8")) as {
      on?: { workflow_dispatch?: { inputs?: { stack?: { options?: string[] } } } };
      true?: { workflow_dispatch?: { inputs?: { stack?: { options?: string[] } } } };
      jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
    };
    // js-yaml čte klíč `on` jako boolean true (YAML 1.1).
    const spoustec = dispatch.on ?? dispatch.true;
    const volby = new Set(spoustec?.workflow_dispatch?.inputs?.stack?.options ?? []);
    expect(volby.size, "deploy.yml nemá výčet stacků — měřidlo neměří nic").toBeGreaterThan(10);
    const chybi = [...new Set(PORADI_VLN.map((v) => v.app))].filter((a) => !volby.has(a)).sort();
    expect(chybi, "appka z WAVES bez ruční CI cesty (doplň do deploy.yml options)").toEqual([]);
    // Volba bez mapování na jméno appky by dispatch shodila až za běhu.
    const run = Object.values(dispatch.jobs ?? {}).flatMap((j) => j.steps ?? []).map((st) => st.run ?? "").join("\n");
    const mapa = /map_app_name\(\) \{[\s\S]*?\n\s*\}\n/.exec(run)?.[0] ?? "";
    expect(mapa, "deploy.yml bez map_app_name").not.toBe("");
    const obecna = /\*\)\s+if \[\[ "\$1" =~/.test(mapa);
    const bezMapy = [...volby].filter((v) => v !== "all" && !obecna && !new RegExp(`^\\s+${v}\\)`, "m").test(mapa));
    expect(bezMapy, "volba deploy.yml bez mapování na jméno appky").toEqual([]);
  });
});
