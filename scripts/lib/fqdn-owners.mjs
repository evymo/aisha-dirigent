/**
 * fqdn-owners.mjs — detect when two apps in ONE project collide on the same public host,
 * plus the host/fqdn utilities the project-scoped domain-doctor needs.
 *
 * PROJECT-SCOPED, like everything else. A caller MUST feed buildOwnerIndex() /
 * findContractConflicts() only its OWN project's apps (apps.filter(scope.inProject) — see
 * coolify-project-scope.mjs). Nothing here acts on another project's resources.
 *
 * If a FOREIGN project squats one of your hosts, that is the OWNING project's cleanup:
 * its own domain-doctor sees the foreign host as an `extra` outside its contract and drops
 * it, scoped to that project. Reaching across the project boundary to unbind/reclaim
 * another tenant's app is a principled failure (and the exact shape of the 2026-07-05
 * cross-tenant incident) — nothing here does it, by construction.
 *
 * VÝJIMKA JEN PRO ČTENÍ (2026-09-13): findForeignClaimants() cizí projekt PŘEČTE, aby
 * doktor věděl, kdy force_domain_override ODMÍTNOUT (přebitá doména cizímu vlastníkovi
 * zůstane → dvojí vazba). Nejedná za cizí projekt a nevrací nic s tajemstvím.
 *
 * identityAxes() exposes env/repo/fqdn for a human to read in a same-project conflict
 * report and deliberately OMITS the git token — a shared deploy token is never an
 * ownership signal.
 *
 * @module
 */

/** Strip scheme, path and port from a Coolify domain value → bare lowercase host. */
export function extractHost(domainValue) {
  if (typeof domainValue !== "string") return "";
  let s = domainValue.trim().replace(/^https?:\/\//i, "");
  s = s.split("/")[0].split(":")[0];
  return s.toLowerCase();
}

/** Parse Coolify docker_compose_domains (JSON string | object | array) → domain values. */
export function parseDcdDomains(raw) {
  if (!raw) return [];
  let v = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { return []; }
  }
  const out = [];
  if (Array.isArray(v)) {
    for (const e of v) if (e?.domain) out.push(String(e.domain));
  } else if (v && typeof v === "object") {
    for (const e of Object.values(v)) if (e?.domain) out.push(String(e.domain));
  }
  return out;
}

/** Every public host an app claims — from docker_compose_domains AND its app-level fqdn. */
export function appClaimedHosts(app) {
  const hosts = new Set();
  if (app?.fqdn) {
    for (const f of String(app.fqdn).split(",")) {
      const h = extractHost(f);
      if (h) hosts.add(h);
    }
  }
  for (const d of parseDcdDomains(app?.docker_compose_domains)) {
    // Coolify stores multiple hosts for one compose service as one comma-
    // separated domain value. Treat each URL as its own ownership claim;
    // parsing the whole string made only the first hostname visible.
    for (const value of String(d).split(",")) {
      const h = extractHost(value);
      if (h) hosts.add(h);
    }
  }
  return hosts;
}

/** Is an app-level fqdn just Coolify's UUID default (https://<uuid>.<tld>)? */
export function isUuidDefaultFqdn(fqdn, uuid) {
  if (!fqdn || !uuid) return false;
  const h = extractHost(String(fqdn).split(",")[0]);
  return h.startsWith(`${String(uuid).toLowerCase()}.`);
}

/** Server, na kterém aplikace běží (Coolify ho vede na `destination.server_id`). */
export function serverIdOf(app) {
  return app?.destination?.server_id ?? app?.server_id ?? app?.destination_id ?? null;
}

/** Map<host, app[]> over a PROJECT-SCOPED app list (caller filters to its own project — never global). */
export function buildOwnerIndex(apps) {
  const index = new Map();
  for (const app of apps || []) {
    for (const host of appClaimedHosts(app)) {
      if (!index.has(host)) index.set(host, []);
      index.get(host).push(app);
    }
  }
  return index;
}

/**
 * Promítne do indexu POTVRZENÝ zápis jedné aplikace: její dřívější nároky zmizí,
 * nové (z uloženého stavu po zápisu) přibudou. Index je jinak snímek z doby před
 * během, takže aplikace zpracovaná později by viděla jméno, které jiná právě
 * uvolnila, pořád jako obsazené (doktor: edge × backend na témž uzlu, 2026-09-27).
 * Mění `index` na místě. Host bez vlastníka z indexu zmizí.
 * @param {Map<string, any[]>} index  from buildOwnerIndex(projectScopedApps)
 * @param {any} app                   app se stavem PO zápisu (uuid + docker_compose_domains/fqdn)
 */
export function replaceOwner(index, app) {
  if (!app?.uuid) return index;
  for (const [host, owners] of [...index.entries()]) {
    const zbyva = owners.filter((owner) => owner?.uuid !== app.uuid);
    if (zbyva.length > 0) index.set(host, zbyva);
    else index.delete(host);
  }
  for (const host of appClaimedHosts(app)) {
    if (!index.has(host)) index.set(host, []);
    index.get(host).push(app);
  }
  return index;
}

