# Token Rewards & Blockchain Audit System

## Přehled

Všechny důležité akce v aplikaci jsou:
1. **Logovány do audit journal** - pro compliance a traceability
2. **Zaznamenány na blockchain** - pro immutable audit trail
3. **Odměněny tokeny** - za dokončené aktivity

## 🎯 Rewardovatelné Akce

### Data Consent Actions
| Akce | Action Type | Token Reward | Blockchain |
|------|-------------|--------------|------------|
| Udělení sensitive data consent | `consent_granted` | ✅ 10 tokens | ✅ |
| Dokončení registrationu | `study_registration_completed` | ✅ 50 tokens | ✅ |
| Dokončení dotazníku | `questionnaire_completed` | ✅ 25 tokens | ✅ |

### Zdravotní Aktivity
| Akce | Action Type | Token Reward | Blockchain |
|------|-------------|--------------|------------|
| Denní check-in | `checkin_completed` | ✅ 5 tokens | ✅ |
| Nahrání privátního dokumentu | `document_uploaded` | ✅ 15 tokens | ✅ |
| Dokončení konzultace | `consultation_completed` | ✅ 30 tokens | ✅ |

### Admin/Staff Akce
| Akce | Action Type | Token Reward | Blockchain |
|------|-------------|--------------|------------|
| Zápis ze schůzky | `meeting_recorded` | ✅ 20 tokens | ✅ |
| Zpracování production batch | `batch_completed` | ✅ 100 tokens | ✅ |
| QC approval | `qc_approved` | ✅ 50 tokens | ✅ |

## 🔧 Implementace

### 1. Pomocí Helper Funkce

```typescript
import { logAndRewardConsentAction } from "@/lib/security/consentAuditLogger";

// Po vytvoření consent záznamu
await logAndRewardConsentAction({
  userId: user.id,
  actionType: "consent_granted",
  entityType: "consent",
  entityId: consentId,
  summary: "User granted data processing consent",
  details: {
    consent_type: "data_processing",
    study_id: studyId,
  },
  newValues: {
    granted: true,
    granted_at: new Date().toISOString(),
  },
});
```

### 2. Pomocí React Hook

```typescript
import { useConsentAuditLogger } from "@/hooks/useConsentAuditLogger";

function MyComponent() {
  const { logAndReward } = useConsentAuditLogger();

  const handleCheckIn = async (data) => {
    // Save check-in to DB
    const { data: checkin } = await supabase
      .from("health_check_ins")
      .insert({ ...data })
      .select()
      .single();

    // Log and reward
    await logAndReward.mutateAsync({
      actionType: "checkin_completed",
      entityType: "checkin",
      entityId: checkin.id,
      summary: "User completed daily check-in",
      details: {
        pain_level: data.pain_level,
        energy_level: data.energy_level,
      },
    });
  };
}
```

### 3. Pouze Audit Logging (bez rewards)

```typescript
import { useConsentAuditLogger } from "@/hooks/useConsentAuditLogger";

const { logOnly } = useConsentAuditLogger();

// Pro akce, které se logují ale neodměňují
await logOnly.mutateAsync({
  actionType: "phi_access_granted",
  entityType: "document",
  entityId: documentId,
  summary: "Consultant accessed user health document",
  details: {
    document_type: "lab_result",
    consultant_id: consultantId,
  },
});
```

## 📊 Audit Journal Structure

Každý záznam v `audit_journal` obsahuje:

```typescript
{
  id: UUID,
  created_at: TIMESTAMP,
  
  // Who
  user_id: UUID,
  user_email: string,
  user_role: string,
  
  // What
  action_type: journal_action_type, // 'approve', 'complete', 'submit', etc.
  entity_type: string, // 'consent', 'registration', 'document', etc.
  entity_id: string,
  
  // Where
  area: journal_area, // 'consents', 'studies', 'documents', etc.
  
  // Details
  severity: journal_severity, // 'info', 'warning', 'error', etc.
  summary: string,
  details: JSONB,
  old_values: JSONB,
  new_values: JSONB,
  
  // Blockchain
  requires_blockchain_record: boolean,
  blockchain_status: string, // 'pending', 'submitted', 'confirmed'
  blockchain_tx_hash: string,
  blockchain_recorded_at: TIMESTAMP,
}
```

