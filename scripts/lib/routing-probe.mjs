/**
 * routing-probe.mjs — is a host ACTUALLY routed by Traefik, or served the
 * "no router matched" default backend?
 *
 * WHY: the 2026-07-09 tenant-registry failure taught that Coolify DB state (the
 * docker_compose_domains entry looks fine) is NOT evidence a host routes. The only
 * trustworthy arbiter is a live HTTP probe. A Coolify/Traefik default-backend 404 has
 * a distinctive signature (HTTP 404, text/plain, ~19-byte "404 page not found", and —
 * crucially — NO service-specific header) that is distinguishable from a real backend
 * 404. This lib is the post-condition gate: reconciliation is only "green" once the
 * host actually serves its expected signal.
 *
 * UNIVERSALITY: probe ONLY externally-reachable contract hosts. Internal-only hosts
 * (*.backend.<internal_tld>) and unresolvable hosts are SKIPPED, never FAILED, so a
 * healthy cold-start of internal services is never closed by an external probe. The
 * accept-check is per service KIND (registry / oauth2 / http), not a blunt "not a 404",
 * so a legitimate backend 302/401/404 is judged correctly across aisha and tenant backends.
 *
 * @module
 */

/**
 * A Traefik default-backend "no router" 404 (as opposed to a real backend 404).
 * @param {{status:number, headers:Record<string,string>, bodyLen:number|null}} res
 */
export function isTraefikDefault404(res) {
  if (!res || res.status !== 404) return false;
  const ct = (res.headers?.["content-type"] || "").toLowerCase();
  if (!ct.includes("text/plain")) return false;
  // A real backend rarely answers text/plain with no service header AND a tiny body.
  if (res.headers?.["docker-distribution-api-version"]) return false;
  return res.bodyLen == null || res.bodyLen <= 32;
}

/**
 * ODPOVĚĎ, KTERÁ NIKAM NEPOSUNE, není důkaz o službě.
 *
 * ⛔ NAMĚŘENO 2026-08-15 na Talosu, přesný podpis:
 *
 *     curl http://neznáme-jméno/   → 302, Location: https://neznáme-jméno/
 *     curl https:// … -H 'Host: …' → 503
 *
 * Search doména přeloží LIBOVOLNÉ neznámé jméno na síťovou appliance a ta na
 * jakýkoli Host odpoví přesměrováním, které ukazuje na TUTÉŽ adresu. Mrtvá
 * vnitřní služba tedy nevrátí chybu, ale přesměrování — a sonda, která bere
 * „něco odpovědělo" jako důkaz, na tom postaví falešnou zelenou.
 *
 * Wildcard sám o sobě vadit nemusí: víme, JAKÁ odpověď má přijít, ne jen že
 * něco přišlo. Tohle je ta znalost zapsaná jako podmínka.
 *
 * ⚠ POZOR NA ŠÍŘI PRAVIDLA — naměřeno, ne odhadnuto:
 *
 *   · Podpis odražeče `http://X/ → https://X/` je K NEROZEZNÁNÍ od univerzálního
 *     HTTP→HTTPS upgradu, který vydá KAŽDÝ správně nastavený edge. Rozlišit je
 *     lze jen tím, že sonda se ptá přes HTTPS, kde upgrade nemá co dělat.
 *     Proto tahle podmínka platí jen pro schéma, ve kterém se měří.
 *
 *   · Týž host s JINOU cestou je POSTUP, ne odraz: NocoDB odpovídá na `/`
 *     přesměrováním na `/dashboard`, Appsmith obdobně. Porovnávat jen hostname
 *     by zavřelo zdravé nasazení — a `smoke-routing.sh` pro ně dodnes výslovně
 *     přijímá `200,302`.
 *
 * Odražeč je tedy odpověď, která ukazuje zpátky na TOTÉŽ, na co jsme se ptali:
 * týž host A táž cesta. Skutečná oauth2 brána posílá jinam (na IdP — všech
 * devět našich má `OAUTH2_PROXY_SKIP_PROVIDER_BUTTON=true`, takže míří rovnou
 * na Keycloak), registry se ohlásí svou hlavičkou, aplikace posune cestu.
 *
 * @param {{status:number, headers:Record<string,string>}} res
 * @param {string} host  hostitel, na který se sonda ptala
 * @param {string} [path]  cesta, na kterou se sonda ptala (default `/`)
 */
