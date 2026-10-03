/**
 * Keycloak Realm Column Limits Gate
 *
 * OWNS: authored string lengths in keycloak/aisha-realm.json.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * Every authored field that Keycloak stores in a varchar(255) column must fit
 * in 255 characters.
 *
 * ── WHY (2026-07-19, cost: one whole stack) ───────────────────────────────
 * Keycloak does NOT truncate an over-length value. The realm import throws
 *
 *   SQLState 22001 — ERROR: value too long for type character varying(255)
 *   ERROR: Failed to start server in (production) mode
 *
 * and the process exits. So the failure is not "a description got clipped", it
 * is "the identity provider never starts".
 *
 * The blast radius on the 2026-07-19 cold start, from ONE 454-character
 * `description` on the `aisha first broker login` flow:
 *
 *   realm import fails
 *     → Keycloak crash-loops (only its JGroups port ever opened; nothing on 80)
 *       → no OIDC discovery, /realms/* all 404
 *         → NetBird cannot enrol (enrolment authenticates against Keycloak)
 *           → mesh never comes up
 *             → edge Caddy cannot reach mesh-router → api/mcp serve 502
 *               → every wave-4 app fails its OIDC gate
 *
 * And Coolify reported the app `running:healthy` throughout, because the
 * container was up and its healthcheck was still in `starting`. Nothing in the
 * stack pointed at a 255-character column.
 *
 * ── WHY A TARGETED FIELD LIST, NOT "every string ≤ 255" ───────────────────
 * A blanket check would be wrong, not merely noisy: realm JSON legitimately
 * carries long values in columns that are TEXT/CLOB — signing certificates,
 * public keys, component config blobs. Flagging those would train people to add
 * exceptions, and an exception list is how a gate stops meaning anything.
 * So this pins the fields we AUTHOR that map to varchar(255), taken from
 * Keycloak's schema. When a new authored field appears, add it here — the last
 * test fails if the realm grows a top-level section this list ignores.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REALM_PATH = join(ROOT, "keycloak/aisha-realm.json");
const VARCHAR_255 = 255;

interface Realm {
  realm?: string;
  displayName?: string;
  loginTheme?: string;
  accountTheme?: string;
  emailTheme?: string;
  authenticationFlows?: { alias?: string; description?: string }[];
  clients?: {
    clientId?: string;
    name?: string;
    description?: string;
    rootUrl?: string;
    baseUrl?: string;
    adminUrl?: string;
    redirectUris?: string[];
    webOrigins?: string[];
  }[];
  roles?: {
    realm?: { name?: string; description?: string }[];
    client?: Record<string, { name?: string; description?: string }[]>;
  };
  groups?: { name?: string }[];
  identityProviders?: { alias?: string; displayName?: string }[];
  [key: string]: unknown;
}

function loadRealm(): Realm {
  return JSON.parse(readFileSync(REALM_PATH, "utf-8")) as Realm;
}

interface Field {
  path: string;
  value: string;
}

/**
 * Authored fields backed by varchar(255) in Keycloak's schema.
 * Column references are to Keycloak 26.x.
 */
