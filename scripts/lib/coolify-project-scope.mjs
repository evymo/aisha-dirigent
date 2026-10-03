/**
 * coolify-project-scope.mjs — confine Coolify orchestration to ONE project.
 *
 * WHY (incident 2026-07-05): the shared Coolify host runs ~12 tenant instances,
 * all of them AISHA-based. Orchestration scripts historically enumerated the
 * GLOBAL `/api/v1/{applications,services,databases}` list and filtered by name
 * prefix `aisha-`. On a shared host that is unsafe in BOTH directions:
 *
 *   - OUR cold-start's global filter reaches into other environments that also
 *     carry an `aisha-*` name (e.g. a shared `aisha-registry` in another env);
 *   - a TENANT whose apps are named `tenant-*` but who runs the same `aisha-`
 *     filtered wipe would delete OUR `aisha-*` apps and none of its own — the
 *     "other instances take down our stack, don't manage their own" failure.
 *
 * Coolify's data model links every resource to a numeric `environment_id`, and
 * a project owns one or more environments. Scoping enumeration to the target
 * project's environment ids confines every read AND every destructive write to
 * that one tenant — name prefixes become a secondary belt-and-braces filter,
 * never the primary boundary.
 *
 * FAIL-LOUD (no fallbacks): if the caller has not declared its project via
 * COOLIFY_PROJECT_UUID / COOLIFY_PROD_PROJECT_UUID, we REFUSE to run rather than
 * silently fall back to a global name filter. A missing project scope on a
 * shared host is a safety error, not a default.
 *
 * CLI: `node scripts/lib/coolify-project-scope.mjs --list-apps [--name-re=<re>]`
 * prints the in-project applications so the bash cold-start (aisha-cold-start.sh)
 * can delegate its wipe + safety-check enumeration here — the project-scope
 * boundary then lives in exactly ONE place, shared by the .mjs orchestration and
 * the shell, never re-implemented per language. See the bottom of this file.
 */

import { isDirectRun } from "./cli-entry.mjs";
import { resolveInstanceIdentity } from "./coolify-instance-scope.mjs";

/**
 * Je AISHA_ENV produkční? Neuvedené prostředí = starý přímý běh cold-startu,
 * který míří na produkci (AISHA_ENV_DEFAULT=production). Všechno ostatní
 * (staging, <story>-staging, cokoli neznámého) je NE-produkční.
 * @param {string | undefined} aishaEnv
 * @returns {boolean}
 */
export function isProdAishaEnv(aishaEnv) {
  const e = String(aishaEnv ?? "").trim().toLowerCase();
  return e === "" || e === "production" || e === "prod" || /-(prod|production)$/.test(e);
}

/**
 * Resolve the target project UUID the operator declared for this run.
 * Cold-start already exports COOLIFY_PROJECT_UUID (single-env) or
 * COOLIFY_PROD_PROJECT_UUID (multi-env); accept either — ale COOLIFY_PROD_*
 * JEN pro produkční běh.
 *
 * NAMĚŘENO 2026-09-24 (fork, staging na sdíleném Coolify): stagingový běh sdílí prostředí
 * s produkčními klíči (cold-start je zrcadlí `COOLIFY_PROD_PROJECT_UUID:=…`,
 * zálohy a .env.local je nesou). Ne-produkční běh, kterému chybí VLASTNÍ UUID,
 * by tady tiše dostal produkční projekt — a wipe by mazal produkci. Proto pro
 * ne-produkční AISHA_ENV žádný fallback: prázdno = fail-closed u volajícího.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} trimmed uuid, or "" when undeclared
 */
export function resolveProjectUuid(env = process.env) {
  const own = String(env.COOLIFY_PROJECT_UUID || "").trim();
  if (own) return own;
  if (!isProdAishaEnv(env.AISHA_ENV)) return "";
  return String(env.COOLIFY_PROD_PROJECT_UUID || "").trim();
}

