# Source → aisha federation

How a source community member logs into the aisha stack with their **source
credentials** and becomes an authorized, scoped user — their legitimacy
established by verifying through the source backend.

## The legitimacy chain

```
member enters email
   → broker /auth/source/start → source startOnboarding → OTP email
member enters OTP code
   → broker /auth/source/login
       → source verifyOnboarding(code)   [X_ONBOARDING_TOKEN]  ← source verifies the member
       → source sourceJwt(mantra)         [X_ONBOARDING_TOKEN]  ← proof of session
       → broker resolves AUTHORITATIVE identity (source-postgres lookup by email)
       → broker provisions aisha identity (audience_provision_federated_member RPC)
       → broker ISSUES aisha session (mintAishaSession):
            PRIMARY   gateway POST /token-exchange  (gateway mints, broker holds no secret)
            FALLBACK  broker mints HS256 itself      (dev/local; role=authenticated)
member uses aishaToken
   → PostgREST → RLS (auth.uid() = sub) → sees ONLY their own data; NOT admin
```

**The member is authorized precisely because they verified through the source
backend as a community member.** The broker never trusts client-supplied
identity — the source UUID + email come from the verified onboarding + an
authoritative source-postgres lookup, not the request body.

## How the session is issued — least-privilege first

Aisha's real auth path: Keycloak (OIDC/RS256) → **aisha-gateway** validates +
**re-signs HS256** → PostgREST (HS256 shared secret). The gateway is the trusted
backend that issues PostgREST sessions after verifying identity. It exposes
`POST /token-exchange` as the **mint primitive** for internal services: given a
verified email (and the shared intranet key), it mints a `role=authenticated`
session — and *only* that. It hardcodes the role and looks the email up in aisha
first, so it can never mint admin/`service_role` or a session for a
non-existent user.

`mintAishaSession()` uses that primitive **first**:

| | Path | Who signs | What the broker holds | When |
|---|---|---|---|---|
| **PRIMARY** | gateway `POST /token-exchange` | the **gateway** | only the intranet key (a constrained "mint authenticated for this email" capability) | prod, and anywhere `AISHA_GATEWAY_INTRANET_KEY` is set |
| **FALLBACK** | broker mints HS256 (`jose`) | the **broker** | the full `PGRST_JWT_SECRET` (can technically sign any claim) | dev/local, where the gateway's key isn't wired |

The PRIMARY path is strictly **least-privilege**: the master signing secret stays
in the gateway, and the broker's capability is reduced to "mint a *member*
session for an *already-verified, already-provisioned* email." The FALLBACK exists
so the federation stays testable end-to-end locally without the gateway — it is a
legitimate trusted-issuer pattern (same `role=authenticated`, same shape), not a
new trust boundary.

Keycloak remains the identity registry: the member is also JIT-provisioned there.
Optional further hardening (Keycloak-issued sessions via token-exchange
impersonation) is configured by `make keycloak-impersonation-setup` — see
"Hardening".

## Security properties

| Property | How |
|---|---|
| No session without source verification | session issued only after `verifyOnboarding` + `sourceJwt` succeed |
| Identity not client-trusted | source UUID/email from verified onboarding + source-postgres lookup |
| Member is never admin | issued token is `role=authenticated`; `is_admin_or_staff(member)=false` |
| Master secret not held (PRIMARY path) | the gateway signs; the broker holds only the constrained intranet key — it cannot forge a role or mint for a non-existent user |
| Member sees only own data | PostgREST RLS scopes on `auth.uid() = sub` |
| Non-members rejected | `getMemberByEmail` returns null → 403 `not_a_member` |
| Reply mantra validated | per CLAUDE.md, the sourceJwt reply mantra is checked |
| Provisioning is least-privilege | `audience_provision_federated_member` is SECURITY DEFINER, broker-writer/service_role only; event trigger auto-revokes PUBLIC/anon |

## Roles