export function collectBoundedFields(realm: Realm): Field[] {
  const out: Field[] = [];
  const add = (path: string, value: unknown): void => {
    if (typeof value === "string") out.push({ path, value });
  };

  // REALM.NAME / .DISPLAY_NAME / .LOGIN_THEME / .ACCOUNT_THEME / .EMAIL_THEME
  add("realm", realm.realm);
  add("displayName", realm.displayName);
  add("loginTheme", realm.loginTheme);
  add("accountTheme", realm.accountTheme);
  add("emailTheme", realm.emailTheme);

  // AUTHENTICATION_FLOW.ALIAS / .DESCRIPTION  ← the 2026-07-19 offender
  (realm.authenticationFlows ?? []).forEach((f, i) => {
    add(`authenticationFlows[${i}].alias`, f.alias);
    add(`authenticationFlows[${i}].description`, f.description);
  });

  // CLIENT.CLIENT_ID / .NAME / .DESCRIPTION / .ROOT_URL / .BASE_URL / .ADMIN_URL
  // REDIRECT_URIS.VALUE and WEB_ORIGINS.VALUE are varchar(255) too.
  (realm.clients ?? []).forEach((c, i) => {
    for (const k of ["clientId", "name", "description", "rootUrl", "baseUrl", "adminUrl"] as const) {
      add(`clients[${i}].${k}`, c[k]);
    }
    (c.redirectUris ?? []).forEach((u, n) => add(`clients[${i}].redirectUris[${n}]`, u));
    (c.webOrigins ?? []).forEach((u, n) => add(`clients[${i}].webOrigins[${n}]`, u));
  });

  // KEYCLOAK_ROLE.NAME / .DESCRIPTION
  (realm.roles?.realm ?? []).forEach((r, i) => {
    add(`roles.realm[${i}].name`, r.name);
    add(`roles.realm[${i}].description`, r.description);
  });
  for (const [client, roles] of Object.entries(realm.roles?.client ?? {})) {
    (roles ?? []).forEach((r, i) => {
      add(`roles.client["${client}"][${i}].name`, r.name);
      add(`roles.client["${client}"][${i}].description`, r.description);
    });
  }

  // KEYCLOAK_GROUP.NAME
  (realm.groups ?? []).forEach((g, i) => add(`groups[${i}].name`, g.name));

  // IDENTITY_PROVIDER.ALIAS / .DISPLAY_NAME
  (realm.identityProviders ?? []).forEach((p, i) => {
    add(`identityProviders[${i}].alias`, p.alias);
    add(`identityProviders[${i}].displayName`, p.displayName);
  });

  return out;
}

