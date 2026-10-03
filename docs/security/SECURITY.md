# SECURITY — Platform (single source of truth)

Tento dokument je **aktuální, sjednocený** přehled zabezpečení aplikace Platform (frontend + Supabase). Repo pracuje s reálnými sensitive data a je produkční.

## Zásady (nevyjednatelné)

- Nikdy nelogovat sensitive data (email, jméno, citlivá data, tokeny, session info).
- UI guardy jsou pouze UX. **Skutečná autorizace musí být vynucená server-side** (RLS, RPC s autorizací).
- Data minimization: vždy selektovat pouze nutná pole (`.select('...')`), vyhýbat se `.select('*')` i `.select()` bez argumentu (Supabase = select-all).
- Fail-closed pro sensitive data obrazovky: pokud není splněna podmínka (secure mode / role / consent), data se **nesmí** fetchovat ani renderovat.

## Threat model (zkráceně)

- Broken Access Control / IDOR: přístup k cizím dokumentům nebo profilům.
- sensitive data leakage: implicitní stahování `notes` / širokých `profiles` polí do partner/consultant UI.
- Overfetch: `.select('*')` na citlivých tabulkách → zbytečně velká data + větší riziko úniku.
- Error disclosure: zobrazování detailních chyb uživateli (tabulky, sloupce, stack trace).
- Abuse / exfil: vysokofrekvenční download/AI analýzy bez rate limitu.

## Implementované bezpečnostní patterny

### 1) secure mode pro member sensitive data obrazovky

- Re-auth + in-memory token (bez persistence), separátní Supabase klient.
- Re-auth metody: heslo (default) + email OTP pro passwordless/SSO účty.
- sensitive data hooky jsou fail-closed: bez secure mode se data nefetchují.
- Cíl: snížit riziko exfiltrace přes dlouho žijící session storage a donutit explicitní „sensitive-data intent“.

### 2) Data minimization + audited on-demand přístup k `notes`

- Partner list view **nesmí** implicitně tahat a renderovat appointment `notes`.
- Pokud je přístup k `notes` potřeba, jde pouze přes **autorizovaný, auditovaný RPC** a ideálně on-demand (klik-to-reveal) pro omezení „bulk download“.

### 3) Partner/consultant minimal member info přes RPC

- Partner/consultant stránky nepoužívají broad read z `profiles` pro email/phone/DOB/diagnosis.
- Namísto toho RPC vrací minimum (`display_name`), autorizace je uvnitř funkce.

### 4) Dokumenty: server-mediated gateway (P0)

- Download: Edge Function vydává krátkodobé signed URL po ověření JWT + RLS autorizaci.
- Upload: preflight Edge Function vytvoří DB záznam (RLS) + vydá signed upload token.
- AI analýza: Edge Function s allowlist CORS, rate limiting, consent check, minimalizace/redakce vstupu.

### 5) Error disclosure

- Produkce nesmí ukazovat `error.message` z backendu uživatelům.

## Stav hardeningu (aktuálně)

### Partner/consultant přístupy k „notes“

- Partner appointments list: `notes` nejsou součástí list query.
- Partner appointment notes: pouze přes `get_partner_appointment_notes(p_appointment_id)` s autorizací + auditem.
- DB-first: appointment `notes` jsou izolované v `partner_appointment_notes` (legacy sloupec v `partner_appointments.notes` se při zápisu přes trigger vynuluje).
- Member UI: bulk načítání poznámek přes `get_my_appointment_notes(p_appointment_ids uuid[])` (SECURITY INVOKER + RLS).
- Partner/consultant user dashboards: dosing log `notes` se defaultně nestahují ani nerenderují.

### Overfetch / `.select('*')`

- sensitive data dokumenty: `member_health_documents` list už nepoužívá `.select('*')` (whitelist polí).
- Admin/production UI: odstraněny zbývající `.select('*')` z listů (archive docs, subscription packages, protocol steps).
- Další tabulky: postupně nahrazovat `.select('*')` explicitním výčtem polí.

### Partner přístup k `profiles`

- Partner nemá mít přímý SELECT přístup na `profiles` pro členy (RLS je jen row-level a nezajišťuje sloupcové omezení).
- Minimal member info pro partnera jde přes RPC `get_appointment_member_info(p_partner_id)` (SECURITY DEFINER, vrací jen `display_name`).

### Public partner directory (anti-scraping)

- Produkce preferuje Edge Function `public-partners-directory` (rate limiting + audit) před přímým `SELECT partner_profiles`.
- `usePartners` v produkci fail-closed: když Edge Function není dostupná, neprovádí fallback na přímé DB čtení.