/**
 * The project's NAME is its durable identity — the operator declares it as
 * APP_NAME_PREFIX (AISHA_STORY is the older spelling). The UUID is an operational
 * handle Coolify assigns; it differs per control plane and changes if the project
 * is deleted and recreated, so it is derivable from the name and need not be
 * stored anywhere the boundary trusts.
 *
 * KDE se ta deklarace hledá, tahle funkce NEROZHODUJE — ptá se domova identity
 * (lib/coolify-instance-scope.mjs, #905), který zná všechny čtyři kanály
 * (prostředí → .env.local → .env-prod-backup → .env.coolify) a odmítne
 * odpovědět, když si dva odporují.
 *
 * PROČ TO NENÍ KOSMETIKA. Do 2026-08-14 tu stálo `env.APP_NAME_PREFIX || …`,
 * tedy JEN prostředí. Naměřeno v repu riqu ve stejné minutě:
 *   coolify-instance-scope --identity-shell → APP_NAME_PREFIX=riq (.env-prod-backup)
 *   resolveProjectName()                    → ""
 * Následek: `npm run cold-start:verify` sáhl na `coolify/manifests/.manifest`
 * (prázdné STORY) a spadl na ENOENT, derive-domains spadl zpět na referenční
 * `cloud-single.json.example`. Identita měla jeden domov, jenže verify klepal
 * na jiné dveře — a ty mlčely.
 *
 * @param {NodeJS.ProcessEnv} [env] — explicitně předaná mapa je autoritativní
 *        a NESMÍ se doplnit ze souborů na disku. Bez argumentu se použije celý
 *        kanonický řetěz identity pro skutečný operátorský běh.
 * @returns {string} trimmed name, or "" when undeclared
 * @throws když si dva kanály odporují — dvě identity nejsou odpověď, viz #905
 */
export function resolveProjectName(env) {
  // Zachovej rozdíl mezi „volající předal vlastní env" a „volající nic
  // nepředal". Testy, knihovní uživatelé a bezpečnostní kontroly záměrně
  // předávají i prázdnou mapu; doplnit ji z lokálního .env.coolify by změnilo
  // cílového nájemníka a zrušilo fail-closed chování createProjectScope().
  if (env !== undefined) {
    // AISHA_IDENTITY_ROOT / explicitní cesty jsou naopak vědomý požadavek
    // volajícího přečíst kanonický souborový řetěz z JINÉHO kořene (worktree,
    // fixture, instance-data). V tom režimu zůstává jeden resolver i kontrola
    // rozporů; bez těchto ukazatelů je předaná mapa hermetická.
    if (env.AISHA_IDENTITY_ROOT || env.ENV_PROD_BACKUP || env.ENV_FILE) {
      return resolveInstanceIdentity({ env, required: false }).prefix;
    }
    return String(env.APP_NAME_PREFIX || env.AISHA_STORY || "").trim();
  }
  return resolveInstanceIdentity({ env: process.env, required: false }).prefix;
}

/**
 * Resolve a project UUID from its NAME via the live Coolify API — the reason the
 * UUID need not be a stored source of truth: it is a lookup of "the project named
 * <identity>". Returns "" when no project of that name exists; throws when the
 * name is ambiguous (two projects, one name) rather than guessing which tenant.
 * @param {(path: string, options?: object) => Promise<any>} coolify
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function resolveProjectUuidByName(coolify, name) {
  if (!name) return "";
  const projects = await coolify(`/projects`);
  const list = Array.isArray(projects) ? projects : [];
  const matches = list.filter(
    (p) => String(p?.name || "").toLowerCase() === name.toLowerCase(),
  );
  if (matches.length === 0) return "";
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} Coolify projects named '${name}' — refusing to guess which instance is meant`,
    );
  }
  return String(matches[0]?.uuid || "").trim();
}

/**
 * Fetch the set of numeric environment ids that belong to a project.
 * @param {(path: string, options?: object) => Promise<any>} coolify - createCoolifyClient() instance
 * @param {string} projectUuid
 * @returns {Promise<Set<number>>}
 */
export async function getProjectEnvironmentIds(coolify, projectUuid) {
  if (!projectUuid) throw new Error("getProjectEnvironmentIds: projectUuid required");
  const project = await coolify(`/projects/${projectUuid}`);
  const environments = Array.isArray(project?.environments) ? project.environments : [];
  const ids = new Set(
    environments.map((e) => e?.id).filter((id) => Number.isInteger(id)),
  );
  if (ids.size === 0) {
    throw new Error(
      `project ${projectUuid} resolved 0 environments — cannot scope safely (refusing global fallback)`,
    );
  }
  return ids;
}

