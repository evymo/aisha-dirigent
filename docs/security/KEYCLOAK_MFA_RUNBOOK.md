# Keycloak MFA runbook — Phase 12 WP 3.6

> **Snapshot 2026-05-20**, valid against main commit `<merge-sha>`.
> **Owner**: DevOps (per Phase 12 §0.3 roster).
> **Scope**: Enforce a second factor (WebAuthn preferred, TOTP fallback) for
> every login flow where the authenticated user has the `admin` or `staff`
> realm role. Non-admin/non-staff users are unaffected.

## TL;DR

```
Username + password (REQUIRED)
   ├── if user.has_role(admin) → REQUIRED { WebAuthn OR TOTP }
   └── if user.has_role(staff) → REQUIRED { WebAuthn OR TOTP }
```

A successful password authentication for a regular member completes
immediately. A successful password authentication for an admin or staff user
**requires** a second factor before a session token is issued. Users without
an enrolled factor see Keycloak's built-in enrolment screen
(`webauthn-register` or `CONFIGURE_TOTP` required action).

---

## §1 What this PR ships

### 1.1 Realm changes (`keycloak/aisha-realm.json`)

**Modified** — `authenticationFlows` array, sub-flow `AISHA Browser Forms`:
- Added two **conditional** sub-flow references after the password execution,
  one for each role gate.

**Added** — three new sub-flows in `authenticationFlows`:
- `AISHA MFA For Admin` (conditional-user-role REQUIRED → AISHA MFA Factor)
- `AISHA MFA For Staff` (conditional-user-role REQUIRED → AISHA MFA Factor)
- `AISHA MFA Factor` (TOTP **REQUIRED** + WebAuthn ALTERNATIVE, shared) —
  původně obě ALTERNATIVE; opraveno 2026-09-04, viz „Oprava tvaru toku" níže

**Added** — new top-level `authenticatorConfig` array:
- `aisha-mfa-condition-admin` → `condUserRole: admin`
- `aisha-mfa-condition-staff` → `condUserRole: staff`

**Unchanged**:
- The `webauthn-authenticator-passwordless` ALTERNATIVE in the top-level
  `AISHA Browser` flow stays — passkey-only login already provides MFA
  equivalence and works for any role.
- `requiredActions` array (CONFIGURE_TOTP, webauthn-register, etc.) is
  unchanged. ⛔ Pozor na dřívější tvrzení „Keycloak si je připojí sám, když
  tok vyžádá chybějící faktor": požadované akce se zpracovávají až PO
  dokončení přihlášení, takže tok, který uvízne uprostřed, se jimi
  nezachrání (naměřeno 2026-09-04). Nese to REQUIRED faktor, ne tenhle
  seznam. `defaultAction: false` stays so we don't pester every new public
  member.

### 1.2 Why two role-gated sub-flows instead of one with a role list

Keycloak's stock `conditional-user-role` authenticator accepts **one** role
per execution. To gate on "admin OR staff", we attach two independent
CONDITIONAL sub-flows; whichever matches triggers MFA. The cost is two
authenticator executions (constant time, ~microseconds) vs. introducing a
custom SPI.

Future option (Keycloak 26+): switch to the multi-role `conditional-role`
provider if we deploy `keycloak.x` with that provider enabled. Until then,
two-conditional pattern is portable across all current Keycloak versions
in the AISHA matrix.

---

## §2 User experience

| User role | First login post-rollout | Subsequent logins |
|---|---|---|
| Public member (no admin/staff) | Unchanged: username + password → in | Unchanged |
| Admin / staff without enrolled factor | Username + password → "Set up MFA" screen (TOTP or WebAuthn) → second factor → in | Username + password → second factor prompt → in |
| Admin / staff with enrolled factor | Username + password → second factor prompt → in | Same |
| Admin / staff using passkey-only (existing) | Unchanged: passkey only → in (MFA equivalent already) | Unchanged |

WebAuthn is offered FIRST on the factor screen because:
1. Phishing-resistant by design (origin-bound credential)
2. Better UX (no time-window pressure, no 6-digit copy)
3. Already enrolled for many staff via passkey rollout

TOTP stays as fallback for users without a security key handy
(authenticator app on phone).

---

## §3 Rollout sequence

### 3.1 Pre-deploy (1 day, DevOps)

1. Verify the modified realm file imports cleanly into Keycloak staging:
   ```bash
   docker compose exec aisha-keycloak \
     /opt/keycloak/bin/kc.sh import \
     --file /opt/keycloak/data/import/aisha-realm.json \
     --override true
   ```
2. Verify in Keycloak admin UI that the new flows appear:
   `Authentication → Flows → AISHA Browser → AISHA Browser Forms`
3. Test with three accounts:
   - Public member account → password-only login still works
   - Admin account without factor → enrolment screen appears
   - Admin account with TOTP already → factor prompt appears

### 3.2 Production deploy (30 min, DevOps)

```bash
# 3.2.1 Re-import realm via Coolify Keycloak service
# (existing pipeline: scripts/smoke-keycloak.sh or Coolify "Restart" with
#  KC_REALM_IMPORT_ON_STARTUP=true)

# 3.2.2 Smoke test
npm run smoke:keycloak    # exists per repo
```

### 3.3 Operator communication (continuous)