describe("Keycloak realm — authored fields fit their varchar(255) columns", () => {
  test("no authored field exceeds 255 characters", () => {
    const fields = collectBoundedFields(loadRealm());
    const over = fields.filter((f) => f.value.length > VARCHAR_255);

    if (over.length > 0) {
      const detail = over
        .map((f) => `  ${f.path}: ${f.value.length} chars\n    ${f.value.slice(0, 120)}…`)
        .join("\n");
      throw new Error(
        `${over.length} realm field(s) exceed varchar(255).\n\n` +
          `Keycloak does NOT truncate — the realm import throws SQLState 22001 and the\n` +
          `server exits, so this takes the whole identity plane down (and with it OIDC,\n` +
          `NetBird enrolment and the mesh). Shorten the value; if the text is worth\n` +
          `keeping, move it to docs/ and reference it — that is what\n` +
          `'aisha first broker login' does.\n\n${detail}`,
      );
    }
    expect(over).toEqual([]);
  });

  test("the gate actually inspects the flow that caused the 2026-07-19 outage", () => {
    const fields = collectBoundedFields(loadRealm());
    const flow = fields.find((f) => /^authenticationFlows\[\d+]\.description$/.test(f.path));
    expect(flow, "no authenticationFlows[].description was collected — the collector regressed")
      .toBeDefined();
  });

  test("detector rejects an over-length value (negative test)", () => {
    const synthetic: Realm = {
      authenticationFlows: [{ alias: "x", description: "y".repeat(VARCHAR_255 + 1) }],
    };
    const over = collectBoundedFields(synthetic).filter((f) => f.value.length > VARCHAR_255);
    expect(over.map((f) => f.path)).toEqual(["authenticationFlows[0].description"]);
  });

  test("realm has no unreviewed top-level section this gate silently ignores", () => {
    // Sections whose authored strings are either covered above or genuinely live
    // in TEXT columns (keys, certificates, component config). Adding a NEW
    // top-level section forces a decision here rather than a silent blind spot.
    const REVIEWED = new Set([
      "realm", "displayName", "displayNameHtml", "enabled", "sslRequired",
      "loginTheme", "accountTheme", "emailTheme", "adminTheme",
      "registrationAllowed", "registrationEmailAsUsername", "rememberMe",
      "verifyEmail", "loginWithEmailAllowed", "duplicateEmailsAllowed",
      "resetPasswordAllowed", "editUsernameAllowed", "bruteForceProtected",
      "permanentLockout", "maxFailureWaitSeconds", "minimumQuickLoginWaitSeconds",
      "waitIncrementSeconds", "quickLoginCheckMilliSeconds", "maxDeltaTimeSeconds",
      "failureFactor", "roles", "groups", "defaultRole", "defaultRoles",
      "requiredCredentials", "passwordPolicy", "otpPolicyType", "otpPolicyAlgorithm",
      "otpPolicyInitialCounter", "otpPolicyDigits", "otpPolicyLookAheadWindow",
      "otpPolicyPeriod", "otpPolicyCodeReusable", "otpSupportedApplications",
      "webAuthnPolicyRpEntityName", "webAuthnPolicySignatureAlgorithms",
      "webAuthnPolicyRpId", "webAuthnPolicyAttestationConveyancePreference",
      "webAuthnPolicyAuthenticatorAttachment", "webAuthnPolicyRequireResidentKey",
      "webAuthnPolicyUserVerificationRequirement", "webAuthnPolicyCreateTimeout",
      "webAuthnPolicyAvoidSameAuthenticatorRegister", "webAuthnPolicyAcceptableAaguids",
      "webAuthnPolicyExtraOrigins",
      "webAuthnPolicyPasswordlessRpEntityName", "webAuthnPolicyPasswordlessSignatureAlgorithms",
      "webAuthnPolicyPasswordlessRpId", "webAuthnPolicyPasswordlessAttestationConveyancePreference",
      "webAuthnPolicyPasswordlessAuthenticatorAttachment", "webAuthnPolicyPasswordlessRequireResidentKey",
      "webAuthnPolicyPasswordlessUserVerificationRequirement", "webAuthnPolicyPasswordlessCreateTimeout",
      "webAuthnPolicyPasswordlessAvoidSameAuthenticatorRegister",
      "webAuthnPolicyPasswordlessAcceptableAaguids", "webAuthnPolicyPasswordlessExtraOrigins",
      "users", "scopeMappings", "clientScopeMappings", "clients", "clientScopes",
      "defaultDefaultClientScopes", "defaultOptionalClientScopes",
      "browserSecurityHeaders", "smtpServer", "eventsEnabled", "eventsListeners",
      "enabledEventTypes", "adminEventsEnabled", "adminEventsDetailsEnabled",
      "identityProviders", "identityProviderMappers", "components",
      "internationalizationEnabled", "supportedLocales", "defaultLocale",
      "authenticationFlows", "authenticatorConfig", "requiredActions",
      "browserFlow", "registrationFlow", "directGrantFlow", "resetCredentialsFlow",
      "clientAuthenticationFlow", "dockerAuthenticationFlow", "firstBrokerLoginFlow",
      "attributes", "keycloakVersion", "userManagedAccessAllowed",
      "clientProfiles", "clientPolicies", "organizationsEnabled", "organizations",
      "id", "notBefore", "revokeRefreshToken", "refreshTokenMaxReuse",
      "accessTokenLifespan", "accessTokenLifespanForImplicitFlow",
      "ssoSessionIdleTimeout", "ssoSessionMaxLifespan", "ssoSessionIdleTimeoutRememberMe",
      "ssoSessionMaxLifespanRememberMe", "offlineSessionIdleTimeout",
      "offlineSessionMaxLifespanEnabled", "offlineSessionMaxLifespan",
      "clientSessionIdleTimeout", "clientSessionMaxLifespan",
      "clientOfflineSessionIdleTimeout", "clientOfflineSessionMaxLifespan",
      "accessCodeLifespan", "accessCodeLifespanUserAction", "accessCodeLifespanLogin",
      "actionTokenGeneratedByAdminLifespan", "actionTokenGeneratedByUserLifespan",
      "oauth2DeviceCodeLifespan", "oauth2DevicePollingInterval",
      "localizationTexts", "adminPermissionsEnabled", "verifiableCredentialsEnabled",
    ]);
    const unknown = Object.keys(loadRealm()).filter((k) => !REVIEWED.has(k));
    expect(
      unknown,
      "new top-level realm section(s) — decide whether their authored strings hit a " +
        "varchar(255) column, extend collectBoundedFields() if so, then add the key here:\n" +
        unknown.join("\n"),
    ).toEqual([]);
  });
});
