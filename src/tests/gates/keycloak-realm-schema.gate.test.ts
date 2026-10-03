/**
 * Keycloak Realm Schema Compliance Gate
 *
 * Validates `keycloak/aisha-realm.json` against Keycloak's PostgreSQL schema
 * column limits. Realm import (`--import-realm`) on KC startup fails fatally
 * if any field exceeds its DB column length, leaving KC stuck in restart
 * loop with `running:healthy` (port-listener probe passes) but unable to
 * serve traffic — Traefik fails to register routes for an unstable container.
 *
 * Discovered: 2026-05-09 cold-start failure on `aisha-bootstrap` client:
 *   ERROR: value too long for type character varying(255)
 *   at update keycloak.CLIENT set DESCRIPTION=('Confidential client...')
 * The DESCRIPTION had 526 chars; column is varchar(255).
 *
 * Per user directive: "je strba to poresit o pro dalsi cold restart atp..
 * nejen jednorazove fixnout, ale vresit systemove" — every dependency we
 * rely on must have a test (echoes the dockerfile-cache-prefix gate
 * established earlier).
 *
 * Schema reference: Keycloak 26.x core PostgreSQL schema. Column limits
 * per https://github.com/keycloak/keycloak/tree/main/model/jpa/src/main/resources/META-INF/jpa-changelog-*.xml
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REALM_PATH = join(ROOT, "keycloak", "aisha-realm.json");

// ── Known fields of Keycloak's ClientRepresentation (26.0.7) ────────────────
// Jackson deserializes the realm import with FAIL_ON_UNKNOWN_PROPERTIES for
// this class, so ONE unknown key aborts the whole import — and with it the
// whole boot. The list below is not hand-guessed: it is the 44 properties
// Keycloak itself enumerates in that error message.
const CLIENT_FIELDS = new Set([
  "access", "adminUrl", "alwaysDisplayInConsole", "attributes",
  "authenticationFlowBindingOverrides", "authorizationServicesEnabled",
  "authorizationSettings", "baseUrl", "bearerOnly", "clientAuthenticatorType",
  "clientId", "clientTemplate", "consentRequired", "defaultClientScopes",
  "defaultRoles", "description", "directAccessGrantsEnabled",
  "directGrantsOnly", "enabled", "frontchannelLogout", "fullScopeAllowed",
  "id", "implicitFlowEnabled", "name", "nodeReRegistrationTimeout",
  "notBefore", "optionalClientScopes", "origin", "protocol",
  "protocolMappers", "publicClient", "redirectUris", "registeredNodes",
  "registrationAccessToken", "rootUrl", "secret", "serviceAccountsEnabled",
  "standardFlowEnabled", "surrogateAuthRequired", "type", "useTemplateConfig",
  "useTemplateMappers", "useTemplateScope", "webOrigins",
]);

// ProtocolMapperRepresentation — same strictness, much smaller surface.
const PROTOCOL_MAPPER_FIELDS = new Set([
  "config", "consentRequired", "consentText", "id", "name", "protocol",
  "protocolMapper",
]);

// KC PostgreSQL schema column max lengths for fields we set in realm JSON.
// These are the exact varchar(N) limits in keycloak.<TABLE>:
const COLUMN_LIMITS: Record<string, number> = {
  // CLIENT table
  "client.clientId": 255,
  "client.name": 255,
  "client.description": 255,
  "client.rootUrl": 255,
  "client.adminUrl": 255,
  "client.baseUrl": 255,
  // REALM table
  "realm.name": 255,
  "realm.displayName": 255,
  "realm.displayNameHtml": 4000,    // larger column
  // USER_ENTITY table
  "user.username": 255,
  "user.email": 255,
  "user.firstName": 255,
  "user.lastName": 255,
  // ROLE table
  "role.name": 255,
  "role.description": 255,
  // GROUP table
  "group.name": 255,
  // CLIENT_SCOPE table
  "client_scope.name": 255,
  "client_scope.description": 255,
  // IDENTITY_PROVIDER table
  "identity_provider.alias": 255,
  "identity_provider.displayName": 255,
};

interface Violation {
  path: string;
  field: string;
  length: number;
  limit: number;
  preview: string;
}

function checkField(obj: Record<string, unknown>, fieldKey: string, columnKey: string, ctxPath: string, violations: Violation[]) {
  const value = obj[fieldKey];
  if (typeof value !== "string") return;
  const limit = COLUMN_LIMITS[columnKey];
  if (!limit) return;
  if (value.length > limit) {
    violations.push({
      path: ctxPath,
      field: fieldKey,
      length: value.length,
      limit,
      preview: value.substring(0, 80) + (value.length > 80 ? "…" : ""),
    });
  }
}

describe("Keycloak Realm Schema Compliance Gate", () => {
  test("aisha-realm.json exists", () => {
    expect(existsSync(REALM_PATH)).toBe(true);
  });

  test("all CLIENT fields fit varchar limits (description ≤ 255 etc.)", () => {
    const realm = JSON.parse(readFileSync(REALM_PATH, "utf-8"));
    const violations: Violation[] = [];

    // Realm-level
    checkField(realm, "realm", "realm.name", "realm", violations);
    checkField(realm, "displayName", "realm.displayName", "realm", violations);
    checkField(realm, "displayNameHtml", "realm.displayNameHtml", "realm", violations);

    // Clients
    for (const client of realm.clients ?? []) {
      const ctx = `clients[clientId=${client.clientId}]`;
      checkField(client, "clientId", "client.clientId", ctx, violations);
      checkField(client, "name", "client.name", ctx, violations);
      checkField(client, "description", "client.description", ctx, violations);
      checkField(client, "rootUrl", "client.rootUrl", ctx, violations);
      checkField(client, "adminUrl", "client.adminUrl", ctx, violations);
      checkField(client, "baseUrl", "client.baseUrl", ctx, violations);
    }

    // Users
    for (const user of realm.users ?? []) {
      const ctx = `users[username=${user.username}]`;
      checkField(user, "username", "user.username", ctx, violations);
      checkField(user, "email", "user.email", ctx, violations);
      checkField(user, "firstName", "user.firstName", ctx, violations);
      checkField(user, "lastName", "user.lastName", ctx, violations);
    }

    // Roles
    for (const role of realm.roles?.realm ?? []) {
      const ctx = `roles.realm[name=${role.name}]`;
      checkField(role, "name", "role.name", ctx, violations);
      checkField(role, "description", "role.description", ctx, violations);
    }
    for (const [clientId, clientRoles] of Object.entries(realm.roles?.client ?? {})) {
      for (const role of clientRoles as Record<string, unknown>[]) {
        const ctx = `roles.client[${clientId}][name=${role.name}]`;
        checkField(role, "name", "role.name", ctx, violations);
        checkField(role, "description", "role.description", ctx, violations);
      }
    }

    // Groups
    for (const group of realm.groups ?? []) {
      checkField(group, "name", "group.name", `groups[name=${group.name}]`, violations);
    }

    // Client scopes
    for (const scope of realm.clientScopes ?? []) {
      const ctx = `clientScopes[name=${scope.name}]`;
      checkField(scope, "name", "client_scope.name", ctx, violations);
      checkField(scope, "description", "client_scope.description", ctx, violations);
    }

    // Identity providers
    for (const idp of realm.identityProviders ?? []) {
      const ctx = `identityProviders[alias=${idp.alias}]`;
      checkField(idp, "alias", "identity_provider.alias", ctx, violations);
      checkField(idp, "displayName", "identity_provider.displayName", ctx, violations);
    }

    expect(
      violations,
      `KC realm import would fail with "value too long for type character varying":\n` +
      violations.map((v) =>
        `  ${v.path}.${v.field}: ${v.length} chars (limit ${v.limit})\n      "${v.preview}"`,
      ).join("\n") +
      `\n\nShorten to fit the column limit. Move long descriptions to script header comments.`,
    ).toEqual([]);
  });

  test("no client carries a field Keycloak's ClientRepresentation does not know", () => {
    // 2026-08-02, PRODUCTION OUTAGE: a `"_note"` documentation key was added to
    // the `aisha-user-admin` client. Keycloak booted, connected to the DB,
    // started Infinispan — and then died on the realm import:
    //
    //   ERROR: Failed to run import
    //   ERROR: Unrecognized field "_note" (class ClientRepresentation),
    //          not marked as ignorable
    //
    // `restart: unless-stopped` turned that into a crash-loop, and because the
    // container never reached its health check, Coolify still reported the
    // deploy as finished. Auth was down until the field was removed.
    //
    // Why the existing gates missed it: they measure the LENGTH of values we
    // set, so their universe is "fields we already use". An unknown key is
    // outside that universe by construction — it can only be caught by
    // measuring the key set against what Keycloak accepts.
    //
    // Documentation belongs in `description` (varchar(255), checked above) or
    // in the commit message — NOT in an out-of-schema key. Note that free-form
    // maps like `attributes` and a mapper's `config` are Map<String,String> in
    // Keycloak, so any key there is legal and is deliberately NOT checked.
    const realm = JSON.parse(readFileSync(REALM_PATH, "utf-8"));
    const unknown: string[] = [];

    for (const client of realm.clients ?? []) {
      for (const key of Object.keys(client)) {
        if (!CLIENT_FIELDS.has(key)) {
          unknown.push(`clients[clientId=${client.clientId}].${key}`);
        }
      }
      for (const mapper of client.protocolMappers ?? []) {
        for (const key of Object.keys(mapper)) {
          if (!PROTOCOL_MAPPER_FIELDS.has(key)) {
            unknown.push(
              `clients[clientId=${client.clientId}].protocolMappers[name=${mapper.name}].${key}`,
            );
          }
        }
      }
    }

    expect(
      unknown,
      `Realm import would abort with "Unrecognized field ... not marked as ignorable",\n` +
      `and Keycloak would crash-loop on every boot:\n` +
      unknown.map((u) => `  ${u}`).join("\n") +
      `\n\nPut the rationale in the client's "description" or in the commit message.`,
    ).toEqual([]);
  });

  test("cold-start scripts use master realm admin-cli (not netbird-backend SA) for KC admin API", () => {
    // Cold-start scripts that need Keycloak admin privileges (creating
    // users, fetching client secrets, resetting passwords) MUST authenticate
    // via master realm admin-cli with KEYCLOAK_ADMIN/KEYCLOAK_ADMIN_PASSWORD,
    // not via the netbird-backend service account.
    //
    // Why: netbird-backend's role is IDP user-sync for NetBird. Coupling
    // cold-start scripts to its service account would force the SA to have
    // realm-management roles (view-clients, manage-clients) it doesn't need
    // for its actual job. Worse: KC's --import-realm OVERWRITE_EXISTING
    // strategy does NOT update existing service account role assignments,
    // so adding roles in realm.json doesn't take effect on re-imports —
    // making the dependency fragile across cold-starts.
    //
    // Master admin via admin-cli has universal privileges by definition
    // (KEYCLOAK_ADMIN bootstraps it on first KC startup) and is realm-
    // independent, so it stays correct even when realm.json changes.
    const bootstrap = readFileSync(
      join(process.cwd(), "scripts/aisha-bootstrap-user-init.sh"),
      "utf-8",
    );
    const provision = readFileSync(
      join(process.cwd(), "scripts/provision-sso.sh"),
      "utf-8",
    );

    // Both scripts must hit /realms/master/protocol/openid-connect/token
    // with admin-cli (not netbird-backend client_credentials).
    expect(
      bootstrap,
      "aisha-bootstrap-user-init.sh MUST acquire admin token via master/admin-cli password grant — not netbird-backend client_credentials.",
    ).toMatch(/realms\/master\/protocol\/openid-connect\/token[\s\S]+?client_id=admin-cli/);

    expect(
      provision,
      "provision-sso.sh MUST acquire admin token via master/admin-cli password grant.",
    ).toMatch(/realms\/master\/protocol\/openid-connect\/token[\s\S]+?client_id=admin-cli/);

    // Neither should use netbird-backend client_credentials for KC admin API
    // (it's reserved for NetBird's IDP user-sync).
    expect(
      bootstrap,
      "aisha-bootstrap-user-init.sh must not use netbird-backend service account for KC admin API — that role is reserved for NetBird IDP user-sync. Use master admin-cli instead.",
    ).not.toMatch(/client_id=netbird-backend[\s\S]+?client_secret=/);
  });
});