export function isEchoRedirect(res, host, path = "/") {
  if (!res || ![301, 302, 303, 307, 308].includes(res.status)) return false;
  const loc = res.headers?.["location"];
  if (!loc || !host) return false;
  const zaklad = `https://${host}${path.startsWith("/") ? path : `/${path}`}`;
  let cil;
  try {
    cil = new URL(loc, zaklad);
  } catch {
    return false; // nečitelný Location není důkaz ani jedním směrem
  }
  if (cil.hostname.toLowerCase() !== String(host).toLowerCase()) return false;
  // Táž cesta = žádný postup. Liší-li se, služba nás někam VEDE — to je znak
  // aplikace, ne appliance. Koncové lomítko je kosmetika, ne rozdíl.
  const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
  return norm(cil.pathname) === norm(path.startsWith("/") ? path : `/${path}`);
}

/**
 * Accept predicate + probe path per service kind. Extend as new kinds appear.
 *
 * Každý `accept` dostává i HOSTITELE, aby mohl odmítnout odpověď, která jen
 * vrací otázku. Bez toho platilo `status > 0` — tedy „něco tam je" — což je
 * na hostu s wildcard resolverem splněné vždy, i pro službu, která neběží.
 *
 * @param {"registry"|"oauth2"|"http"} kind
 */
export function expectedSignal(kind) {
  switch (kind) {
    case "registry":
      // Registry se ohlásí VLASTNÍ hlavičkou — nejsilnější dostupný důkaz identity.
      return { path: "/v2/", accept: (r) => r.status === 200 && !!r.headers?.["docker-distribution-api-version"] };
    case "oauth2":
      // Brána buď odmítne (401/403), nebo pošle NA IdP — tedy JINAM. Přesměrování
      // zpět na totéž je odražeč, ne přihlašovací tok.
      return {
        path: "/",
        accept: (r, host) =>
          [401, 403].includes(r.status) ||
          ([301, 302, 303, 307, 308].includes(r.status) && !isEchoRedirect(r, host, "/")),
      };
    default: // "http"
      return {
        path: "/",
        accept: (r, host) => r.status > 0 && !isTraefikDefault404(r) && !isEchoRedirect(r, host, "/"),
      };
  }
}

/**
 * JEDINÝ DOMOV VERDIKTU „žije to".
 *
 * Verdikt má DVĚ půlky a dodnes žila každá jinde:
 *
 *   · KLADNOU nese volající — „od TÉHLE cesty čekám TYHLE kódy". Tu znalost mají
 *     `stack-health.sh`, `smoke-routing.sh`, `cold-start-verify.mjs`
 *     a `check-infra.mjs` každý po svém a je bohatší než druh služby.
 *   · ZÁPORNOU nese sonda — „takhle vypadá NE-služba". Tu měl dosud jen doktor.
 *
 * Sjednocení proto neznamená kladnou půlku zahodit a nahradit ji hrubým druhem
 * služby — to by ověřování OSLABILO. Znamená, že obě půlky bydlí tady a že
 * **zápornou nesmí volající přebít**: seznam očekávaných kódů je nárok na to,
 * CO má přijít, ne povolení přijmout odpověď od appliance. Kdo čeká 302
 * a dostane odraz, nedostal svou službu.
 *
 * @param {{status:number, headers:Record<string,string>, bodyLen:number|null}} res
 * @param {{host:string, kind?:string, path?:string, expect?:number[]|null}} opts
 * @returns {{routed:boolean, reason?:string}}
 */