- Slack/Matrix announcement to admin/staff: "Next login will ask you to set
  up a second factor — use a passkey if your browser supports it, otherwise
  install Aegis / Authy / Google Authenticator for TOTP."
- Grace period: 7 days during which admins can still log in once even
  without an enrolled factor, after which enrolment is blocking.
  - Grace is enforced at the social/audit level, not the flow level —
    zápis faktoru vynucuje **REQUIRED provedení TOTP**: kdo faktor nemá,
    dostane při přihlášení QR kód a musí ho dokončit. Není žádná měkká
    lhůta na úrovni toku.
  - ⛔ Dřívější znění to připisovalo poli `userSetupAllowed: true` u dvou
    ALTERNATIVE provedení. To je vyvrácené: samozaložení Keycloak nabízí jen
    u REQUIRED, takže tvar „samé ALTERNATIVE" znamenal ne prompt, ale
    uvíznutí (naměřeno 2026-09-04 na produkci).
  - For organizations that want a real grace period, the operational answer
    is to temporarily move 2-3 critical accounts to a role group not gated
    by MFA, then revert. We deliberately don't bake that into the realm —
    it would defeat the security goal.

---

## §4 Rollback

### 4.1 Full rollback (Keycloak admin UI, ≤ 5 min)

1. Authentication → Flows → AISHA Browser → AISHA Browser Forms
2. Delete the two CONDITIONAL execution rows (positions 20 + 30)
3. Save

Or revert the realm JSON commit and re-import:
```bash
git revert <wp-3-6-merge-commit>
docker compose -f docker-compose.coolify-keycloak.yml restart aisha-keycloak
# Keycloak re-imports the older realm definition on startup
```

### 4.2 Partial rollback — drop one role only

Edit `keycloak/aisha-realm.json` to remove either `AISHA MFA For Admin` or
`AISHA MFA For Staff` from the `AISHA Browser Forms` sub-flow's
authenticationExecutions array, then re-import. The shared
`AISHA MFA Factor` flow stays for whichever role remains gated.

---

## §5 Monitoring

### 5.1 What to watch (post-rollout, first 7 days)

In Keycloak event logs (or via OAuth2 Proxy access logs, which the AISHA
gateway already collects):

| Event | Expected pattern | Investigate if |
|---|---|---|
| `LOGIN` for admin/staff | Followed by `USER_INFO_REQUEST` confirming role | Login completes without factor prompt for admin/staff role |
| `CUSTOM_REQUIRED_ACTION` for `CONFIGURE_TOTP` or `webauthn-register` | First-login enrolment for admin/staff | Spike for non-admin users (indicates condition mis-gated) |
| `LOGIN_ERROR` with error `not_allowed` | Brute-force or expired session | Sustained per-account >5/h (account compromise attempt) |

### 5.2 Required Keycloak event listeners

`aisha-realm.json` already has `jboss-logging` enabled by Keycloak default.
For long-term correlation, hook the existing Keycloak event listener SPI
into Langfuse (already on this WP's Phase 17 follow-up agenda).

---

## §6 Related WPs

- **WP 3.5** JWT revocation cache (already merged) — revokes a session
  immediately on logout; complements MFA at the session lifecycle level
- **WP 3.7** Secrets management — relevant if we add a Keycloak event
  listener SPI talking to Vault for audit shipping
- **WP 17.1** Production-grade observability for Keycloak events — Phase 17
  parking lot

## §7 References

- Keycloak Authentication Flows docs: <https://www.keycloak.org/docs/latest/server_admin/#_authentication-flows>
- Keycloak `conditional-user-role` authenticator: <https://www.keycloak.org/docs/latest/server_admin/#con-conditional-user-role_server_administration_guide>
- WebAuthn vs TOTP comparison (W3C WebAuthn L3): <https://www.w3.org/TR/webauthn-3/>
- AISHA realm export: `keycloak/aisha-realm.json`
- Keycloak Coolify deploy: `docker-compose.coolify-keycloak.yml`

---

## Oprava tvaru toku — 2026-09-04

**Příznak.** Přihlášení admina do extranetu končilo hláškou „Není možné se
přihlásit, je vyžadována konfigurace přístupových údajů". Účet byl aktivní,
měl heslo a přiřazenou akci CONFIGURE_TOTP.

**Příčina.** Podskupina `AISHA MFA Factor` se volá jako REQUIRED — musí projít.
Obě její možnosti ale byly ALTERNATIVE a ani jedna nastavená. Keycloak tedy
neměl co spustit a neměl jak vybrat, kterou alternativu nabídnout k založení.
Pole `userSetupAllowed` v exportu na tom nic nemění: samozaložení faktoru
Keycloak nabízí jen u REQUIRED provedení.

**Oprava.** `OTP Form` je nově REQUIRED. Kdo faktor nemá, dostane při
přihlášení QR kód a založí si ho. WebAuthn v téže podskupině zůstává
deklarovaný, ale je nečinný — Keycloak v jedné podskupině upřednostní
REQUIRED před ALTERNATIVE. Rozhodnutí majitele 2026-09-04: jednodušší politika
místo dvou cest, které se navzájem blokovaly.

**Kde to drží.** `src/tests/gates/wp-3-6-mfa-admin-staff.gate.test.ts` —
brána původně vyžadovala pravý opak („all factors must be ALTERNATIVE for
graceful enrolment") a byla tímtéž měřením přepsána.
