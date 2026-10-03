# Keycloak ↔ Source-api federation design

## Goal

Source members log into the aisha audience intranet (Appsmith) with their existing
source credentials, no separate signup. Keycloak (aisha's auth) federates
identity from source-api, mirroring how Google/Apple are already wired as
external IdPs in `keycloak/aisha-realm.json`.

## Constraint: source-api stays untouched

We do **not** modify source-api to add an OIDC `.well-known/openid-configuration`
endpoint. Source-api uses simplejwt with mantra + GraphQL `sourceJwt` mutation,
which is its own protocol — not standard OIDC. So Keycloak's built-in OIDC
IdP entry (which we use for Google + Apple) won't fit out of the box.

## Two viable paths

### Path A — Custom Keycloak User Storage SPI (recommended for production)

Implement a small Keycloak SPI (Java/Kotlin) that:

1. On user login attempt with source-style email, intercepts via
   `UserStorageProvider` interface
2. Calls source-api's 3-step flow: `startOnboarding` → `verifyOnboarding` →
   `sourceJwt` mutation (mantra-validated)
3. On success: provisions a Keycloak user (one-shot, then password is local)
   OR continues to call source-api on every login (no local password)
4. Returns Keycloak-side `UserModel` for session management

Pros: clean, standard Keycloak federation pattern, full SSO experience.
Cons: requires Kotlin/Java module + rebuild Keycloak image with custom SPI.

Out of scope this iteration. Tracked as future deliverable.

### Path B — Aisha-side login proxy (interim, no source-api changes)

The audience intranet has a "Sign in with Source" button that:

1. POSTs to svc-source-broker `/auth/source-login` (new endpoint to add)
2. Broker performs the 3-step source login on behalf of user (passing through
   email + verification code + password from the user, NOT broker's service
   credentials)
3. On success, broker returns the user's source JWT
4. The audience intranet exchanges the source JWT for a Keycloak token via a
   **Token Exchange** flow (Keycloak feature for B2B / federation scenarios)

Pros: works today without custom SPI; reuses Keycloak Token Exchange (already
supported feature in keycloak-25+); doesn't touch source-api.
Cons: less polished UX (user goes through aisha-side flow, not native
"Federated IdP" button); Token Exchange must be enabled in realm config.

## Realm config patch (Path B prereq)

Add to `keycloak/aisha-realm.json` (in `clients` array — new client for the
broker):

```json
{
  "clientId": "svc-source-broker",
  "enabled": true,
  "publicClient": false,
  "serviceAccountsEnabled": true,
  "directAccessGrantsEnabled": false,
  "clientAuthenticatorType": "client-secret",
  "secret": "${SVC_SOURCE_BROKER_CLIENT_SECRET}",
  "attributes": {
    "token.exchange.permission.enabled": "true",
    "token.exchange.allow.subject.token.types": "urn:ietf:params:oauth:token-type:jwt",
    "token.exchange.audience": "aisha-app"
  }
}
```

Plus, in the realm-level config:

```json
"attributes": {
  "tokenExchange": "enabled"
}
```

## Token Exchange call (broker → keycloak, for Path B)

```
POST /realms/aisha/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<source-jwt>
&subject_token_type=urn:ietf:params:oauth:token-type:jwt
&audience=aisha-app
&client_id=svc-source-broker
&client_secret=<broker-secret>
```

Returns a Keycloak-signed JWT representing the same user, which the audience intranet
frontend uses as its session token.

## Identity mapping

Source-user UUID → Keycloak user UUID. Two strategies:

1. **One-shot provisioning** (simpler): on first source login, broker creates
   matching Keycloak user via Admin REST API (with source-uuid as
   `federationLink` attribute). Subsequent logins just exchange tokens.
2. **No local user** (Token Exchange minimal): Keycloak issues "external-only"
   token with claims derived from source JWT, no UserModel stored.

Recommended for now: strategy 1. Easier to attach Keycloak roles, audit log
through standard Keycloak admin UI.

## What we add NOW (this iteration)

- `keycloak/source-federation-template.json` — config snippet to merge into
  `aisha-realm.json` (commented, off by default)
- `services/svc-source-broker/src/routes/auth.ts` — new route stub
  `/auth/source-login` with the 3-step flow proxying to source-api
- This document (design rationale)

## What needs follow-up

- Implement Token Exchange call in broker `/auth/source-login` happy path
- Enable Token Exchange in realm (one-time admin op)
- Frontend "Sign in with Source" button + flow in Appsmith / aisha login screen
- (Optional, deferred) Custom Keycloak SPI for native federation UX
