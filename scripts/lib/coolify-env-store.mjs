/**
 * coolify-env-store.mjs — treat Coolify runtime env as the persistent secret
 * store (the ONLY place secret VALUES live). Thin helpers over the shared
 * createCoolifyClient() so reconcilers (mesh IPs, OIDC secrets) read/patch app
 * env consistently — with retry/timeout — instead of re-implementing fetch.
 *
 * Design invariants:
 *   - NEVER add a key to an app that does not already have it (no guessing
 *     which app "should" hold a secret; only converge existing copies).
 *   - NEVER patch an empty value over a non-empty one.
 *   - Bulk PATCH mirrors the shape coolify-mesh-sync.mjs uses (validated in prod).
 *   - Callers must not log secret VALUES — only key + app + drift booleans.
 */
import { createCoolifyClient } from "./coolify-http.mjs";
import { appPrefix } from "./story-app.mjs";
import { hodnotaZCoolify } from "./coolify-env-hodnota.mjs";

/**
 * @param {{baseUrl:string, token:string, timeoutMs?:number}} cfg
 */
export function createEnvStore({ baseUrl, token, timeoutMs = 60000 }) {
  const coolify = createCoolifyClient({ baseUrl, token, timeoutMs });
  return {
    /**
     * Applications belonging to THIS deployment's namespace.
     *
     * The prefix comes from lib/story-app.mjs, the single source of truth for
     * the donor→instance remap, not from a literal. A hardcoded "aisha-" here
     * matched nothing on any fork — and it did so SILENTLY, returning an empty
     * list that reads exactly like "this project has no apps". story-app.mjs's
     * own header documents this failure class; the reverse-sync that feeds the
     * pre-wipe vault was still an instance of it, so a fork's wipe backed up
     * zero server-side secrets and said only "stack partially down?".
     *
     * Name kept for its callers; it means "this instance's apps", which on the
     * upstream instance is still literally the aisha-* ones.
     */
    async listAishaApps() {
      const apps = await coolify("/applications");
      const dash = `${appPrefix()}-`;
      return (apps || []).filter((a) => typeof a.name === "string" && a.name.startsWith(dash));
    },
    /** Raw env entries for an app: [{key, value, uuid, is_preview, ...}]. */
    getAppEnv(uuid) {
      return coolify(`/applications/${uuid}/envs`);
    },
    /** Bulk-PATCH the full merged env array (Coolify replaces in place). */
    patchBulk(uuid, data) {
      return coolify(`/applications/${uuid}/envs/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ data }),
      });
    },
    raw: coolify,
  };
}

/** Production (non-preview) value for a key, or "" if absent. */
export function envValue(envs, key) {
  const prod = (envs || []).find((e) => e.key === key && e.is_preview !== true);
  if (prod) return prod.value ?? "";
  const any = (envs || []).find((e) => e.key === key);
  return any?.value ?? "";
}

/**
 * Production-ONLY value: the value the running app actually uses. Returns null
 * when the key has no production entry (absent, or exists only as a preview
 * entry). Drift reconciliation MUST use this — mergeEnvValue only rewrites
 * production entries, so detecting drift on a preview-only key would report a
 * fix that never happens (permanent --check flap). Keeps detection and healing
 * on the same set of entries.
 */
export function productionValue(envs, key) {
  const prod = (envs || []).find((e) => e.key === key && e.is_preview !== true);
  return prod ? (prod.value ?? "") : null;
}

/**
 * Production-ONLY value, DECODED from `real_value` — the actual secret the running
 * app uses. `real_value` is the .env RENDERING (literal → `'…'`, else escaped), so
 * it goes through hodnotaZCoolify (coolify-env-hodnota.mjs), never raw. Use THIS for
 * reverse-sync / vault reconstruction where you need the value itself, not
 * productionValue() (which reads `.value` only, for drift-vs-generated compares).
 * Returns null when the key has no production entry.
 */
export function productionRealValue(envs, key) {
  const prod = (envs || []).find((e) => e.key === key && e.is_preview !== true);
  if (!prod) return null;
  return hodnotaZCoolify(prod);
}

/** True when the key exists at all in the app env (production or preview). */
export function hasKey(envs, key) {
  return (envs || []).some((e) => e.key === key);
}

/**
 * Produce a merged env array setting `key`→`value` on its production entries.
 * Returns { merged, changed }. Does NOT add the key if absent, and refuses to
 * write an empty value (changed:false) — the two safety invariants above.
 */
export function mergeEnvValue(envs, key, value) {
  if (value === undefined || value === null || value === "") {
    return { merged: envs, changed: false };
  }
  let changed = false;
  const merged = (envs || []).map((e) => {
    if (e.key === key && e.is_preview !== true && e.value !== value) {
      changed = true;
      return { ...e, value, is_literal: true };
    }
    return { ...e };
  });
  return { merged, changed };
}