/**
 * Non-token identity axes for a human to judge a claimant. Git creds/token are stripped
 * and NOT surfaced as an ownership signal (see module note + 2026-07-05).
 */
export function identityAxes(app) {
  const gitRaw = app?.git_repository || "";
  const gitRepo = gitRaw
    .replace(/^https?:\/\/[^/@]*@/i, "https://") // strip user:token@
    .replace(/([^:])\/\/+/g, "$1/");             // collapse accidental double slashes
  return {
    uuid: app?.uuid || "",
    name: app?.name || "",
    envId: app?.environment_id ?? null,
    serverId: serverIdOf(app),
    gitRepo,
    fqdnIsUuidDefault: isUuidDefaultFqdn(app?.fqdn, app?.uuid),
    status: app?.status || "",
  };
}

/**
 * For the hosts our app is contracted to own, find OTHER apps IN THE SAME PROJECT also
 * claiming them (the `index` is built from project-scoped apps, so this can only ever be
 * an intra-project collision — a bug to surface, never a foreign tenant to touch).
 * Returns [] when every contract host is single-owned within the project.
 * @param {Map<string, any[]>} index  from buildOwnerIndex(projectScopedApps)
 * @param {string[]} contractHosts    hosts our app should own (from the domain contract)
 * @param {string} ourUuid            our app's uuid (excluded from "other" claimants)
 */
export function findContractConflicts(index, contractHosts, ours) {
  const ourUuid = typeof ours === "object" ? ours?.uuid : ours;
  const ourServerId = typeof ours === "object" ? serverIdOf(ours) : null;
  const conflicts = [];
  for (const raw of contractHosts) {
    const host = extractHost(raw);
    if (!host) continue;
    const claimants = index.get(host) || [];
    const others = claimants.filter((a) => {
      if (!a?.uuid || a.uuid === ourUuid) return false;
      const otherServerId = serverIdOf(a);
      // The same browser Host is intentionally registered on Frontend edge
      // and Backend OAuth proxy. They are different Traefik instances, so this
      // is not a collision. Unknown placement remains fail-closed.
      return ourServerId == null || otherServerId == null || String(otherServerId) === String(ourServerId);
    });
    if (others.length > 0) {
      conflicts.push({ host, claimants: claimants.map(identityAxes) });
    }
  }
  return conflicts;
}

/**
 * Kdo MIMO NÁŠ PROJEKT drží hosty, které máme podle kontraktu vlastnit — POUZE ČTENÍ.
 *
 * ⛔ NAMĚŘENO 2026-09-13 na sdíleném Coolify (GET /api/v1/applications): registry cache
 * instance měla uložený jiný host, než chce kontrakt — a host z kontraktu držela aplikace
 * JINÉHO projektu na TÉMŽ serveru. domain-doctor --apply by od druhého pokusu poslal
 * `force_domain_override=true`: Coolify doménu přebije, ale cizímu vlastníkovi ji
 * NEODEBERE — dva routery na jeden host (týž tvar jako incident 2026-07-09 tenantcache).
 *
 * Tahle funkce proto CIZÍ projekt ČTE — výhradně aby doktor věděl, kdy vynucení
 * ODMÍTNOUT. Na cizí aplikace nesahá, nic neodvazuje, nic nepřebírá; hranice
 * „nejednáme za jiný projekt" platí dál. Vrací jen pole bez tajemství: jméno,
 * uuid, environment_id, server, stav — `git_repository` (nese přihlašovací údaj)
 * se do výsledku NIKDY nedostane.
 *
 * Pravidlo serveru je totéž jako u findContractConflicts: jiný server = jiný Traefik,
 * tedy žádná kolize; neznámé umístění se bere jako kolize (fail-closed).
 *
 * @param {any[]} globalApps            GLOBÁLNÍ výpis /applications
 * @param {(app: any) => boolean} inProject  predikát našeho projektu (scope.inProject)
 * @param {string[]} contractHosts      hosty z kontraktu naší aplikace
 * @param {any} ours                    naše aplikace
 * @returns {{ host: string, owners: { name: string, uuid: string, environmentId: number|null, serverId: any, status: string }[] }[]}
 */
export function findForeignClaimants(globalApps, inProject, contractHosts, ours) {
  const ourServerId = serverIdOf(ours);
  const out = [];
  for (const raw of contractHosts || []) {
    const host = extractHost(raw);
    if (!host) continue;
    const owners = (globalApps || [])
      .filter((a) => a?.uuid && a.uuid !== ours?.uuid && !inProject(a) && appClaimedHosts(a).has(host))
      .filter((a) => {
        const s = serverIdOf(a);
        return ourServerId == null || s == null || String(s) === String(ourServerId);
      })
      .map((a) => ({
        name: a.name || "",
        uuid: a.uuid,
        environmentId: a.environment_id ?? null,
        serverId: serverIdOf(a),
        status: a.status || "",
      }));
    if (owners.length > 0) out.push({ host, owners });
  }
  return out;
}
