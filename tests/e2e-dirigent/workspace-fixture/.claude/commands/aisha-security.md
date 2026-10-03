# AISHA — Security Review (OWASP + STRIDE)

An adversarial security pass over a change. Leans on the platform's existing
**AITG** trust gates (`svc-aitg-probes`, `aitg_*` MCP tools, `npm run gate:owasp`)
instead of reinventing them. Zero-noise: every finding needs a concrete exploit
scenario and high confidence before it's reported.

## Arguments: $ARGUMENTS

## Instructions

1. **Scope** from `$ARGUMENTS` (empty → branch vs main, or a path / `staged`).

2. **Orient** before reviewing: call `mcp__aisha-knowledge__aitg_health_summary`
   for the current trust score, open findings, and drift alerts so the review
   targets real weaknesses, not noise.

3. **Threat-model the change** — OWASP Top 10 + STRIDE (Spoofing, Tampering,
   Repudiation, Information disclosure, Denial of service, Elevation). For each
   candidate finding require: a concrete exploit scenario + ≥8/10 confidence,
   else drop it.

4. **Check against platform invariants**:
   - Secrets never in code (CLAUDE.md → *No Secrets in Code*; cross-check `.gitleaks.toml`)
   - Parameterized access only — RPC `SECURITY DEFINER` + `REVOKE/GRANT` pattern, no string-built SQL
   - Least privilege — RLS, namespace ACL, scoped service roles (CLAUDE.md → *Principle of Least Privilege*)
   - **New data source?** It MUST pass enterprise source onboarding — classification,
     consent, namespace ACL, approval flow (CLAUDE.md → *Enterprise Source Onboarding*,
     `docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md`). Flag any bypass.

5. **Run the gates**: `npm run gate:owasp` and `npm run test:security`. For a
   suspected weakness, fire a targeted probe via `mcp__aisha-knowledge__aitg_run_test`
   (e.g. AITG-APP-01/03/12, AITG-DAT-02). For agent-facing text, run
   `aitg_classify_response` (prompt-injection / canary-leak / toxicity).

6. **Remediation goes through the approval gate** — never silently patch security
   findings. Attach proposals with `mcp__aisha-knowledge__aitg_propose_remediation`
   (or list/track via `aitg_list_open_findings`). Human review required before any
   code change lands.

7. **Output** — per finding: STRIDE category · severity · `file:line` · exploit
   scenario · remediation · confidence. End with the resulting trust posture.

---
_Origin: methodology adapted from gstack's `/cso` (MIT, Garry Tan), re-pointed at
AISHA's AITG / OWASP gates and onboarding governance. No gstack code is vendored._
