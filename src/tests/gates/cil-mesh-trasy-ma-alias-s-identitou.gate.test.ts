/**
 * Brána: cíl mesh trasy musí mít SÍŤOVÝ ALIAS s identitou instance.
 *
 * ⛔ TŘÍDA VADY (naměřeno 2026-08-21 na produkci). Derivace skládá cíl trasy
 * mesh-ingressu jako `<prefix>-<služba>` a bere ho z `container_name` v compose
 * (`containerNameFrom`). Jenže **Coolify `container_name` PŘEPISUJE** na
 * `<služba>-<uuid>-<n>`. Cíl trasy tedy ukazuje na jméno, které na síti
 * NEEXISTUJE — a projeví se to až za běhu:
 *
 *     extranet-auth → <prefix>-extra.mesh.<tld>:8080   → 502 Bad Gateway
 *     tentýž ingress /__mesh_health               → "ok"     ← mesh JE průchozí
 *
 * Nosný je **alias**: ten Coolify nechává být. Rozdíl mezi „mesh nefunguje" a
 * „poslední skok nemá kam" je z veřejné strany k nerozeznání (obojí 502), takže
 * se to hledá ve špatné vrstvě. Poprvé to bylo vidět na extranetu, ale měření
 * ukázalo **11 dalších cílů** ve stejném stavu — třída, ne jednotlivost.
 *
 * CO SE MĚŘÍ (vlastnost, ne výčet): pro KAŽDOU compose službu, na kterou
 * katalog ukazuje jako na cíl (`internal_url.service`, `public_face.service`,
 * `internal_endpoints[].service`), musí existovat síťový alias obsahující
 * `${APP_NAME_PREFIX}`. Univerzum se HLEDÁ v katalogu — ruční seznam by zdědil
 * díry svého autora.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parse } from "yaml";

import { klicePodminky } from "../../../scripts/lib/provision-gate.mjs";

const ROOT = resolve(__dirname, "../../..");

type Sluzba = { networks?: unknown; network_mode?: string };

type KatalogSluzba = {
  compose?: unknown;
  provision_when_env?: unknown;
  public_when_env?: unknown;
  internal_url?: { service?: string };
  internal_endpoints?: unknown[];
  internal_tcp_endpoints?: unknown[];
};

/** Peer (= stack) z jména compose — týž klíč, pod jakým derivace vydává `<PEER>_MESH_*_ROUTES`. */
const peerZCompose = (compose: string): string | null => {
  const m = /^docker-compose\.coolify(?:-(.+))?\.yml$/.exec(compose);
  return m ? (m[1] ?? "core").toUpperCase().replace(/-/g, "_") : null;
};

/** Prostředí derivace s profilem běhu, ve kterém model stojí na slotu s has_gpu (overlay). */
function sModelemNaGpu(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const id = (env.AISHA_PROFILE ?? "").trim();
  if (!id) throw new Error("profil běhu nedeklarovaný (AISHA_PROFILE) — tvar s modelem na GPU nemá z čeho vzniknout");
  const vlastni = env.AISHA_INSTANCE_CONFIG_DIR ? join(env.AISHA_INSTANCE_CONFIG_DIR, "profiles", `${id}.json`) : "";
  const zdroj = vlastni && existsSync(vlastni) ? vlastni : join(ROOT, "config/profiles", `${id}.json`);
  const profil = JSON.parse(readFileSync(zdroj, "utf8"));
  const sloty = JSON.parse(readFileSync(join(ROOT, "coolify/servers.json"), "utf8")).servers ?? {};
  const gpu = Object.entries(sloty).find(([, d]) => (d as { has_gpu?: boolean })?.has_gpu === true)?.[0];
  if (!gpu) throw new Error("registr slotů nemá slot s has_gpu — tvar s modelovým meshem nejde složit");
  const dir = mkdtempSync(join(tmpdir(), "vesmir-model-gpu-"));
  mkdirSync(join(dir, "profiles"));
  const novy = `${id}-model-na-gpu`;
  const prepisy = { ...(profil.service_overrides ?? {}), model: { ...(profil.service_overrides?.model ?? {}), placement: gpu } };
  // Model na GPU slotu chce deklaraci vstupu lane nájemce (LANE_VSTUP_URL) — testovací hodnota.
  const lane = profil.lane_gpu ?? { vlastnik: "testuzel", vstup_url: "http://10.251.9.2:8000" };
  writeFileSync(join(dir, "profiles", `${novy}.json`), JSON.stringify({ ...profil, id: novy, service_overrides: prepisy, lane_gpu: lane }));
  return { ...env, AISHA_INSTANCE_CONFIG_DIR: dir, AISHA_PROFILE: novy };
}