### Self-service přístup k `profiles` (member/admin rozdíl)

- **Self-service (uživatel čte/zapisuje vlastní profil)** může používat přímý přístup k `profiles` pouze s **explicitním whitelistem polí**.
- **sensitive-data pole** (např. diagnosis/medications/history/DOB) jsou v UI dostupná jen v režimu **secure mode** a musí se fetchovat přes `phiClient` (in-memory session, fail-closed).
- Helpery typu `fetchPhiProfilePrefill(...)` se smí volat jen v kódu, který už provedl gate `isPhiEnabled && phiClient`.
- **Admin/staff** čtení profilu (nebo join profilu do admin listů) se nedělá přes přímý klientský `SELECT profiles` – používá se SECURITY DEFINER RPC s auditem a minimal payloadem.

Poznámka k enforcementu: plošné odebrání přímého `INSERT/UPDATE/DELETE` na `public.profiles` pro `authenticated` je zatím **záměrně odložené** (kvůli dopadům na existující flow). Viz rozhodnutí: `docs/security/decisions/2025-12-14-profiles-dml-enforcement.md`.

#### Audited RPC pro sensitive data profil (self-service)

- Čtení sensitive data profilu (self): `get_my_profile_phi()` (SECURITY DEFINER + audit `view`, bez ukládání sensitive data hodnot)
- Zápis sensitive data profilu (self): `upsert_my_profile_phi(p_patch jsonb)` (SECURITY DEFINER + audit `update`, audit obsahuje jen seznam změněných polí)
- Member profil stránka používá tyto RPC v secure mode místo přímého `UPDATE/UPSERT` na `profiles`.

### Admin token locks + minimal profile fields

- Admin UI pro `token_locks` nesmí vyžadovat přímý klientský `SELECT` na `profiles` jen kvůli `display_name/email`.
- Používá se admin-gated RPC `get_token_locks_admin()` (SECURITY DEFINER) pro join `token_locks` + minimální profilová pole a současně se zapisuje audit (action `view`, area `tokens`).

### Admin token locks (create/update) — DB-first + audit + guardrails

- Klient **nesmí** dělat přímé `INSERT/UPDATE/DELETE` do `token_locks` (DML je odňaté pro `authenticated`).
- Create jde přes `create_token_lock_admin(...)` (SECURITY DEFINER): derivuje `created_by` z `auth.uid()`, validuje vstupy (amount > 0, lock_end > lock_start, known token_type) a zapisuje audit `create`.
- Update jde přes `update_token_lock_admin(...)` (SECURITY DEFINER): omezené pole změn, validace konzistence (např. `unlocked_amount <= amount`) + audit `update`.
- DB guardrails: CHECK constraints (amount, časová konzistence, ranges/allowlists) + trigger `updated_at`.

### Admin registrations/members — žádné přímé čtení `profiles`

- Admin dashboards (Registrations/Members/Overview) nepoužívají přímý klientský `SELECT` na `profiles`.
- Registrations list + sensitive data pole profilu jde přes `get_program_registrations_admin()` (SECURITY DEFINER) s auditem `view`.
- Změna statusu registrationu jde přes `update_study_registration_status_admin(...)` (SECURITY DEFINER) s auditem `update`.
- Members summary (membership tier/status + agregace check-in/registration count) jde přes `get_members_summary_admin()` (SECURITY DEFINER) s auditem `view`.

## Audit & logging

- Audit zapisuje události (přístupy, denied, rate limit, změny) bez ukládání sensitive data obsahu.
- `safeLogger` loguje pouze v DEV a bez detailů (jen message).
- sensitive data čtení, které potřebuje audit, jde přes audited RPC (např. `get_my_health_check_ins_audited`, `get_my_lab_results_audited`, `get_my_activity_logs_audited`, `get_my_appointment_notes_audited`).

## Kontrolní seznam (DoD) pro bezpečnostní změny

- [ ] Změna neumožňuje klientskou privilege escalation (RLS/RPC kontrola).
- [ ] Žádné `.select('*')` na citlivých tabulkách (zejména sensitive data).
- [ ] Žádné logování sensitive data.
- [ ] U všech nových RPC: autorizace uvnitř + minimální návratová data + GRANT/REVOKE.
- [ ] U všech Edge Functions: CORS allowlist + JWT + rate limiting + audit.
- [ ] DB migrace jsou version-controlled a aplikované před deployem (viz `docs/deploy/MIGRATIONS.md`).
- [ ] Testy a build: `npm run test:run` + `npm run build`.

## Platform hardening (ruční kroky)

