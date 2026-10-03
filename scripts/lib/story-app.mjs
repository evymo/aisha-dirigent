/**
 * story-app.mjs — map upstream-authored "aisha-<role>" app names to THIS
 * deployment's own prefix.
 *
 * WHY: platform orchestration (redeploy wave DAG, domain-doctor contract, wipe,
 * status, …) is authored with literal `aisha-<role>` app names — the upstream
 * stack's namespace. A fork / story / client instance names its Coolify apps
 * `<prefix>-*` instead (APP_NAME_PREFIX, #600). Every tool that matched apps by
 * a hardcoded `aisha-` prefix silently did nothing on a non-aisha deploy:
 * redeploy mis-classified optional-app failures as critical (SOFT_DEPLOY_APPS),
 * domain-doctor never found `<prefix>-registry` so its `registry_cache` →
 * `registry-cache` domain fix never applied (tenantcache 404, 2026-07-09), etc.
 *
 * This is the SINGLE source of truth for that remap so no tool re-hardcodes
 * `aisha-`. Pair it with lib/coolify-project-scope.mjs (the project boundary):
 * project-scope confines *which tenant* you touch, story-app maps *which app
 * name* you look for within it.
 *
 * The default prefix is "aisha" (identity remap) so the upstream stack is
 * unchanged. Domain / service NAMES inside a compose (e.g. "registry-cache")
 * are prefix-INDEPENDENT and must NOT be remapped — only the Coolify APP name is.
 *
 * @module
 */

/**
 * Coerce the optional `env` argument back to process.env when it isn't an env
 * object. WHY: these helpers are natural `.map()` callbacks, and Array.map passes
 * (element, INDEX, array) — so `.map(toStoryApp)` silently bound `env` to a NUMBER,
 * making appPrefix read APP_NAME_PREFIX off `0` → undefined → "aisha". The remap
 * then no-op'd and a fork deploy targeted app names that do not exist in its
 * project ("no targets" on every wave; zero containers — aisha-redeploy.mjs, 2026-07-16).
 * Upstream never noticed: with prefix "aisha" the no-op is indistinguishable from
 * correct. Guarding here kills the whole class rather than each call site.
 * @param {unknown} env
 * @returns {NodeJS.ProcessEnv}
 */
function asEnv(env) {
  return env && typeof env === "object" ? /** @type {NodeJS.ProcessEnv} */ (env) : process.env;
}

/**
 * The app-name prefix this deployment uses for its Coolify apps.
 *
 * ⛔ ŽÁDNÝ FALLBACK (majitel, 2026-08-24: „žádný fallback, `|| \"aisha\"` nesmí být nikde").
 * Do té doby tu stálo `APP_NAME_PREFIX || "aisha"` — dosazený literál, který HÁDÁ
 * fakt o světě: ČÍ aplikace tenhle běh čte a mění. Na sdíleném Coolify je to
 * nejdražší možná domněnka. Naměřeno 2026-08-24: `reconcile-oidc-secrets.mjs`
 * spuštěný bez deklarace ohlásil 19 rozdílů v `aisha-edge`, `aisha-registry`,
 * `aisha-netbird` — cizí instanci — a s `--apply` by do nich zapsal tajemství
 * NAŠEHO Keycloaku. Táž třída shodila 2026-07-21 osm `aisha-*` aplikací.
 *
 * A pro upstream to bylo NEVIDITELNÉ: s prefixem „aisha" je špatné dosazení
 * k nerozeznání od správné hodnoty. Kdo je „aisha", to teď musí DEKLAROVAT taky.
 *
 * Neznámý cíl = STOP. Identitu deklaruj přes `APP_NAME_PREFIX` (nebo ji nech
 * odvodit `lib/coolify-instance-scope.mjs`, který čte všechny kanály najednou).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} e.g. "aisha" (upstream) nebo "tenant" (fork/story)
 * @throws {Error} když identita není deklarovaná
 */
export function appPrefix(env = process.env) {
  const prefix = asEnv(env).APP_NAME_PREFIX;
  if (!prefix) {
    throw new Error(
      "APP_NAME_PREFIX není deklarovaný — odmítám hádat, čí aplikace mám číst a měnit. " +
        "Na sdíleném Coolify znamená neznámá instance zápis do cizího nájemníka. " +
        "Deklaruj APP_NAME_PREFIX (i pro upstream: APP_NAME_PREFIX=aisha).",
    );
  }
  return prefix;
}

/**
 * Rewrite an upstream `aisha-<role>` app name to THIS deployment's prefix.
 * Non-aisha-prefixed strings (and non-strings) pass through unchanged, so the
 * function is safe to `.map()` over mixed arrays. Identity when prefix="aisha".
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function toStoryApp(name, env = process.env) {
  if (typeof name !== "string" || !name.startsWith("aisha-")) return name;
  return `${appPrefix(env)}-${name.slice("aisha-".length)}`;
}

/**
 * Strip THIS deployment's prefix from an app name, yielding the bare role
 * (e.g. "tenant-registry" → "registry"). Non-prefixed names pass through.
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function stripStoryPrefix(name, env = process.env) {
  const dash = `${appPrefix(asEnv(env))}-`;
  return typeof name === "string" && name.startsWith(dash) ? name.slice(dash.length) : name;
}
