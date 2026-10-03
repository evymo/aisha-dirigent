# Data Consent & Data Security Workflow

## Overview

Tento dokument popisuje bezpečnostní workflow pro zpracování citlivých citlivých dat (sensitive-data - sensitive data) v aplikaci Platform, včetně souhlasů a nahrávání dokumentů.

## 🔒 Bezpečnostní Standardy

Aplikace splňuje následující standardy:
- **compliance** - Activity Insurance Portability and Accountability Act
- **GDPR** - General Data Protection Regulation
- **OWASP Top 10** - Bezpečnostní best practices
- **security compliance** - Audit controls

## 📋 Onboarding Flow - Explicitní Souhlas

### 1. Přijetí Pozvánky (`/invite/:code`)

Když uživatel přijde na onboarding link s kódem pozvánky:

1. **Validace kódu**
   - Ověření platnosti pozvánky (aktivní, nevypršelá, max. použití)
   - Načtení informací o studii

2. **Autentizace**
   - Pokud není přihlášen → redirect na /auth
   - Po přihlášení → návrat na onboarding

3. **Explicitní Souhlas** (4 samostatné checkboxy)
   - ✅ **Podmínky účasti** - obecné terms & conditions
   - ✅ **Zpracování osobních a citlivých dat (sensitive data)** - souhlas s GDPR/compliance
   - ✅ **Sdílení dat s konzultanty** - souhlas se sdílením s přidělenými konzultanty
   - ✅ **Informovaný souhlas se studií** - potvrzení informovaného souhlasu

4. **Vytvoření Souhlasů v DB**
   ```sql
   -- Při claim_invitation se vytvoří:
   INSERT INTO consents (user_id, consent_type, study_id, granted)
   VALUES 
     (user_id, 'data_processing', umbrella_study_id, true),
     (user_id, 'informed_consent', umbrella_study_id, true);
   ```

### 2. Klasická Registrace (`/study-registration`)

Při klasické registraci přes study registration formulář:

1. **Multi-step Dotazník (5 kroků)**
   - Vyplnění privátního dotazníku
   - Všechna sensitive data zůstávají v paměti (ne DB)

2. **Krok 5: Explicitní Data Consent**
   - **ScrollArea s detailními popisy každého souhlasu**
   - **4 samostatné checkboxy** (stejně jako onboarding):
     - ✅ Podmínky účasti (Shield icon)
     - ✅ Zpracování osobních a citlivých dat (Database icon)
     - ✅ Sdílení dat s konzultanty (UserCheck icon)
     - ✅ Informovaný souhlas se studií (FileText icon)
   - **Fail-closed validace**: Submit button disabled pokud nejsou všechny checkboxy zaškrtnuté
   - **Warning banner**: Zobrazení upozornění pokud nejsou všechny souhlasy uděleny

3. **Vytvoření Účtu** (pro nové uživatele)
   - Registrace přes Supabase Auth
   - **Vytvoření consent records v DB PŘED uložením dotazníku**
   ```typescript
   const consents = [
     { user_id, consent_type: 'data_processing', study_id: umbrellaStudyId, granted: true },
     { user_id, consent_type: 'informed_consent', study_id: umbrellaStudyId, granted: true },
   ];
   await supabase.from("consents").insert(consents);
   ```
   - Uložení dotazníku do `questionnaire_responses`

4. **Registration pro existující uživatele**
   - **Vytvoření consent records v DB PŘED uložením dotazníku**
   - Pokud má invite code → `claim_invitation()` RPC (auto-registration)
   - Uložení questionnaire responses
   - Update baseline_data pokud existuje registration
   - Aktivace registrationu pokud je status='enrolled'

## 🏥 sensitive data Data Workflow

### Nahrávání Zdravotních Dokumentů

**Bezpečnostní Guards:**

1. **sensitive-data Mode Required**
   ```typescript
   const { isEnabled: isPhiEnabled, phiClient } = usePhiMode();
   // Upload disabled if !isPhiEnabled
   ```

2. **Explicitní Souhlas Required**
   - Uživatel musí mít `consent_type='data_processing'` s `granted=true`
   - Ověřeno před přístupem k upload UI

3. **Pre-flight Validace**
   - Edge function `upload-health-document-preflight`
   - Vytvoří DB záznam před uploadem
   - Vrátí signed URL pro přímý upload