/**
 * Trasy, které derivace vydá — nad CELÝM katalogem, ne nad výchozím profilem.
 *
 * ⛔ UNIVERZUM MINULO OPT-IN SLUŽBY (naměřeno živě 2026-10-02 na instanci). Derivace
 * se tu volala s holým prostředím, takže služby s `provision_when_env` (model,
 * potok, local-ingest, extranet, source-broker) do topologie vůbec nevstoupily
 * a jejich cíle brána nikdy neviděla. Mezitím alias `<prefix>-svc-model` nesli
 * na sdílené síti instance ČTYŘI držitelé — svc-model, agent modelu (hostitel
 * netns ingressu) a agenti stacků exec a shared-redis. Uvnitř ingressu modelu
 * se jméno překládalo na tři adresy; přímý dotaz vracel náhodně 200 nebo 421
 * od cizího ingressu a trasa „fungovala“ jen díky tomu, že dialer zkusí další
 * adresu a ingress, který trefí sám sebe, požadavek zatočí ještě jednou.
 *
 * Proto se zapnou VŠECHNY přepínače, které katalog deklaruje (`provision_when_env`,
 * `public_when_env`) — odvozeně, ne seznamem, aby nová opt-in služba nevypadla.
 *
 * Identita se volí smyšlená: kdyby se prefix někde nedosadil, ukáže se to jako
 * neshoda, ne jako trefa na jméno živé instance.
 */
function odvozeneTrasy(identita = "zkouska"): { cile: Set<string>; peery: Set<string>; optInPeery: Set<string> } {
  const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf8"));
  const sluzby = Object.values(katalog.services ?? {}) as KatalogSluzba[];
  const env: NodeJS.ProcessEnv = { ...process.env, MESH_ENABLED: "true", APP_NAME_PREFIX: identita };
  for (const k of ["PUBLIC_TLD", "INTERNAL_TLD", "MESH_TLD"]) env[k] = env[k] || `${k.toLowerCase()}.test`;
  const optInPeery = new Set<string>();
  for (const s of sluzby) {
    const prepinace = [...klicePodminky(s?.provision_when_env), ...klicePodminky(s?.public_when_env)];
    for (const k of prepinace) env[k] = "zkouska-zapnuto";
    const maMeshTvar = Boolean(s?.internal_url?.service) || (s?.internal_endpoints?.length ?? 0) > 0 ||
      (s?.internal_tcp_endpoints?.length ?? 0) > 0;
    const peer = typeof s?.compose === "string" ? peerZCompose(s.compose) : null;
    if (prepinace.length && maMeshTvar && peer) optInPeery.add(peer);
  }
  const derivuj = (e: NodeJS.ProcessEnv) => execFileSync(process.execPath, [join(ROOT, "scripts/lib/derive-domains.mjs"), "--shell"], {
    cwd: ROOT, env: e, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024,
  });
  // ⭐ DRUHÝ TVAR INSTANCE (modelový mesh forku, varianta C, 2026-10-05). Lane MODEL_MESH
  // NEJDE otevřít prostředím — otevírá ji UMÍSTĚNÍ modelu na slotu s has_gpu (derivace
  // prostředí záměrně nepřebije). Bez tohoto tvaru by most (`model-most`) a jeho trasy
  // v univerzu chyběly a brána by je neměřila. Měří se proto sjednocení: profil běhu
  // a týž profil s modelem na GPU slotu (slot z registru, ne literál).
  const gpuEnv = sModelemNaGpu(env);
  let out: string;
  try {
    out = [derivuj(env), derivuj(gpuEnv)].join("\n");
  } finally {
    rmSync(String(gpuEnv.AISHA_INSTANCE_CONFIG_DIR), { recursive: true, force: true });
  }

  // ⛔ UNIVERZUM MINULO PŮLKU SVĚTA (naměřeno při wipu 2026-08-24). Smyčka brala
  // jen `_MESH_INGRESS_ROUTES`, tedy HTTP trasy — a `_MESH_TCP_ROUTES` neviděla
  // vůbec. Přitom právě tam patří clamav a shared-redis: trasa
  // `3310|<prefix>-clamav:3310` mířila na jméno, které compose nepřidělovala,
  // sidecar `clamav-mesh-tcp` padal v restart smyčce — a 7038 bran mlčelo.
  //
  // Tvary se liší a musí se číst každý po svém:
  //   INGRESS: `port|jmena|cil:port`  → cíl je 3. pole
  //   TCP:     `port|cil:port`        → cíl je 2. pole
  const cile = new Set<string>();
  const peery = new Set<string>();
  for (const radek of out.split("\n")) {
    const ingress = /^([A-Z0-9_]+)_MESH_INGRESS_ROUTES='?(.*?)'?$/.exec(radek);
    const tcp = /^([A-Z0-9_]+)_MESH_TCP_ROUTES='?(.*?)'?$/.exec(radek);
    const m = ingress ?? tcp;
    if (!m) continue;
    peery.add(m[1]);
    const poleCile = ingress ? 2 : 1;
    for (const trasa of m[2].split(";")) {
      const cil = trasa.split("|")[poleCile];
      if (cil) cile.add(cil.split(":")[0]);
    }
  }
  return { cile, peery, optInPeery };
}

