// =============================================================================
// env-completeness.mjs — detect compose ${VAR} refs that silently resolve to ""
// =============================================================================
// Pure, side-effect-free. Shared by:
//   - scripts/local-compose-gen.mjs                       (hard-fail at generation)
//   - src/tests/gates/local-env-completeness.gate.test.ts
//
// WHY — the local-warmup root-cause class (the KEYCLOAK_DOMAIN_PUBLIC bug fixed
// in PR #336): a bare `${VAR}` referenced in a Coolify compose file but absent
// from config/local-presets.mjs devEnvDefaults is substituted by `docker compose
// config` with a BLANK STRING + only a stderr warning — so malformed config
// (empty hosts/secrets) reaches the running stack silently.
//
// REQUIRED vars (`${VAR:?msg}`) already make `docker compose config` EXIT NON-ZERO,
// so the generator already fails on those. The gap this closes is the BARE
// `${VAR}` form, which only WARNS. The most reliable signal is docker's own
// warning (it already handles `$$` escapes, `$VAR` vs `${VAR}`, comments, block
// scalars) — so we parse that rather than re-implementing compose interpolation.
// =============================================================================

/**
 * Extract the variable names from `docker compose config` "… variable is not set"
 * warnings. Handles docker's logfmt escaping where the name is wrapped in
 * (possibly backslash-escaped) quotes, e.g.:
 *   level=warning msg="The \"KEYCLOAK_DOMAIN_PUBLIC\" variable is not set. …"
 * @param {string} stderr
 * @returns {string[]} sorted, de-duplicated variable names
 */
export function parseUnsetVarWarnings(stderr) {
  const out = new Set();
  // optional backslash + optional quote around an UPPER_SNAKE name, then
  // " variable is not set"
  const re = /\bThe\s+\\?"?([A-Z][A-Z0-9_]*)\\?"?\s+variable is not set/g;
  let m;
  while ((m = re.exec(String(stderr ?? ""))) !== null) out.add(m[1]);
  return [...out].sort();
}