| Who | How they auth | Role | Sees |
|---|---|---|---|
| **Community member** | source credentials → broker federation | `authenticated`, scoped | own tier, own audience, own timeline (RLS) |
| **Marketer / operator** | Keycloak (Appsmith SSO) directly | admin/staff | all audience admin views + RPCs |

A member *could* be elevated to staff (Keycloak role) for the marketing team —
that's a separate, higher access level granted in Keycloak, not via this flow.

## Verify it

```bash
make aisha-test-federation     # full E2E: member login → scoped session → own data
```

Asserts: onboarding → OTP (Mailhog) → login → `role=authenticated` +
`source_member=true` token → member reads own tier (200) → `is_admin_or_staff`
is false.

## Config

| Env (broker) | Meaning |
|---|---|
| `AISHA_GATEWAY_URL` | gateway base URL for the PRIMARY mint path. Prod `http://gateway:3001`; local `http://host.docker.internal:57421` (published port). |
| `AISHA_GATEWAY_INTRANET_KEY` | shared intranet key the gateway reads as `INTRANET_API_KEY`. Set → broker uses the gateway `/token-exchange`. Empty → skips to the fallback. |
| `AISHA_JWT_SECRET` | FALLBACK HS256 secret = aisha `PGRST_JWT_SECRET`. Used only when the gateway path is unavailable. Empty → with no gateway key either, federation returns sourceToken only. |
| `AISHA_JWT_EXP_SEC` | fallback member session TTL (default 3600) |
| `AISHA_MEMBER_ROLE` | always `authenticated` (members are never admin) |

Production posture: set `AISHA_GATEWAY_INTRANET_KEY`, leave `AISHA_JWT_SECRET`
unset → all minting flows through the gateway, the broker never holds the master
secret.

Local dev sources these from `_platform/.env-local-keycloak`.

## Hardening / future

- **Gateway-issued sessions (PRIMARY path, wired)**: `mintAishaSession()` calls
  the gateway `POST /token-exchange` first, so in production the broker never
  holds `PGRST_JWT_SECRET`. Enabling it is one gateway env flag,
  `INTRANET_API_KEY` (the gateway code reads `INTRANET_API_KEY`; the compose
  historically set only `INTERNAL_API_KEY` — an upstream naming typo. The gateway
  compose now aliases `INTRANET_API_KEY: ${INTRANET_API_KEY:-${INTERNAL_API_KEY}}`
  so the endpoint is enabled on the next deploy with zero new secrets).
  - **Why local dev still uses the FALLBACK**: the local aisha stack is a
    Coolify-managed deployment whose full secret env (`KC_CLIENT_SECRET`,
    `OIDC_CLIENT_SECRET`, …) is injected by Coolify, not reproducible from the
    repo env-files. A naive `docker compose up gateway` to flip the flag would
    blank those secrets and break OIDC. So locally the broker falls back to its
    own HS256 mint (safe, `role=authenticated`), and the gateway path activates
    automatically the next time the gateway is deployed through Coolify with the
    key set. The gateway path is covered by `mint-session.test.ts` (mocked).
- **Keycloak-issued sessions (optional, configured)**: an even stronger posture
  is Keycloak token-exchange *impersonation* (broker → real Keycloak token for
  the member). The permission chain is configured by
  `make keycloak-impersonation-setup` (verified working). It is KC-side config
  and does not sit on the critical federation path, so it is kept as a documented
  optional capability rather than wired into every login.
- **GraphQL contract test**: the broker auth route was once built against a
  fabricated source schema (`startOnboarding{token}`, `sourceJwt(mantra,email,
  password)`). Now corrected to the real OTP schema. A schema-introspection
  contract test (the GraphQL analog of the PG drift canary) would catch this
  class of drift — tracked as a follow-up.
- **Pre-existing aisha RLS bug**: members querying some *admin* views hit
  `42P17 infinite recursion in policy for relation story_participants` (an
  aisha-core RLS bug, not federation). It's a denial (no data), but messy;
  members shouldn't query admin views anyway. Flagged for aisha core.