## 🔗 Blockchain Audit Records

Pro důležité akce se vytváří záznam v `blockchain_audit_records`:

```typescript
{
  id: UUID,
  event_type: blockchain_event_type,
  reference_table: string, // 'consents', 'registrations', etc.
  reference_id: UUID,
  
  payload_hash: string, // SHA-256 hash of payload
  payload: JSONB, // Actual data
  
  blockchain_network: string, // 'polygon'
  tx_hash: string,
  block_number: bigint,
  recorded_at: TIMESTAMP,
  
  status: string, // 'pending', 'submitted', 'confirmed', 'failed'
  error_message: string,
  retry_count: integer,
}
```

## 💰 Token Rewards System

### Architektura

Používáme **existující token rewards infrastrukturu** s:
- **`token_reward_rules` tabulka** - konfigurace odměn per action type
- **`process_token_reward()` RPC funkce** - server-side processing
- **Automatická deduplikace** - nemožnost odměnit stejnou akci 2x
- **Cooldown system** - limity na četnost odměn
- **Limity** - denní/týdenní/měsíční caps

### Jak fungují rewards?

1. **Akce je dokončena** (např. udělení consent, dokončení check-inu)
2. **Audit logger zavolá** existující `process_token_reward()` RPC funkci
3. **Server-side zpracování:**
   - Načtení pravidel z `token_reward_rules` pro daný `action_type`
   - Kontrola cooldown (nebyla akce odměněna nedávno?)
   - Kontrola limitů (denní/týdenní/měsíční)
   - Kontrola deduplikace (nebyla konkrétní akce s `reference_id` už odměněna?)
   - Výpočet částky: `amount = base_amount * multiplier` (s min/max constraints)
4. **Token transaction je vytvořena:**
   ```typescript
   {
     user_id: UUID,
     token_type: 'governance' | 'impact' | 'data',
     amount: number,
     transaction_type: 'reward',
     description: string,
     reference_id: UUID, // ID akce
     reference_type: string, // typ akce
     balance_after: number,
   }
   ```
5. **Membership balance je aktualizován**
6. **Blockchain záznam je vytvořen**

### Správa odměn (token_reward_rules)

Reward amounts jsou **konfigurovatelné v DB** bez potřeby code changes:

```sql
SELECT * FROM token_reward_rules 
WHERE action_type = 'consent_granted';
```

Pro změnu odměny:

```sql
UPDATE token_reward_rules 
SET base_amount = 15 
WHERE action_type = 'consent_granted';
```

### Token Typy

- **Governance tokens** - Za governance aktivity (consent, registration)
- **Impact tokens** - Za health outcomes (check-ins, improvements)
- **Data tokens** - Za data contributions (documents, questionnaires)

### Konfigurace Reward Rules

Reward rules jsou uloženy v `token_reward_rules` tabulce:

| Sloupec | Popis | Příklad |
|---------|-------|---------|
| `action_type` | Typ akce | `consent_granted` |
| `token_type` | Typ tokenu | `governance` |
| `base_amount` | Základní částka | `10` |
| `multiplier` | Násobitel | `1.0` |
| `min_amount` | Minimum | `10` |
| `max_amount` | Maximum | `10` |
| `cooldown_hours` | Cooldown v hodinách | `24` |
| `daily_limit` | Denní limit | `NULL` (unlimited) |
| `requires_membership` | Vyžaduje membership | `false` |

**Přidání nového reward rule:**

```sql
INSERT INTO token_reward_rules (
  action_type,
  action_name_cs,
  action_name_en,
  token_type,
  base_amount,
  cooldown_hours
) VALUES (
  'new_action_type',
  'Nová akce',
  'New Action',
  'impact',
  20,
  0
);
```

## 🔒 Bezpečnostní Considerations

