# Partner Role Specification

**Datum vytvoření:** 18. prosince 2025  
**Status:** ✅ Production Standard  
**Účel:** Definice partner role a vztahu k practitioner DB role

---

## 📋 Executive Summary

V aplikaci Platform je **"partner"** speciální role, která **není** reprezentována jako samostatná DB role v `app_role` enum. Místo toho:

- **Partner** = Uživatel s **certifikovaným** záznamem v tabulce `partner_profiles`
- **Practitioner** = DB role v `user_roles` (může, ale nemusí být partner)
- **Certifikace** = Proces dokončení Partner Certification Test

### Klíčové Rozhodnutí

✅ **Partner = profil, ne role**  
❌ **Partner ≠ DB role v `app_role` enum**

---

## 🎯 Proč Partner Není DB Role?

### 1. Flexibilita Certification Procesu

Partner musí projít certifikačním testem a získat `certification_passed_at` timestamp. DB role by to nekomunikovala:

```typescript
// ❌ BAD: DB role nevyjadřuje certifikaci
if (hasRole('partner')) {
  // Jak víme, že prošel certifikací?
}

// ✅ GOOD: Profil explicitně ukazuje certifikaci
if (partnerProfile?.certification_passed_at) {
  // Jasně víme, že je certifikován
}
```

### 2. Oddělení Concerns

- **DB role** (`practitioner`) → Typ uživatelského účtu, oprávnění v systému
- **Partner profil** → Business entita s certifikací, viditelností, klientským vztahem

### 3. Gradual Onboarding

Uživatel může:
1. Být `member` → Normální uživatel
2. Začít certifikační test → Stále `member`
3. Projít testem → Vytvoří se `partner_profile` (stále `member`)
4. Optionally získat `practitioner` DB role → Pro RLS policies

---

## 🔄 Partner Lifecycle

### Fáze 1: Member (Začátek)

```
User registered
├── user_roles: ['member']
├── partner_profiles: NULL
└── Access: Member portal pouze
```

### Fáze 2: Partner Candidate (V procesu)

```
Started certification test
├── user_roles: ['member']
├── partner_profiles: 
│   ├── id: xxx
│   ├── certification_passed_at: NULL
│   └── is_visible: false
└── Access: Member portal + test
```

### Fáze 3: Certified Partner (Hotovo)

```
Passed certification test
├── user_roles: ['member', 'practitioner'] (optional)
├── partner_profiles: 
│   ├── id: xxx
│   ├── certification_passed_at: '2024-01-15'
│   └── is_visible: true
└── Access: Member portal + Partner dashboard
```

---

## 🛡️ Access Control Implementation

### RequireAuth Component Logic

```typescript
// src/components/session/RequireAuth.tsx

type AllowedRole = "member" | "partner" | "admin";

function isAllowedByAppState(params: {
  allowedRoles: AllowedRole[];
  session: ReturnType<typeof useSession>;
  partnerProfileExists: boolean;
}) {
  const { allowedRoles, session, partnerProfileExists } = params;

  return allowedRoles.some((role) => {
    if (role === "admin") {
      return hasRole("admin");  // DB role check
    }

    if (role === "partner") {
      // ✅ KRITICKÉ: Kontroluje PROFIL, ne DB role
      return partnerProfileExists;
    }

    if (role === "member") {
      if (roles.length === 0) return true;  // Implicit member
      return hasRole("member") || hasRole("admin");
    }

    return false;
  });
}
```

### Key Points

1. **`allowedRoles={["partner"]}`** → Kontroluje `useMyPartnerProfile().data`
2. **`allowedRoles={["admin"]}`** → Kontroluje `hasRole("admin")` z `user_roles`
3. **`allowedRoles={["member"]}`** → Kontroluje `hasRole("member")` nebo implicit (žádné role)

---

## 📊 Database Schema

### partner_profiles Table

```sql
CREATE TABLE partner_profiles (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) UNIQUE,
  
  -- Certification
  certification_passed_at TIMESTAMPTZ,  -- NULL = není certifikován
  certification_score INTEGER,
  
  -- Business info
  display_name TEXT,
  bio TEXT,
  is_visible BOOLEAN DEFAULT false,     -- Visible v public directory
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### user_roles Table (Standard)

```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  role app_role NOT NULL,  -- 'admin' | 'staff' | 'practitioner' | 'member' | 'evaluator'
  
  UNIQUE(user_id, role)
);
```

### Relationship

```
auth.users (1) ────┬──── (0..1) partner_profiles [Business entity]
                   │
                   └──── (0..n) user_roles [Permission roles]