/** Cíle tras podle katalogu: {compose, službaKlíč, kdo}. */
function cileTras(): Array<{ compose: string; sluzba: string; id: string }> {
  const katalog = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf8"));
  const out: Array<{ compose: string; sluzba: string; id: string }> = [];
  type KatSluzba = {
    compose?: unknown;
    internal_url?: { service?: string };
    public_face?: { service?: string };
    internal_endpoints?: Array<{ service?: string }>;
  };
  for (const [id, s] of Object.entries(katalog.services ?? {}) as Array<[string, KatSluzba]>) {
    const compose = typeof s.compose === "string" ? s.compose : "";
    if (!compose || !existsSync(join(ROOT, compose))) continue;
    const cile = new Set<string>();
    if (s.internal_url?.service) cile.add(s.internal_url.service);
    if (s.public_face?.service) cile.add(s.public_face.service);
    for (const ep of s.internal_endpoints ?? []) if (ep?.service) cile.add(ep.service);
    for (const sluzba of cile) out.push({ compose, sluzba, id });
  }
  return out;
}

/** Má služba alias nesoucí identitu instance? Ptá se PARSERU, ne textu. */
function maAliasSIdentitou(compose: string, sluzba: string): boolean | null {
  const doc = parse(readFileSync(join(ROOT, compose), "utf8")) as { services?: Record<string, Sluzba> };
  const spec = doc?.services?.[sluzba];
  if (!spec) return null; // služba v compose není — hlásí se zvlášť
  // Služba v netns jiné služby vlastní síť nemá; adresu jí dává hostitel netns.
  if (spec.network_mode) return true;
  const nets = spec.networks;
  if (!nets || Array.isArray(nets)) return false; // seznamový tvar aliasy neumí
  for (const v of Object.values(nets as Record<string, { aliases?: unknown[] } | null>)) {
    const aliasy = (v && Array.isArray(v.aliases) ? v.aliases : []) as unknown[];
    if (aliasy.some((a) => String(a).includes("APP_NAME_PREFIX"))) return true;
  }
  return false;
}