4. **Encrypted Storage**
   - Soubory v bucket `private-documents`
   - RLS policies: pouze vlastník může číst/zapisovat
   - Šifrování at-rest (Supabase Storage encryption)

### Sdílení Dokumentů s Konzultanty

1. **Consent Tracking**
   ```sql
   -- Tabulka: document_sharing_permissions
   - document_id
   - shared_with_partner_id
   - shared_with_study_id
   - can_view, can_use_for_statistics, can_use_for_research
   - granted_at, revoked_at
   ```

2. **Explicitní Povolení**
   - Uživatel musí explicitně povolit sdílení pro každý dokument
   - Consent lze kdykoliv odvolat (`revoked_at`)

3. **Audit Trail**
   - Každý přístup logován v `audit_logs`
   - User ID, action, timestamp, sensitive data resource

## 🔐 RLS (Row Level Security) Policies

### Consents Table
```sql
-- Uživatel může číst/upravovat pouze své souhlasy
CREATE POLICY "Users can manage own consents"
ON consents
USING (auth.uid() = user_id);
```

### Member Activity Documents
```sql
-- Pouze vlastník může číst/zapisovat
CREATE POLICY "Users can manage own documents"
ON member_health_documents
USING (auth.uid() = user_id);

-- Konzultanti vidí pouze dokumenty s explicitním sdílením
CREATE POLICY "Consultants see shared documents"
ON member_health_documents
USING (
  EXISTS (
    SELECT 1 FROM document_sharing_permissions dsp
    JOIN partner_profiles pp ON pp.id = dsp.shared_with_partner_id
    WHERE dsp.document_id = member_health_documents.id
    AND pp.user_id = auth.uid()
    AND dsp.can_view = true
    AND dsp.revoked_at IS NULL
  )
);
```

### Invitations
```sql
-- Admini a konzultanti mohou vytvářet pozvánky
-- Konzultanti pouze pro své studie
CREATE POLICY "Consultants can create invites for their studies"
ON invitations
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM study_consultants
    WHERE user_id = auth.uid()
    AND study_id = invitations.study_id
  )
);
```

## ✅ Bezpečnostní Checklist

### Před Zpracováním sensitive-data
- [ ] Uživatel je autentizovaný (`auth.uid()`)
- [ ] secure mode je aktivní (`isPhiEnabled && phiClient`)
- [ ] Existuje platný consent `data_processing` (`granted=true`, `revoked_at IS NULL`)
- [ ] Pro studii existuje `informed_consent` pro danou studii

### Před Nahráním Dokumentu
- [ ] secure mode aktivní
- [ ] Validace MIME type (pouze povolené formáty)
- [ ] Validace velikosti souboru (max 10MB)
- [ ] Pre-flight endpoint vytvořil DB záznam
- [ ] Signed URL s expirací (5 minut)

### Před Sdílením Dokumentu
- [ ] Uživatel vlastní dokument
- [ ] Cílový konzultant má platnou certifikaci
- [ ] Konzultant je přidělen ke studii uživatele
- [ ] Explicitní potvrzení od uživatele (UI checkbox)

## 🚨 Incident Response

Pokud dojde k bezpečnostnímu incidentu (např. neoprávněný přístup k sensitive-data):

1. **Okamžitě** logovat do `audit_logs` s `severity='critical'`
2. **Revokovat** všechny související consents
3. **Notifikovat** uživatele emailem
4. **Dokumentovat** incident v `/docs/incidents/`
5. **Review** všech přístupových logů za posledních 30 dní

## 📊 Audit & Compliance

### Pravidelné Kontroly

**Denně:**
- Automatická kontrola expired consents
- Monitoring failed authentication attempts
- Kontrola neobvyklých přístupových vzorů

**Týdně:**
- Review audit logů s sensitive data přístupem
- Kontrola RLS policies integrity
- Backup verification

**Měsíčně:**
- Kompletní security audit
- Review consent expirací
- Update bezpečnostní dokumentace

## 🔗 Související Dokumenty

- [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md) - Hlavní bezpečnostní guidelines
- [`SECURITY_AUDIT_REPORT.md`](../../SECURITY_AUDIT_REPORT.md) - Poslední security audit
- [`docs/security-critical-review.md`](./security-critical-review.md) - sensitive data implementation review

## 📝 Version History

- **v1.0** (2025-12-16): Initial dokumentace sensitive data consent workflow
  - Explicitní consent v onboardingu
  - Multi-step consent UI
  - RLS policies review
  - Audit trail requirements