```

---

## 🔐 Row Level Security (RLS)

### Partner Data Access

Partners přistupují k user data přes **audited RPC functions**, které kontrolují:

```sql
-- Example: get_user_health_check_ins_summary_audited()

-- Kontrola 1: Je partner certifikovaný?
IF NOT EXISTS (
  SELECT 1 FROM partner_profiles 
  WHERE user_id = auth.uid() 
  AND certification_passed_at IS NOT NULL
) THEN
  RAISE EXCEPTION 'Not a certified partner';
END IF;

-- Kontrola 2: Má partner consent k těmto datům?
IF NOT EXISTS (
  SELECT 1 FROM data_sharing_consents
  WHERE user_id = p_client_id
  AND partner_id = auth.uid()
  AND granted = true
) THEN
  RAISE EXCEPTION 'No data sharing consent';
END IF;

-- Kontrola 3: Audit trail
INSERT INTO audit_journal (...) VALUES (...);
```

**Důležité:** RPC funkce kontrolují `partner_profiles.certification_passed_at`, ne DB role!

---

## 🚀 Partner Creation Workflow

### 1. User Starts Certification

```typescript
// Frontend: /partner-certification
const startCertification = async () => {
  const { data, error } = await supabase
    .from('partner_profiles')
    .insert({
      user_id: user.id,
      display_name: user.email,
      is_visible: false,
      certification_passed_at: null,  // Not certified yet
    });
};
```

### 2. User Takes Test

```typescript
// Test questions loaded from test_questions table
// User answers stored in test_results table
```

### 3. Test Completion

```typescript
// Backend trigger or RPC
IF test_score >= passing_score THEN
  UPDATE partner_profiles
  SET certification_passed_at = NOW(),
      certification_score = test_score
  WHERE user_id = user_id;
  
  -- Optionally add practitioner role for RLS
  INSERT INTO user_roles (user_id, role)
  VALUES (user_id, 'practitioner')
  ON CONFLICT DO NOTHING;
END IF;
```

### 4. Partner Dashboard Access

```typescript
// Frontend: /partner/*
<Route element={<RequireAuth allowedRoles={["partner"]} />}>
  <Route path="/partner" element={<PartnerDashboard />} />
  <Route path="/partner/clients" element={<ClientList />} />
</Route>

// ✅ Requires: partner_profiles.certification_passed_at IS NOT NULL
// ❌ Does NOT require: user_roles.role = 'practitioner'
```

---

## 🎨 UI/UX Considerations

### Partner Badge Display

```typescript
// Show "Certified Partner" badge based on profile, not role
const isCertifiedPartner = Boolean(
  partnerProfile?.certification_passed_at
);

{isCertifiedPartner && (
  <Badge variant="success">✓ Certifikovaný Partner</Badge>
)}
```

### Conditional Navigation

```typescript
// Show Partner Dashboard link only if certified
const { data: partnerProfile } = useMyPartnerProfile();