### Fail-safe Design
- ❌ Pokud audit logging selže, **akce pokračuje** (non-blocking)
- ❌ Pokud token reward selže, **audit se uloží** (partial success)
- ✅ Všechny chyby jsou logovány přes `safeError()`
- ✅ Žádné sensitive data v error messages

### RLS Policies
```sql
-- Audit journal - users mohou číst pouze své záznamy
CREATE POLICY "Users can view own audit entries"
ON audit_journal FOR SELECT
USING (auth.uid() = user_id);

-- Admins mohou číst všechny
CREATE POLICY "Admins can view all audit entries"
ON audit_journal FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);
```

## 📈 Monitoring & Analytics

### Key Metrics Dashboard

1. **Token Economy Activity**
   - Total tokens awarded per day/week/month
   - Tokens by action type
   - User token balances distribution

2. **Engagement Metrics**
   - Active users completing rewarded actions
   - Most popular activities
   - Drop-off points

3. **Blockchain Status**
   - Pending blockchain records
   - Failed submissions (need retry)
   - Average confirmation time

## 🚀 Implementation Checklist

### Při přidání nové rewardovatelné akce:

- [ ] Přidat `ConsentActionType` do `consentAuditLogger.ts`
- [ ] Vytvořit RPC funkci `process_token_reward` handling pro nový typ
- [ ] Přidat token reward amount do konfigurace
- [ ] Implementovat deduplikaci (např. přes `reference_id`)
- [ ] Přidat blockchain event type pokud potřeba
- [ ] Aktualizovat dokumentaci
- [ ] Vytvořit test pro novou akci

## 📝 Příklady Integration

### StudyRegistration.tsx
```typescript
// Po vytvoření consent records
for (const consent of consentRecords) {
  await logAndRewardConsentAction({
    userId: user.id,
    actionType: "consent_granted",
    entityType: "consent",
    entityId: consent.id,
    summary: `User granted ${consent.consent_type} consent`,
    details: { consent_type: consent.consent_type, study_id: consent.study_id },
    newValues: { granted: true, granted_at: consent.granted_at },
  });
}

// Po dokončení questionnaire
await logAndRewardConsentAction({
  userId: user.id,
  actionType: "questionnaire_completed",
  entityType: "questionnaire",
  entityId: questionnaireData[0].id,
  summary: "User completed study registration questionnaire",
  details: { questionnaire_id: STUDY_ENROLLMENT_QUESTIONNAIRE_ID },
});
```

### Onboarding.tsx
```typescript
// Po claim_invitation
await logAndRewardConsentAction({
  userId: user.id,
  actionType: "study_registration_completed",
  entityType: "registration",
  entityId: inviteData?.study_id,
  summary: `User completed registration to ${inviteData?.study_name}`,
  details: { invitation_code: code, study_id: inviteData?.study_id },
});
```

### ActivityCheckIn Component
```typescript
const { logAndReward } = useConsentAuditLogger();

// Po uložení check-inu
await logAndReward.mutateAsync({
  actionType: "checkin_completed",
  entityType: "checkin",
  entityId: checkinId,
  summary: "Daily check-in completed",
  details: { pain_level, energy_level, mood_level },
});
```

## 🎓 Best Practices

### DO ✅
- Používat `logAndRewardConsentAction` pro většinu akcí
- Logovat detaily důležité pro audit (ne sensitive data v summary!)
- Používat konzistentní `entity_type` a `action_type` hodnoty
- Testovat deduplikaci (nemůžeme odměnit dvakrát)
- Handleovat chyby gracefully (non-blocking)

### DON'T ❌
- Nelogovat sensitive data do `summary` pole (použít `details` s proper masking)
- Nečekat na blockchain confirmation (async process)
- Neblokovat UI na reward processing
- Neodměňovat stejnou akci vícekrát
- Nezapomenout invalidovat queries po reward

## 📚 Související Dokumenty

- [Data Consent Workflow](./sensitive-data_CONSENT_WORKFLOW.md)
- [Security Guidelines](../../.github/copilot-instructions.md)
- [Token Economics](../../docs/tokenomics/README.md)
- [Blockchain Integration](../../docs/blockchain/README.md)