describe("cíl mesh trasy má alias s identitou instance", () => {
  const cile = cileTras();

  test("univerzum není prázdné — jinak brána neměří nic", () => {
    // Sonda musí umět říct „ne": kdyby katalog přestal cíle deklarovat
    // (nebo se přejmenovalo pole), seznam osiří a brána tiše zezelená nad nulou.
    expect(cile.length, "katalog nedeklaruje ŽÁDNÝ cíl trasy — měřidlo osiřelo").toBeGreaterThan(20);
  });

  test("univerzum derivace obsahuje KAŽDÝ opt-in stack s mesh tváří", () => {
    // Hlídá samo měřidlo: testy níž porovnávají cíle, které derivace vydá.
    // Vypadne-li z ní opt-in stack, jeho cíle nikdo nezměří — přesně tak
    // zůstala nevidět kolize `<prefix>-svc-model` (2026-10-02).
    const { peery, optInPeery } = odvozeneTrasy();
    expect(optInPeery.size, "katalog nedeklaruje žádnou opt-in službu s mesh tváří — sonda osiřela").toBeGreaterThan(0);
    const chybi = [...optInPeery].filter((p) => !peery.has(p)).sort();
    expect(
      chybi,
      "Tyhle opt-in stacky v univerzu derivace chybí — jejich trasy brána neměří:\n  " + chybi.join("\n  "),
    ).toEqual([]);
  });

  test("dva forky na jednom hostiteli (sdílený GPU stroj): cíle tras se NEPROTÍNAJÍ, včetně opt-in modelu", () => {
    // Na GPU stroji poběží stacky víc forků vedle sebe (kontrakt d8 U7, 0c d).
    // Cíl trasy, který dva forky sdílí, je přesně 36821f71b o úroveň výš:
    // ingress forku A by trefil kontejner forku B. Derivace se proto pouští
    // pro DVĚ identity se všemi přepínači opt-in (model včetně) a průnik musí být prázdný.
    const a = odvozeneTrasy("forka");
    const b = odvozeneTrasy("forkb");
    expect(a.peery.has("MODEL"), "univerzum nemá stack modelu — dva forky s modelem na gpu brána neměří").toBe(true);
    expect(a.cile.size, "derivace nevydala žádný cíl").toBeGreaterThan(10);
    const prunik = [...a.cile].filter((c) => b.cile.has(c)).sort();
    expect(prunik, "Tyhle cíle tras by dva forky na jednom hostiteli sdílely:\n  " + prunik.join("\n  ")).toEqual([]);
    // Kotva: táž identita dvakrát = úplná shoda. Bez ní „prázdný průnik“ nedokazuje nic.
    const a2 = odvozeneTrasy("forka");
    expect([...a2.cile].filter((c) => a.cile.has(c)).length).toBe(a.cile.size);
  });

  test("každý cíl trasy v compose existuje", () => {
    const chybi = cile
      .filter(({ compose, sluzba }) => maAliasSIdentitou(compose, sluzba) === null)
      .map(({ id, sluzba, compose }) => `${id} → ${sluzba} (v ${compose} taková služba není)`);
    expect(
      chybi,
      "Katalog ukazuje na compose službu, která neexistuje — trasa by se nesložila:\n  " +
        chybi.join("\n  "),
    ).toEqual([]);
  });

  test("cíl KAŽDÉ vydané trasy má PŘESNĚ odpovídající alias", () => {
    // ⛔ SLABÉ MĚŘIDLO (opraveno hned tentýž den). První verze téhle brány
    // tvrdila jen „služba má NĚJAKÝ alias s identitou". To je málo: cíl trasy
    // je konkrétní řetězec a musí se na alias TREFIT. Měření nad skutečným
    // výstupem derivace našlo 8 tras mířících na `container_name` ve tvaru
    // `<prefix>-<placement>--<stack>--<služba>` — a ten Coolify přepisuje.
    // Brána, která se ptá „máš alias?", takovou trasu propustí.
    //
    // Tady se porovnávají MNOŽINY: cíle, které derivace vydá, proti aliasům,
    // které compose vyrobí — obojí s dosazenou identitou.
    const { cile } = odvozeneTrasy();
    expect(cile.size, "derivace nevydala ŽÁDNOU trasu — měřidlo osiřelo").toBeGreaterThan(10);

    const aliasy = new Set<string>();
    for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
      let doc: { services?: Record<string, Sluzba> };
      try { doc = parse(readFileSync(join(ROOT, f), "utf-8")); } catch { continue; }
      for (const spec of Object.values(doc?.services ?? {})) {
        const nets = spec?.networks;
        if (!nets || Array.isArray(nets)) continue;
        for (const v of Object.values(nets as Record<string, { aliases?: unknown[] } | null>)) {
          for (const a of (v && Array.isArray(v.aliases) ? v.aliases : [])) {
            aliasy.add(String(a).replace(/\$\{APP_NAME_PREFIX[^}]*\}/g, "zkouska"));
          }
        }
      }
    }

    const bezAliasu = [...cile].filter((c) => !aliasy.has(c)).sort();
    expect(
      bezAliasu,
      [
        "Tyhle cíle mesh tras nemají v compose odpovídající síťový alias:",
        ...bezAliasu.map((r) => `  - ${r}`),
        "",
        "Trasa míří na jméno, které na síti NEEXISTUJE: mesh-ingress vrátí 502,",
        "ale jeho `/__mesh_health` odpoví `ok` — mesh je průchozí, chybí poslední",
        "skok. Zvenku k nerozeznání od rozbité mesh.",
        "",
        "CO S TÍM: doplň službě alias PŘESNĚ toho tvaru, jaký cíl nese:",
        "    networks:",
        "      <síť>:",
        "        aliases:",
        "          - ${APP_NAME_PREFIX:?identita instance}-<jméno z cíle>",
        "",
        "NEDĚLEJ: nespoléhej na `container_name` — Coolify ho přepisuje na",
        "  `<služba>-<uuid>-<n>`, takže cíl složený z něj nikdy nevznikne.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("alias cíle drží služba, která POSLOUCHÁ — ne jednorázová", () => {
    // ⛔ TEST VÝŠ POROVNÁVÁ MNOŽINY, a to je málo. Ptá se „existuje to jméno
    // mezi aliasy?", ne „patří tomu, kdo na tom portu poslouchá?". Alias může
    // sedět na JINÉ službě téhož stacku — a když je ta služba jednorázová,
    // trasa míří na kontejner, který po doběhnutí SKONČÍ.
    //
    // ⛔ NAMĚŘENO 2026-08-25 na živém nasazení: `<prefix>-n8n--auth` držel
    // `n8n-workflow-init` (jednorázový), zatímco oauth2-proxy `n8n-auth` měl
    // alias o jednu pomlčku jinde. Trasa se tedy PŘELOŽILA — na mrtvý
    // kontejner — a spojení vypršelo:
    //     dial tcp 203.0.113.24:4180: i/o timeout   → 502 na mcp.<public>
    // Ta IP je VEŘEJNÁ tvář hostitele: vnitřní jméno se nepřeložilo v Dockeru,
    // propadlo na wildcard a odešlo ven. Vnitřní jména tu neselhávají — proto
    // se rozdíl „mrtvý cíl" × „živý cíl" nedá poznat z návratového kódu.
    //
    // Množinová brána tohle propustila, protože jméno EXISTOVALO. Tady se
    // proto měří VLASTNICTVÍ.
    const jednorazova = (jmeno: string, spec: Sluzba | undefined): boolean => {
      const restart = String((spec as { restart?: unknown } | undefined)?.restart ?? "").trim();
      return restart === "no" || /-init$/.test(jmeno);
    };

    const { cile } = odvozeneTrasy();
    expect(cile.size, "derivace nevydala ŽÁDNOU trasu — měřidlo osiřelo").toBeGreaterThan(10);

    // alias → seznam držitelů (soubor, služba, jednorázová?)
    const drzitele = new Map<string, { sluzba: string; soubor: string; jednou: boolean }[]>();
    for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
      let doc: { services?: Record<string, Sluzba> };
      try { doc = parse(readFileSync(join(ROOT, f), "utf-8")); } catch { continue; }
      for (const [jmeno, spec] of Object.entries(doc?.services ?? {})) {
        const nets = spec?.networks;
        if (!nets || Array.isArray(nets)) continue;
        for (const v of Object.values(nets as Record<string, { aliases?: unknown[] } | null>)) {
          for (const a of (v && Array.isArray(v.aliases) ? v.aliases : [])) {
            const alias = String(a).replace(/\$\{APP_NAME_PREFIX[^}]*\}/g, "zkouska");
            const seznam = drzitele.get(alias) ?? [];
            seznam.push({ sluzba: jmeno, soubor: f, jednou: jednorazova(jmeno, spec) });
            drzitele.set(alias, seznam);
          }
        }
      }
    }

    // Cíl je vadný, když ho drží VÝHRADNĚ jednorázové služby.
    const mrtveCile = [...cile]
      .map((c) => ({ cil: c, maj: drzitele.get(c) ?? [] }))
      .filter(({ maj }) => maj.length > 0 && maj.every((m) => m.jednou))
      .map(({ cil, maj }) => `${cil} → ${maj.map((m) => `${m.sluzba} (${m.soubor})`).join(", ")}`)
      .sort();

    expect(
      mrtveCile,
      [
        "Tyhle cíle mesh tras drží JEN jednorázové služby:",
        ...mrtveCile.map((r) => `  - ${r}`),
        "",
        "Jednorázová služba po doběhnutí skončí, takže jméno sice existuje, ale",
        "na portu nikdo neposlouchá. Spojení nevrátí poctivou chybu — vyprší,",
        "a vnitřní jméno se cestou propadne na wildcard, tedy na VEŘEJNOU IP.",
        "",
        "CO S TÍM: přesuň alias na službu, která na tom portu opravdu poslouchá.",
        "Jednorázové službě nech alias jejího vlastního jména, nebo žádný.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("alias cíle drží PRÁVĚ JEDNA služba — a není to hostitel netns ingressu", () => {
    // ⛔ NAMĚŘENO 2026-09-30 na produkci forku (kolo 15). Gateway dostal
    // STORAGE_AUTH_URL = <prefix>-storage-auth.mesh.<tld>:3005 a nahrání fotky
    // z předání viselo do timeoutu, přitom `/__mesh_health` téhož ingressu
    // odpověděl `ok`. Alias `<prefix>-storage-auth` nesla DVĚ služby: storage-auth
    // a netbird-agent, v jehož netns běží mesh-ingress. Docker DNS v netns agenta
    // vrátil agenta samotného, takže `reverse_proxy http://<prefix>-storage-auth`
    // mířil zpátky na týž Caddy — i s Host hlavičkou trasy, tedy znovu na tutéž
    // trasu, dokola. Tentýž commit (07da0ca43) dal alias `<prefix>-imgproxy`
    // i službě web: trasa na imgproxy:8080 se překládala na nginx :80.
    //
    // Testy výš se ptají „existuje jméno?" a „nedrží ho jen jednorázová?".
    // Obojí prošlo — jméno existovalo a oba držitelé běží. Měří se proto
    // JEDNOZNAČNOST: dva držitelé = Docker DNS vybírá, trasa funguje náhodou.
    // A hostitel netns (`network_mode: service:<x>`) alias cíle nést nesmí,
    // když v jeho netns běží něco, co to jméno PŘEKLÁDÁ: mesh ingress (rozvádí
    // trasy podle jmen — incident výš) nebo služba, jejíž konfigurace alias
    // zmiňuje. Ti by jméno přeložili sami na sebe.
    //
    // ⭐ ZPŘESNĚNO 2026-10-05 (most modelového meshe, varianta C). Most je první
    // cíl, který v netns hostitele bydlet MUSÍ: most-proxy předává do modelového
    // meshe, jehož rozhraní wt0 existuje jen v netns agenta modelového meshe.
    // V té netns neběží ingress a most-proxy míří na IP uzlu, ne na jméno —
    // nikdo tam alias nepřekládá, smyčka nevznikne. Incident z 09-30 (ingress
    // v netns agenta, který nese alias cíle) brána chytá dál: mutace „ingress
    // v netns agenta mostu“ a „proxy mostu míří na vlastní alias“ ji shodí.
    const { cile } = odvozeneTrasy();
    expect(cile.size, "derivace nevydala ŽÁDNOU trasu — měřidlo osiřelo").toBeGreaterThan(10);

    // alias → držitelé (služba se počítá jednou, i když alias nese na více sítích)
    const drzitele = new Map<string, { sluzba: string; soubor: string; hostiNetns: boolean }[]>();
    for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
      let doc: { services?: Record<string, Sluzba> };
      try { doc = parse(readFileSync(join(ROOT, f), "utf-8")); } catch { continue; }
      const sluzby = doc?.services ?? {};
      // hostitel netns → obyvatelé (služby s `network_mode: service:<hostitel>`)
      const obyvatele = new Map<string, Array<[string, Sluzba]>>();
      for (const [jmeno, spec] of Object.entries(sluzby)) {
        const h = /^service:(.+)$/.exec(String(spec?.network_mode ?? ""))?.[1];
        if (h) obyvatele.set(h, [...(obyvatele.get(h) ?? []), [jmeno, spec]]);
      }
      // Překládá v netns někdo daný alias? Ingress rozvádí podle jmen vždy; jiný obyvatel,
      // když jeho konfigurace alias (v podobě z compose) zmiňuje.
      const prekladaVNetns = (hostitel: string, aliasSurovy: string): boolean =>
        (obyvatele.get(hostitel) ?? []).some(([jmeno, spec]) =>
          /-mesh-ingress$/.test(jmeno) || /_MESH_(INGRESS|TCP)_ROUTES/.test(JSON.stringify(spec ?? {})) ||
          JSON.stringify(spec ?? {}).includes(aliasSurovy));
      for (const [jmeno, spec] of Object.entries(sluzby)) {
        const nets = spec?.networks;
        if (!nets || Array.isArray(nets)) continue;
        const moje = new Map<string, string>(); // alias s dosazenou identitou → alias, jak stojí v compose
        for (const v of Object.values(nets as Record<string, { aliases?: unknown[] } | null>)) {
          for (const a of (v && Array.isArray(v.aliases) ? v.aliases : [])) {
            moje.set(String(a).replace(/\$\{APP_NAME_PREFIX[^}]*\}/g, "zkouska"), String(a));
          }
        }
        for (const [alias, surovy] of moje) {
          const seznam = drzitele.get(alias) ?? [];
          seznam.push({ sluzba: jmeno, soubor: f, hostiNetns: obyvatele.has(jmeno) && prekladaVNetns(jmeno, surovy.replace(/\$\{APP_NAME_PREFIX[^}]*\}/g, "")) });
          drzitele.set(alias, seznam);
        }
      }
    }

    const nejednoznacne = [...cile]
      .map((c) => ({ cil: c, maj: drzitele.get(c) ?? [] }))
      .filter(({ maj }) => maj.length > 1 || maj.some((m) => m.hostiNetns))
      .map(({ cil, maj }) =>
        `${cil} → ${maj.map((m) => `${m.sluzba}${m.hostiNetns ? " [hostitel netns]" : ""} (${m.soubor})`).join(", ")}`)
      .sort();

    expect(
      nejednoznacne,
      [
        "Tyhle cíle mesh tras nemají JEDNOZNAČNÉHO držitele aliasu:",
        ...nejednoznacne.map((r) => `  - ${r}`),
        "",
        "Víc držitelů = Docker DNS vybírá mezi nimi a trasa trefí správnou službu",
        "jen náhodou. Hostitel netns ingressu = ingress přeloží cíl sám na sebe",
        "a požadavek (i s Host hlavičkou trasy) krouží do timeoutu, zatímco",
        "`/__mesh_health` hlásí `ok`.",
        "",
        "CO S TÍM: alias `${APP_NAME_PREFIX}-<služba>` nech JEN službě, která na",
        "portu cíle poslouchá. Hostiteli netns, ve které běží ingress (netbird-agent)",
        "nebo cokoli, co ten alias překládá, aliasy cílů nedávej.",
      ].join("\n"),
    ).toEqual([]);
  });
});