{partnerProfile?.certification_passed_at && (
  <NavLink to="/partner">Partner Dashboard</NavLink>
)}
```

---

## 🧪 Testing Partner Role

### Test Scenarios

```typescript
describe('Partner Access Control', () => {
  it('denies access without partner profile', () => {
    // User has NO partner_profile
    render(<RequireAuth allowedRoles={["partner"]}><Dashboard /></RequireAuth>);
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('denies access with uncertified profile', () => {
    // partner_profile exists BUT certification_passed_at IS NULL
    mockPartnerProfile({ certification_passed_at: null });
    render(<RequireAuth allowedRoles={["partner"]}><Dashboard /></RequireAuth>);
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('allows access with certified profile', () => {
    // partner_profile exists AND certification_passed_at IS NOT NULL
    mockPartnerProfile({ certification_passed_at: '2024-01-15' });
    render(<RequireAuth allowedRoles={["partner"]}><Dashboard /></RequireAuth>);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('allows access even without practitioner DB role', () => {
    // Partner profile certified but NO 'practitioner' in user_roles
    mockUserRoles(['member']);  // Only member role
    mockPartnerProfile({ certification_passed_at: '2024-01-15' });
    render(<RequireAuth allowedRoles={["partner"]}><Dashboard /></RequireAuth>);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
```

---

## 📝 Developer Guidelines

### DO ✅

```typescript
// Check partner status via profile
const { data: partnerProfile } = useMyPartnerProfile();
const isCertifiedPartner = Boolean(partnerProfile?.certification_passed_at);

// Use RequireAuth with "partner" role
<Route element={<RequireAuth allowedRoles={["partner"]} />}>
  <Route path="/partner/*" element={<PartnerRoutes />} />
</Route>

// Query partner_profiles in RPC functions
IF NOT EXISTS (
  SELECT 1 FROM partner_profiles 
  WHERE user_id = auth.uid() 
  AND certification_passed_at IS NOT NULL
) THEN
  RAISE EXCEPTION 'Not certified';
END IF;
```

### DON'T ❌

```typescript
// ❌ Don't check for 'practitioner' DB role to determine partner access
const { hasRole } = useSession();
if (hasRole('practitioner')) {  // WRONG!
  // This doesn't guarantee certification
}

// ❌ Don't add "partner" to app_role enum
CREATE TYPE app_role AS ENUM (
  'admin', 'staff', 'practitioner', 'member', 'evaluator', 'partner'  // WRONG!
);

// ❌ Don't bypass partner_profile check in UI
<Link to="/partner">Partner Dashboard</Link>  // WRONG - no access control
```

---

## 🔄 Migration Path (If Needed)

Pokud bychom chtěli změnit na DB role-based přístup:

### Varianta A: Partner jako DB Role

```sql
-- Add partner to enum
ALTER TYPE app_role ADD VALUE 'partner';

-- Migrate existing partners
INSERT INTO user_roles (user_id, role)
SELECT user_id, 'partner'::app_role
FROM partner_profiles
WHERE certification_passed_at IS NOT NULL;

-- Update RequireAuth
if (role === 'partner') {
  return hasRole('partner');  // DB role check instead of profile
}
```

**Důsledky:**
- ❌ Ztráta informace o certifikaci (jen boolean role)
- ❌ Složitější workflow (přidávání/odebírání role při certifikaci)
- ✅ Jednodušší autorizační logika

### Varianta B: Hybrid (Current) ✅

```sql
-- Keep partner_profiles as source of truth
-- Optionally add practitioner role for RLS convenience
-- RequireAuth checks profile, not DB role
```

**Důsledky:**
- ✅ Zachování business logiky (certifikace)
- ✅ Flexibilní přístup
- ⚠️ Vyžaduje dobrou dokumentaci (proto tento dokument)

---

## 🎓 For New Developers

### Quick Start

1. **Partner není DB role** - je to profil s certifikací
2. **Kontroluj vždy `partner_profiles.certification_passed_at`** - ne user_roles
3. **RequireAuth s `allowedRoles={["partner"]}`** - kontroluje profil
4. **RPC funkce kontrolují certifikaci** - ne DB role

### Common Mistakes

| Mistake | Correct Approach |
|---------|-----------------|
| `hasRole('partner')` | `partnerProfile?.certification_passed_at` |
| Add 'partner' to app_role | Keep partner_profiles separate |
| Check practitioner role | Check partner certification |
| Direct table access | Use audited RPC functions |

---

## 📚 Related Documentation

- [RequireAuth Implementation](../../src/components/session/RequireAuth.tsx)
- [RLS Policy Documentation](./RLS_POLICY_DOCUMENTATION.md)
- [Security Implementation Status](./SECURITY_IMPLEMENTATION_STATUS.md)
- [Partner Certification System](../../supabase/migrations/20251216010000_onboarding_certification_system.sql)

---

## ✅ Compliance Notes

### compliance
- Partner access to sensitive data requires explicit data_sharing_consent ✅
- All sensitive data access logged via audit_journal ✅
- Minimum necessary principle enforced in RPC functions ✅

### security compliance
- CC6.1: Logical access controls via profile-based authorization ✅
- CC6.2: Partner certification before access grant ✅
- CC7.2: Audit trail for all partner data access ✅

---

**Změny v tomto dokumentu vyžadují review security team.**