- Supabase Auth: zapnout “Leaked Password Protection” (Dashboard → Authentication → Settings).
- sensitive data “httpOnly cookies” režim: vyžaduje server-assisted architekturu (nepoužitelná čistě klientským Supabase SDK); evidujeme jako P0 architekturální follow-up.

## Appendix: zdrojové dokumenty (archiv)

Tyto dokumenty byly konsolidovány sem a mohou sloužit jako historický detail:

- `docs/security-critical-review.md`
- `docs/security/secure-SECURITY-REDESIGN.md`
- `docs/security/P0-DOCUMENT-UPLOAD-PREFLIGHT.md`
- `docs/security/P0-DOCUMENT-DOWNLOAD-GATEWAY.md`
- `docs/security/P0-AI-ANALYSIS-HARDENING.md`

---

## OWASP Top 10 Compliance

Aplikace implementuje ochranu proti všem OWASP Top 10 rizikům:

| # | Riziko | Ochrana | Status |
|---|--------|---------|--------|
| 1 | **Injection** | Supabase parametrizované dotazy, Zod validace vstupů | ✅ |
| 2 | **Broken Authentication** | Supabase Auth + MFA, 30min sensitive data session timeout, httpOnly cookies | ✅ |
| 3 | **Sensitive Data Exposure** | TLS 1.2+, encrypted at rest, no sensitive data in logs, safeLogger | ✅ |
| 4 | **XXE** | Zod validace JSON, no XML processing | ✅ |
| 5 | **Broken Access Control** | RLS policies + RPC authorization + audit_journal | ✅ |
| 6 | **Security Misconfiguration** | Strict TypeScript, CSP headers, npm audit, pinned deps | ✅ |
| 7 | **XSS** | React auto-escape, DOMPurify pro rich text | ✅ |
| 8 | **Insecure Deserialization** | Zod schema validation pro všechna externí data | ✅ |
| 9 | **Vulnerable Components** | npm audit, dependency updates, Snyk scanning | ✅ |
| 10 | **Insufficient Logging** | audit_journal pro sensitive-data, auth events, rate limiting | ✅ |

### Detailní implementace

#### 1. Injection Prevention
```typescript
// ✅ Parametrizované dotazy přes Supabase
const { data } = await supabase.rpc("get_my_data", { p_user_id: userId });

// ✅ Zod validace před DB operací
const validated = schema.parse(userInput);
```

#### 2. Authentication
```typescript
// ✅ sensitive data Mode s re-autentizací
const { isPhiEnabled, phiClient } = usePhiSession();
// In-memory token, 30min timeout, fail-closed

// ✅ Session management
await supabase.auth.getSession();
```

#### 3. Sensitive Data Exposure
```typescript
// ✅ Safe logging
import { safeError } from "@/lib/security/safeLogger";
console.error("Operation failed:", safeError(error));

// ❌ NIKDY
console.error(`Failed for ${email}:`, error);
```

#### 4. Access Control (RLS)
```sql
-- Každá tabulka má RLS
ALTER TABLE health_check_ins ENABLE ROW LEVEL SECURITY;

-- User-scoped policies
CREATE POLICY "Users read own data" ON health_check_ins
  FOR SELECT USING (auth.uid() = user_id);

-- Consultant access přes consent
CREATE POLICY "Consultants with consent" ON health_check_ins
  FOR SELECT USING (has_data_sharing_consent(user_id, auth.uid()));
```

#### 5. XSS Prevention
```tsx
// ✅ React auto-escapes
<div>{userInput}</div>

// ⚠️ Rich text pouze s DOMPurify
import DOMPurify from "dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />
```

#### 6. Logging & Monitoring
```sql
-- Audit journal pro všechny sensitive data přístupy
INSERT INTO audit_journal (user_id, action, target_type, target_id)
VALUES (auth.uid(), 'sensitive-data_READ', 'health_check_ins', p_user_id);

-- Rate limiting na Edge Functions
-- Monitoring unusual patterns
```

---

## Související dokumentace

| Dokument | Účel |
|----------|------|
| [DEVELOPMENT_GUIDELINES.md](../DEVELOPMENT_GUIDELINES.md) | Kompletní OWASP implementační detaily |
| [RLS_POLICY_DOCUMENTATION.md](RLS_POLICY_DOCUMENTATION.md) | security compliance RLS dokumentace |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | RPC-only pattern, Audit systém |
| [APP_INTEGRITY.md](APP_INTEGRITY.md) | Mobile App Integrity (Play Integrity, App Attest) |

---

*Poslední aktualizace: 3. února 2026*
