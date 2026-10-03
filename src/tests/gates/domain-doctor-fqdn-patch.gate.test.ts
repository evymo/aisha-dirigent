/**
 * Domain-Doctor Apply — never PATCH `fqdn`, isolate per-app failures
 *
 * WHY (incident 2026-07-17, cold-start --wipe):
 *   coolify-domain-doctor.mjs `--apply` re-asserts each app's routing via a
 *   PATCH to /applications/{uuid}. It used to add `fqdn: null` to the body when
 *   an app carried a stale UUID-default fqdn ("canonicalise to the working aisha
 *   shape"). The Coolify applications PATCH endpoint REJECTS any `fqdn` key with
 *   HTTP 422 "Validation failed — fqdn: This field is not allowed" — even
 *   `fqdn:null`. That throw was uncaught, and the apply loop had NO per-app
 *   isolation, so it aborted mid-batch: every app iterated after the offender
 *   (aisha-keycloak included) got ZERO domains registered. Keycloak with no
 *   docker_compose_domains → Traefik has no router for auth.backend.<tld> → 404
 *   on OIDC discovery → Phase B keycloak-bootstrap blocked forever → the whole
 *   dependent stack (admin, ai-chat, orchestration, …) stranded unhealthy.
 *
 *   A stale UUID-default fqdn is only a redundant extra router on a *.<tld> host
 *   nobody routes auth through; it does NOT shadow the canonical
 *   docker_compose_domains routers (verified in prod: every healthy aisha app
 *   carries a UUID-default fqdn and still routes correctly). So fqdn is never
 *   worth touching — and cannot be, via this endpoint.
 *
 * This gate pins two invariants that together make the incident non-recurring:
 *   1) the apply-time /applications PATCH body NEVER carries an `fqdn` key;
 *   2) each app's apply is wrapped so one app's failure fails LOUD in the
 *      report but never aborts registration for the remaining apps.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DOCTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");

describe("Domain-Doctor Apply — no fqdn PATCH, per-app isolation", () => {
  const src = readFileSync(DOCTOR, "utf-8");

  test("never assigns `body.fqdn` (Coolify applications PATCH rejects the fqdn field, HTTP 422)", () => {
    expect(
      src,
      "coolify-domain-doctor MUST NOT assign `body.fqdn` — the Coolify /applications PATCH endpoint rejects any fqdn key (HTTP 422 'This field is not allowed').",
    ).not.toMatch(/\bbody\.fqdn\b/);
  });

  test("never sends `fqdn: null` (the exact regression that stranded keycloak)", () => {
    expect(
      src,
      "coolify-domain-doctor MUST NOT send `fqdn: null` in any PATCH body — it 422s and, uncaught, aborts the apply batch mid-loop.",
    ).not.toMatch(/fqdn\s*:\s*null/);
  });

  // Bound the apply else-if branch: from its `else if` to the live-routing-probe section
  // that follows the contract loop. Anchoring on the probe banner (rather than the first
  // `reports.push`, which now also occurs INSIDE the branch's fail-loud guards) keeps the
  // window stable, scopes assertions to the apply branch so unrelated fqdn reads elsewhere
  // (app.fqdn, isUuidDefaultFqdn, report.fqdnDrift, fqdnConflicts) can't false-trip, and
  // never truncates the try/catch the way a fixed char window did.
  const applyBranch = (() => {
    const start = src.indexOf("else if (APPLY && drift.length > 0)");
    const end = src.indexOf("// PRIMARY ARBITER", start);
    return start > -1 && end > start ? src.slice(start, end) : "";
  })();

  // The PATCH body is built as a `const body = { ... }` object, so assert on that
  // declaration rather than on a char window around the coolify() call — the window
  // would sweep in the branch's explanatory comments (which legitimately discuss fqdn).
  const bodyDecl = applyBranch.match(/const\s+body\s*=\s*\{[^}]*\}/)?.[0] ?? "";

  test("the /applications apply PATCH body re-asserts docker_compose_domains only — never an fqdn key", () => {
    expect(applyBranch, "could not bound the apply else-if branch in domain-doctor").not.toBe("");
    expect(bodyDecl, "could not locate the `const body = { ... }` PATCH payload in the apply branch").not.toBe("");
    expect(
      bodyDecl,
      "the apply PATCH body must NOT carry an fqdn key — Coolify rejects it with HTTP 422:\n" + bodyDecl,
    ).not.toMatch(/fqdn/);
    expect(
      bodyDecl,
      "the apply PATCH body must (re)assert docker_compose_domains.",
    ).toMatch(/docker_compose_domains/);
    // force_domain_override is set separately (on retry) and is a legitimate key.
    expect(applyBranch, "apply must PATCH /applications/${app.uuid}").toMatch(
      /coolify\(`\/applications\/\$\{app\.uuid\}`/,
    );
  });

  test("`.invalid` sentinels are filtered out of the apply payload (cross-tenant Coolify domain conflict)", () => {
    // Coolify indexes every docker_compose_domains value as a REAL, globally-unique
    // domain. Our resolver emits an unroutable `.invalid` host to mean "this service has
    // no public domain" — and every fork ships the IDENTICAL sentinel string, so Coolify
    // sees two tenants claiming it and answers "Domain conflicts detected", dropping the
    // ENTIRE payload. Prod 2026-07-17: aisha-edge's 3-entry payload was rejected wholesale
    // (conflict named tenant-studio-edge on mesh-router-disabled.invalid:80) so edge kept
    // ZERO routes → auth.<public> 404 → NetBird's AUTH_AUTHORITY unreachable → Phase D and
    // every downstream wave stalled. The same payload minus the sentinel persisted first try.
    expect(
      src,
      "domain-doctor must define a sentinel detector for the reserved `.invalid` TLD.",
    ).toMatch(/isSentinelDomain/);
    expect(
      src,
      "domain-doctor must derive a `routable` set that excludes .invalid sentinels before computing drift/payload.",
    ).toMatch(/const\s+routable\s*=\s*contract\.domains\.filter\([\s\S]{0,60}?isSentinelDomain/);
    expect(
      bodyDecl,
      "the apply PATCH body must send the sentinel-filtered `routable` set, never raw contract.domains:\n" + bodyDecl,
    ).toMatch(/docker_compose_domains:\s*routable/);
    expect(
      applyBranch,
      "the apply PATCH body must NOT send raw contract.domains (that re-introduces the sentinel).",
    ).not.toMatch(/docker_compose_domains:\s*contract\.domains/);
  });

  test("unexpanded `${VAR}` contract domains are filtered out and BLOCK the apply", () => {
    // A contract entry only expands when that service's env is in scope. The doctor
    // is routinely run scoped (--only=<app>) or from a shell carrying one stack's
    // env, so the other contracts keep the literal — measured 2026-08-08: a run with
    // only the edge env exported yielded `https://${NOCODB_DOMAIN:-}:8080` and eight
    // more like it as `desired`. Coolify accepts such a string as a REAL domain, so
    // Traefik would route a host nobody can resolve: the service looks deployed and
    // is unreachable. Worse, docker_compose_domains is the COMPLETE set, so writing
    // the subset that did expand DELETES the rest of that app's routes.
    expect(
      src,
      "domain-doctor must define a detector for contract domains whose ${VAR} never expanded.",
    ).toMatch(/isUnresolvedDomain/);
    expect(
      src,
      "the `routable` set (what the PATCH sends) must exclude unresolved ${VAR} entries, not just .invalid sentinels.",
    ).toMatch(/routable[\s\S]{0,200}?!isUnresolvedDomain/);
    expect(
      src,
      "unresolved entries must be surfaced on the report — a silently dropped route is how this stays invisible.",
    ).toMatch(/report\.unresolved\s*=/);
    // The guard must come BEFORE the drift branch that PATCHes, or a partial write
    // still happens. Ordering, not mere presence, is the invariant.
    const unresolvedGuard = src.indexOf("APPLY && unresolved.length > 0");
    const driftApply = src.indexOf("else if (APPLY && drift.length > 0)");
    expect(unresolvedGuard, "apply must be guarded on unresolved ${VAR} entries.").toBeGreaterThan(-1);
    expect(
      unresolvedGuard,
      "the unresolved-${VAR} guard must precede the drift branch, otherwise the partial payload is still PATCHed.",
    ).toBeLessThan(driftApply);
  });

  test("the apply verifies the PATCH actually persisted (Coolify returns 200 and silently drops it)", () => {
    // feedback_coolify_api_quirks: PATCH may return 200 while docker_compose_domains is
    // silently NOT persisted. deploy-init's set_coolify_domains has always retried +
    // verified; the doctor must too, or it reports "domains in sync" over an app with no
    // routes at all (exactly what masked the 2026-07-17 edge outage).
    expect(
      applyBranch,
      "apply must re-read the app after PATCHing and confirm the value stuck (never trust the 200).",
    ).toMatch(/persisted/);
    expect(
      applyBranch,
      "apply must retry the PATCH when Coolify drops the value silently.",
    ).toMatch(/attempt\s*<=\s*3|for\s*\(\s*let\s+attempt/);
    expect(
      applyBranch,
      "a value that refuses to persist must FAIL LOUD via report.applyError, never be reported as applied.",
    ).toMatch(/did not persist/i);
  });

  test("an all-sentinel contract never PATCHes an empty array (Coolify silently ignores it)", () => {
    expect(
      applyBranch,
      "apply must refuse to PATCH when no routable domains remain, rather than sending an empty array Coolify ignores.",
    ).toMatch(/routable\.length\s*===\s*0/);
  });

  test("per-app apply failure is isolated (try/catch → report.applyError) so one app never strands the batch", () => {
    expect(applyBranch, "could not bound the apply else-if branch in domain-doctor").not.toBe("");
    expect(applyBranch, "apply branch must wrap the PATCH in try { … }").toMatch(/\btry\s*\{/);
    expect(applyBranch, "apply branch must catch per-app errors").toMatch(/\}\s*catch\s*\(/);
    expect(
      applyBranch,
      "a caught per-app apply error must be recorded LOUD as report.applyError (surfaced by the residual-drift summary + live routing probe).",
    ).toMatch(/report\.applyError\s*=/);
  });
});