export function judgeResponse(res, { host, kind = "http", path = "/", expect = null, idpHost = null } = {}) {
  if (!res || !(res.status > 0)) {
    return { routed: false, reason: "bez odpovědi" };
  }
  // OD ČERNÉ LISTINY K BÍLÉ. Odmítnout známý podpis ne-služby je jen dolní mez:
  // pořád tvrdíme „tohle není appliance", ne „tohle je NAŠE brána". Zná-li
  // volající DEKLAROVANOU tvář IdP, dá se ověřit, kam přihlašovací tok vede —
  // a „přesměrovalo to někam jinam" přestane stačit.
  if (idpHost && [301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers?.["location"];
    let cil = null;
    let necitelne = null;
    if (loc) {
      try {
        cil = new URL(loc, `https://${host}${path}`).hostname.toLowerCase();
      } catch (e) {
        // Nečitelný `Location` je JINÝ nález než špatný cíl — spolknout ho do
        // „míří na '?'" by dvě různé vady slilo do jedné hlášky.
        necitelne = e?.message || String(e);
      }
    }
    if (cil !== String(idpHost).toLowerCase()) {
      return {
        routed: false,
        reason: necitelne
          ? `Location se nedá přečíst (${necitelne}) — cíl přihlašovacího toku nelze potvrdit`
          : `přihlašovací tok míří na '${cil ?? "žádný Location"}', ne na deklarovaný IdP '${idpHost}'`,
      };
    }
  }
  // ZÁPORNÁ půlka — diskvalifikace, kterou nelze získat zpět očekáváním.
  if (isEchoRedirect(res, host, path)) {
    return {
      routed: false,
      reason: `odpověď nikam neposune (${res.status} → totéž) — to není důkaz o službě`,
    };
  }
  if (isTraefikDefault404(res)) {
    return { routed: false, reason: "výchozí 404 edge — hostitele nechytil žádný router" };
  }
  // KLADNÁ půlka — nárok volajícího má přednost před hrubým druhem služby.
  if (Array.isArray(expect) && expect.length > 0) {
    return expect.includes(res.status)
      ? { routed: true }
      : { routed: false, reason: `HTTP ${res.status} (čekáno ${expect.join(",")})` };
  }
  const sig = expectedSignal(kind);
  return sig.accept(res, host)
    ? { routed: true }
    : { routed: false, reason: `HTTP ${res.status} neodpovídá druhu '${kind}'` };
}

/** Keep only externally-probeable hosts; drop internal-only / sentinel / unresolvable. */
export function scopeProbable(hosts, { internalTld } = {}) {
  return (hosts || []).filter((h) => {
    if (!h || typeof h !== "string") return false;
    if (internalTld && h.endsWith(`.backend.${internalTld}`)) return false;
    if (h.endsWith(".invalid") || h.endsWith(".internal") || h.endsWith(".local")) return false;
    return true;
  });
}

async function httpProbe(url, timeoutMs, { headers: reqHeaders = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      ...(Object.keys(reqHeaders).length ? { headers: reqHeaders } : {}),
    });
    const headers = {};
    for (const [k, v] of r.headers) headers[k.toLowerCase()] = v;
    const cl = headers["content-length"];
    return { status: r.status, headers, bodyLen: cl != null ? parseInt(cl, 10) : null };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Probe a single host. Returns { host, routed, traefikDefault404, status, skipped, reason }.
 * Never throws — an unreachable host resolves to { routed:false, reason }.
 *
 * `path` a `expect` nechávají volajícího přinést svůj KURÁTOROVANÝ nárok
 * (`/health` → 200), aniž by tím ztratil diskvalifikace — ty drží
 * {@link judgeResponse} a přebít je nelze.
 */
export async function probeRoute(
  host,
  kind = "http",
  { timeoutMs = 8000, scheme = "https", path = null, expect = null, headers = {}, idpHost = null } = {},
) {
  const sig = expectedSignal(kind);
  const cesta = path || sig.path;
  let res;
  try {
    res = await httpProbe(`${scheme}://${host}${cesta}`, timeoutMs, { headers });
  } catch (e) {
    // `fetch` v Node zabalí SKUTEČNOU příčinu do `cause` a navenek hlásí jen
    // „TypeError: fetch failed". Holé jméno výjimky je výstup, který vypadá jako
    // měření a přitom neříká nic — TLS mismatch, DNS a odmítnuté spojení jsou
    // tři různé nálezy s třemi různými nápravami.
    const c = e?.cause;
    const detail = [c?.code, c?.message, e?.message].filter(Boolean).join(": ") || e?.name || "neznámá chyba";
    return { host, kind, path: cesta, routed: false, skipped: false, reason: `nedosažitelné: ${detail}` };
  }
  const verdikt = judgeResponse(res, { host, kind, path: cesta, expect, idpHost });
  return {
    host,
    kind,
    path: cesta,
    routed: verdikt.routed,
    traefikDefault404: isTraefikDefault404(res),
    echoRedirect: isEchoRedirect(res, host, cesta),
    status: res.status,
    skipped: false,
    // Důvod se vypisuje, aby „neprošlo" nebylo jen barvou. Odražeč vypadá
    // jako živá odpověď, takže se musí pojmenovat.
    ...(verdikt.reason ? { reason: verdikt.reason } : {}),
  };
}
