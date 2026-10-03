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
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(__dirname, "../../..");

type Sluzba = { networks?: unknown; network_mode?: string };

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
    const env: NodeJS.ProcessEnv = { ...process.env, MESH_ENABLED: "true", APP_NAME_PREFIX: "zkouska" };
    // Identita se volí smyšlená: kdyby se prefix někde nedosadil, ukáže se to
    // jako neshoda, ne jako trefa na jméno živé instance.
    for (const k of ["PUBLIC_TLD", "INTERNAL_TLD", "MESH_TLD"]) env[k] = env[k] || `${k.toLowerCase()}.test`;
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/lib/derive-domains.mjs"), "--shell"], {
      cwd: ROOT, env, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024,
    });

    // ⛔ UNIVERZUM MINULO PŮLKU SVĚTA (naměřeno při wipu 2026-08-24). Tahle
    // smyčka brala jen `_MESH_INGRESS_ROUTES`, tedy HTTP trasy — a `_MESH_TCP_ROUTES`
    // nevidela vůbec. Přitom právě tam patří clamav a shared-redis: clamd i Redis
    // mluví vlastním TCP protokolem, který Caddy rozvést neumí.
    //
    // Důsledek byl přesně ten, před kterým tahle brána má chránit: trasa
    // `3310|<prefix>-clamav:3310` mířila na jméno, které compose nepřidělovala
    // (alias byl jen `<prefix>-clamd`), sidecar `clamav-mesh-tcp` padal
    // v restart smyčce na `host not found in upstream` — a 7038 bran mlčelo.
    // Našel to až wipe, tedy nasazení, ne měřidlo.
    //
    // Tvary se liší a musí se číst každý po svém:
    //   INGRESS: `port|jmena|cil:port`  → cíl je 3. pole
    //   TCP:     `port|cil:port`        → cíl je 2. pole
    const cile = new Set<string>();
    for (const radek of out.split("\n")) {
      const ingress = /^[A-Z0-9_]+_MESH_INGRESS_ROUTES='?(.*?)'?$/.exec(radek);
      const tcp = /^[A-Z0-9_]+_MESH_TCP_ROUTES='?(.*?)'?$/.exec(radek);
      const m = ingress ?? tcp;
      if (!m) continue;
      const poleCile = ingress ? 2 : 1;
      for (const trasa of m[1].split(";")) {
        const cil = trasa.split("|")[poleCile];
        if (cil) cile.add(cil.split(":")[0]);
      }
    }
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

    const env: NodeJS.ProcessEnv = { ...process.env, MESH_ENABLED: "true", APP_NAME_PREFIX: "zkouska" };
    for (const k of ["PUBLIC_TLD", "INTERNAL_TLD", "MESH_TLD"]) env[k] = env[k] || `${k.toLowerCase()}.test`;
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/lib/derive-domains.mjs"), "--shell"], {
      cwd: ROOT, env, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024,
    });

    const cile = new Set<string>();
    for (const radek of out.split("\n")) {
      const ingress = /^[A-Z0-9_]+_MESH_INGRESS_ROUTES='?(.*?)'?$/.exec(radek);
      const tcp = /^[A-Z0-9_]+_MESH_TCP_ROUTES='?(.*?)'?$/.exec(radek);
      const m = ingress ?? tcp;
      if (!m) continue;
      const poleCile = ingress ? 2 : 1;
      for (const trasa of m[1].split(";")) {
        const cil = trasa.split("|")[poleCile];
        if (cil) cile.add(cil.split(":")[0]);
      }
    }
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
    // A hostitel netns (`network_mode: service:<x>`) alias cíle nést nesmí
    // nikdy: všechno, co v jeho netns běží — i ingress sám —, by jméno
    // přeložilo na sebe.
    const env: NodeJS.ProcessEnv = { ...process.env, MESH_ENABLED: "true", APP_NAME_PREFIX: "zkouska" };
    for (const k of ["PUBLIC_TLD", "INTERNAL_TLD", "MESH_TLD"]) env[k] = env[k] || `${k.toLowerCase()}.test`;
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/lib/derive-domains.mjs"), "--shell"], {
      cwd: ROOT, env, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024,
    });

    const cile = new Set<string>();
    for (const radek of out.split("\n")) {
      const ingress = /^[A-Z0-9_]+_MESH_INGRESS_ROUTES='?(.*?)'?$/.exec(radek);
      const tcp = /^[A-Z0-9_]+_MESH_TCP_ROUTES='?(.*?)'?$/.exec(radek);
      const m = ingress ?? tcp;
      if (!m) continue;
      const poleCile = ingress ? 2 : 1;
      for (const trasa of m[1].split(";")) {
        const cil = trasa.split("|")[poleCile];
        if (cil) cile.add(cil.split(":")[0]);
      }
    }
    expect(cile.size, "derivace nevydala ŽÁDNOU trasu — měřidlo osiřelo").toBeGreaterThan(10);

    // alias → držitelé (služba se počítá jednou, i když alias nese na více sítích)
    const drzitele = new Map<string, { sluzba: string; soubor: string; hostiNetns: boolean }[]>();
    for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
      let doc: { services?: Record<string, Sluzba> };
      try { doc = parse(readFileSync(join(ROOT, f), "utf-8")); } catch { continue; }
      const sluzby = doc?.services ?? {};
      const hostitele = new Set(
        Object.values(sluzby)
          .map((spec) => /^service:(.+)$/.exec(String(spec?.network_mode ?? ""))?.[1])
          .filter((x): x is string => Boolean(x)),
      );
      for (const [jmeno, spec] of Object.entries(sluzby)) {
        const nets = spec?.networks;
        if (!nets || Array.isArray(nets)) continue;
        const moje = new Set<string>();
        for (const v of Object.values(nets as Record<string, { aliases?: unknown[] } | null>)) {
          for (const a of (v && Array.isArray(v.aliases) ? v.aliases : [])) {
            moje.add(String(a).replace(/\$\{APP_NAME_PREFIX[^}]*\}/g, "zkouska"));
          }
        }
        for (const alias of moje) {
          const seznam = drzitele.get(alias) ?? [];
          seznam.push({ sluzba: jmeno, soubor: f, hostiNetns: hostitele.has(jmeno) });
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
        "portu cíle poslouchá. Hostiteli netns (netbird-agent) aliasy cílů nedávej.",
      ].join("\n"),
    ).toEqual([]);
  });
});