/**
 * Build a project scope: resolves the declared project, fetches its environment
 * ids, and returns predicates that confine any Coolify resource list to it.
 *
 * Throws (fail-loud) when no project is declared — callers that enumerate or
 * mutate Coolify resources on the shared host MUST NOT proceed unscoped.
 *
 * @param {(path: string, options?: object) => Promise<any>} coolify
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ projectUuid: string, envIds: Set<number>,
 *   inProject: (resource: {environment_id?: number}) => boolean,
 *   filter: <T extends {environment_id?: number}>(items: T[]) => T[] }>}
 */
// NB: no `env = process.env` default HERE — a default parameter and an
// undefined-sentinel are mutually exclusive, and the sentinel must survive to
// the leaf resolvers so "caller injected an env" stays distinguishable from
// "caller injected nothing" (the leaf applies its own default).
export async function createProjectScope(coolify, { env } = {}) {
  // A pinned UUID wins (explicit operator override, backward compatible). When
  // none is pinned, derive it from the declared NAME so the tenant boundary keys
  // off the instance's identity rather than an operational handle — and a
  // recreated project (new UUID) is always found live instead of a stored value
  // pointing at the deleted one.
  let projectUuid = resolveProjectUuid(env);
  // Ne-produkční běh se podle JMÉNA nehledá: fork nese staging i produkci pod
  // jedním jménem instance (APP_NAME_PREFIX), takže by jméno našlo produkční
  // projekt (incident 2026-09-24). Bez vlastního UUID = odmítnout.
  const aishaEnv = (env ?? process.env).AISHA_ENV;
  if (!projectUuid && !isProdAishaEnv(aishaEnv)) {
    throw new Error(
      `Non-production run (AISHA_ENV=${aishaEnv}) has no own COOLIFY_PROJECT_UUID — refusing ` +
        "to fall back to the production project or to look the project up by name " +
        "(fail-closed, incident 2026-09-24). Pin the run's own project UUID.",
    );
  }
  if (!projectUuid) {
    const name = resolveProjectName(env);
    if (name) projectUuid = await resolveProjectUuidByName(coolify, name);
  }
  if (!projectUuid) {
    throw new Error(
      "No target project could be resolved — refusing to enumerate or mutate Coolify " +
        "resources by global name prefix on a SHARED host. Declare the instance via " +
        "APP_NAME_PREFIX (its project name) or pin COOLIFY_PROJECT_UUID, so this run " +
        "cannot touch another tenant's stack.",
    );
  }
  const envIds = await getProjectEnvironmentIds(coolify, projectUuid);
  const inProject = (resource) => envIds.has(resource?.environment_id);
  return {
    projectUuid,
    envIds,
    inProject,
    filter: (items) => (Array.isArray(items) ? items.filter(inProject) : []),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
// `node scripts/lib/coolify-project-scope.mjs --list-apps [--name-re=<regex>] [--with-status | --json]`
//
// Prints one `<name>\t<uuid>` line per APPLICATION that lives in the DECLARED
// project's environments, optionally narrowed to names matching the
// case-insensitive extended regex <regex>. The scope is resolved by
// createProjectScope() — the SAME fail-loud boundary the .mjs orchestration
// (#605/#606) uses — so the bash cold-start never re-implements env-id filtering.
// Exit codes (a non-zero exit MUST make the caller fail-CLOSED — never enumerate
// or wipe by a global name prefix when the project scope is unconfirmed):
//   0  ok (zero or more lines)
//   2  bad usage / missing Coolify base url or token
//   3  scope unresolved — no project declared, or it owns 0 environments
//   4  Coolify list request failed
// „Spustili mě přímo?" má jeden domov: lib/cli-entry.mjs. Porovnává SKUTEČNÉ
// cesty (realpath), ne řetězce — jinak stačí symlink nebo git worktree, blok se
// TIŠE přeskočí a volající dostane prázdný výstup s kódem 0, který si vyloží
// jako měření.
if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (!argv.includes("--list-apps")) {
    process.stderr.write("usage: coolify-project-scope.mjs --list-apps [--name-re=<regex>]\n");
    process.exit(2);
  }
  const nameReArg = argv.find((a) => a.startsWith("--name-re="));
  let nameRe = null;
  if (nameReArg) {
    try {
      nameRe = new RegExp(nameReArg.slice("--name-re=".length), "i");
    } catch (err) {
      process.stderr.write(`coolify-project-scope: invalid --name-re: ${err.message}\n`);
      process.exit(2);
    }
  }

  // Canonical chain, not process.env alone. This CLI is what the shell
  // cold-start delegates its tenant-boundary enumeration to, and it ran with
  // only the variables that happened to be exported — so on a stack whose
  // credentials live in .env.coolify it could not authenticate and reported
  // "could not resolve the project scope", which the caller correctly treats as
  // fail-closed. The guard was right and its input was wrong: refusing to run is
  // the safe outcome, but it blocked a legitimate deploy on a false premise.
  const { readConfigKeyAny } = await import("./config-env-files.mjs");
  const baseUrl =
    process.env.COOLIFY_BASE_URL ||
    process.env.COOLIFY_URL ||
    readConfigKeyAny(["COOLIFY_BASE_URL", "COOLIFY_URL"]);
  const token =
    process.env.COOLIFY_API_TOKEN ||
    readConfigKeyAny(["COOLIFY_API_TOKEN", "COOLIFY_API_KEY"]);
  if (!baseUrl || !token) {
    process.stderr.write(
      "coolify-project-scope: COOLIFY_BASE_URL (or COOLIFY_URL) and COOLIFY_API_TOKEN are required " +
        "(env or config/domains.env, .env.coolify, .env.local, .env-prod-backup, .env.aisha)\n",
    );
    process.exit(2);
  }

  const { createCoolifyClient } = await import("./coolify-http.mjs");
  // 120 s per attempt: the global /applications body serialises every app's
  // docker_compose_raw and can exceed 800 KB once a full stack exists (the same
  // reason the bash caller used --max-time 120). inProject then confines it.
  const coolify = createCoolifyClient({ baseUrl, token, timeoutMs: 120_000 });

  let scope;
  try {
    scope = await createProjectScope(coolify); // throws (fail-loud) when unscoped
  } catch (err) {
    process.stderr.write(`coolify-project-scope: ${err.message}\n`);
    process.exit(3);
  }

  let apps;
  try {
    apps = await coolify("/applications");
  } catch (err) {
    process.stderr.write(`coolify-project-scope: GET /applications failed: ${err.message}\n`);
    process.exit(4);
  }

  const rows = (Array.isArray(apps) ? apps : [])
    .filter(scope.inProject)
    .filter((a) => !nameRe || nameRe.test(a?.name || ""));
  // Default output is 2 columns (name\tuuid) — callers `read name uuid`. --with-status
  // appends the Coolify container status ("running:healthy" etc.) as a 3rd column so
  // the operator control plane can verify INTERNAL (mesh-only) services via their
  // container health instead of an off-mesh HTTP probe.
  const withStatus = argv.includes("--with-status");
  // --json: JSON pole {name, uuid, status} — tvar, který čte bashový překladač
  // jméno→UUID (lib/coolify-resolve-uuid.sh). ⛔ NAMĚŘENO 2026-09-13: ten si dřív
  // bral globální /applications a rozsah zkoušel přes coolify-our-apps.sh jen
  // s COOLIFY_PROJECT_UUID, které CI nemá (běh #3639) — takže KAŽDÝ deploy
  // překládal jméno napříč nájemníky. Hranice projektu má zůstat
  // v jednom domově; bash ji proto nečte po svém, ale ptá se tady.
  if (argv.includes("--json")) {
    process.stdout.write(
      JSON.stringify(rows.map((a) => ({ name: a?.name ?? "", uuid: a?.uuid ?? "", status: a?.status ?? "" }))) + "\n",
    );
    process.exit(0);
  }
  for (const a of rows) {
    if (withStatus) process.stdout.write(`${a?.name ?? ""}\t${a?.uuid ?? ""}\t${a?.status ?? ""}\n`);
    else process.stdout.write(`${a?.name ?? ""}\t${a?.uuid ?? ""}\n`);
  }
}
