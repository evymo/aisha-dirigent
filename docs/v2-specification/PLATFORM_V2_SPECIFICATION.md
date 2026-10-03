# Platform - V2 Kompletní Specifikace

**Datum:** 29. prosince 2025
**Verze dokumentu:** 1.0
**Účel:** Zadání pro kompletní přepracování aplikace od základu

---

## ČÁST 1: ANALÝZA SOUČASNÉHO STAVU (V1)

### 1.1 Přehled V1

| Metrika | Hodnota | Hodnocení |
|---------|---------|-----------|
| Řádků kódu (src/) | 22,876 | Příliš velké |
| Databázových tabulek | 87+ | Extrémně komplexní |
| SQL migračních souborů | 130+ | Neudržitelné |
| Custom React hooks | 53+ | Fragmentované |
| Edge Functions | 10 | OK |
| Enum typů v DB | 34 | Příliš mnoho |
| Velikost types.ts | 303KB | Kriticky velké |

### 1.2 Identifikované Problémy V1

#### A) ARCHITEKTONICKÉ PROBLÉMY

| # | Problém | Důsledek | Závažnost |
|---|---------|----------|-----------|
| 1 | **Monolitická architektura** | Vše v jednom projektu, nemožnost nezávislého škálování | KRITICKÁ |
| 2 | **87+ tabulek v jedné DB** | Příliš komplexní schéma, těžká údržba | KRITICKÁ |
| 3 | **Smíšení domén** | Zdraví, obchod, tokeny, produkce v jednom | VYSOKÁ |
| 4 | **130+ migračních souborů** | Mnoho "fix" migrací = špatný návrh | VYSOKÁ |
| 5 | **Chybí API Gateway** | Přímé volání Supabase z frontendu | STŘEDNÍ |
| 6 | **53+ custom hooks** | Fragmentovaná, duplicitní logika | STŘEDNÍ |

#### B) PROBLÉMY AUDITOVATELNOSTI

| # | Problém | Důsledek |
|---|---------|----------|
| 1 | **Audit pouze v RPC funkcích** | Ne všechny operace jsou auditovány |
| 2 | **Audit journal v hlavní DB** | Není oddělen od provozních dat |
| 3 | **Chybí strukturované event sourcing** | Nelze rekonstruovat historii změn |
| 4 | **IP/User-Agent v audit logu** | Ale chybí correlation ID |
| 5 | **Chybí centrální audit service** | Audit rozptýlen v SQL funkcích |

#### C) PROBLÉMY BEZPEČNOSTI

| # | Problém | Důsledek |
|---|---------|----------|
| 1 | **sensitive-data a non-sensitive-data ve stejné DB** | Komplikovaná compliance |
| 2 | **RLS jako jediná ochrana** | Chybí application-level security |
| 3 | **Session management ve frontendu** | Fragmentované řešení |
| 4 | **Consent tracking neatomický** | Možné race conditions |

#### D) PROBLÉMY UDRŽITELNOSTI

| # | Problém | Důsledek |
|---|---------|----------|
| 1 | **303KB types.ts** | Obrovský generovaný soubor |
| 2 | **Duplikace RPC funkcí** | Mnoho variant `_audited`, `_admin` |
| 3 | **Business logika rozptýlena** | V DB, Edge Functions i frontend |
| 4 | **Chybí domain boundaries** | Vše může záviset na všem |

---

## ČÁST 2: ARCHITEKTURA V2

### 2.1 Vysokoúrovňový Přehled

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Web Application (React/Next.js)                      ││
│  │  • Member Portal  • Partner Portal  • Admin Portal  • Public Pages     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  • Rate Limiting  • Authentication  • Request Routing  • CORS          ││
│  │  • Request/Response Logging  • API Versioning  • Load Balancing        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│   IDENTITY SERVICE  │ │    AUDIT SERVICE    │ │  NOTIFICATION SVC   │
│  ─────────────────  │ │  ─────────────────  │ │  ─────────────────  │
│  • Authentication   │ │  • Event Logging    │ │  • Email/SMS        │
│  • Authorization    │ │  • Compliance       │ │  • Push             │
│  • Session Mgmt     │ │  • Blockchain       │ │  • In-app           │
│  • RBAC/ABAC        │ │  • Retention        │ │  • Webhooks         │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
              │                       │                       │
              └───────────────────────┼───────────────────────┘
                                      │
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DOMAIN SERVICES (Bounded Contexts)                  │
├─────────────────────┬─────────────────────┬─────────────────────────────────┤
│                     │                     │                                 │
│  ┌───────────────┐  │  ┌───────────────┐  │  ┌───────────────┐              │
│  │ HEALTH        │  │  │ RESEARCH      │  │  │ COMMERCE      │              │
│  │ SERVICE       │  │  │ SERVICE       │  │  │ SERVICE       │              │
│  │ ───────────── │  │  │ ───────────── │  │  │ ───────────── │              │
│  │ • Check-ins   │  │  │ • Studies     │  │  │ • Products    │              │
│  │ • Documents   │  │  │ • Registrations │  │  │ • Orders      │              │
│  │ • Lab Results │  │  │ • Protocols   │  │  │ • Payments    │              │
│  │ • Assessments │  │  │ • Consents    │  │  │ • Shipping    │              │
│  │ • Dosing      │  │  │ • Outcomes    │  │  │ • Inventory   │              │
│  └───────────────┘  │  └───────────────┘  │  └───────────────┘              │
│         │           │         │           │         │                       │
│  ┌───────────────┐  │  ┌───────────────┐  │  ┌───────────────┐              │
│  │ PARTNER       │  │  │ PRODUCTION    │  │  │ TOKEN         │              │
│  │ SERVICE       │  │  │ SERVICE       │  │  │ SERVICE       │              │
│  │ ───────────── │  │  │ ───────────── │  │  │ ───────────── │              │
│  │ • Profiles    │  │  │ • Batches     │  │  │ • Allocations │              │
│  │ • Scheduling  │  │  │ • QC          │  │  │ • Transactions│              │
│  │ • Matching    │  │  │ • Vials       │  │  │ • Rewards     │              │
│  │ • Reviews     │  │  │ • Labels      │  │  │ • Governance  │              │
│  └───────────────┘  │  └───────────────┘  │  └───────────────┘              │
│                     │                     │                                 │
└─────────────────────┴─────────────────────┴─────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EVENT BUS (Message Queue)                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  • Domain Events  • Integration Events  • Commands  • Sagas            ││
│  │  (RabbitMQ / Apache Kafka / NATS / Redis Streams)                       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                      │
├───────────────────┬───────────────────┬───────────────────┬─────────────────┤
│   HEALTH DB       │   RESEARCH DB     │   COMMERCE DB     │   AUDIT DB      │
│   (PostgreSQL)    │   (PostgreSQL)    │   (PostgreSQL)    │   (TimescaleDB) │
│   ───────────     │   ───────────     │   ───────────     │   ──────────    │
│   sensitive data Data        │   Study Data      │   Orders/Products │   Event Log     │
│   compliance Compliant │   Protocols       │   Payments        │   Immutable     │
└───────────────────┴───────────────────┴───────────────────┴─────────────────┘
```

### 2.2 Principy Návrhu V2

| # | Princip | Popis |
|---|---------|-------|
| 1 | **Domain-Driven Design (DDD)** | Jasné bounded contexts, ubiquitous language |
| 2 | **Microservices** | Nezávislé služby, vlastní databáze |
| 3 | **Event Sourcing** | Všechny změny jako události |
| 4 | **CQRS** | Oddělení čtení a zápisu |
| 5 | **API-First** | Kontrakty před implementací |
| 6 | **Security by Design** | Bezpečnost od začátku |
| 7 | **Observability** | Logging, tracing, metrics |

---

## ČÁST 3: BOUNDED CONTEXTS (Domény)

### 3.1 Přehled Domén

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PLATFORM V2 DOMAINS                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │
│  │  IDENTITY   │    │   HEALTH    │    │  RESEARCH   │    │  COMMERCE   │   │
│  │  CONTEXT    │    │   CONTEXT   │    │   CONTEXT   │    │   CONTEXT   │   │
│  │             │    │             │    │             │    │             │   │
│  │ Users       │    │ Check-ins   │    │ Studies     │    │ Products    │   │
│  │ Roles       │    │ Documents   │    │ Registrations │    │ Orders      │   │
│  │ Permissions │    │ Labs        │    │ Protocols   │    │ Payments    │   │
│  │ Sessions    │    │ Assessments │    │ Consents    │    │ Shipments   │   │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘   │
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │
│  │  PARTNER    │    │ PRODUCTION  │    │   TOKEN     │    │    AUDIT    │   │
│  │  CONTEXT    │    │   CONTEXT   │    │   CONTEXT   │    │   CONTEXT   │   │
│  │             │    │             │    │             │    │             │   │
│  │ Profiles    │    │ Batches     │    │ Allocations │    │ Events      │   │
│  │ Scheduling  │    │ Quality     │    │ Transactions│    │ Compliance  │   │
│  │ Matching    │    │ Inventory   │    │ Rewards     │    │ Blockchain  │   │
│  │ Reviews     │    │ Labels      │    │ Governance  │    │ Retention   │   │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘   │
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐                                         │
│  │ NOTIFICATION│    │   CONTENT   │                                         │
│  │   CONTEXT   │    │   CONTEXT   │                                         │
│  │             │    │             │                                         │
│  │ Email       │    │ Archive     │                                         │
│  │ Push        │    │ Translations│                                         │
│  │ In-app      │    │ i18n        │                                         │
│  │ Webhooks    │    │ CMS         │                                         │
│  └─────────────┘    └─────────────┘                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Detailní Specifikace Domén

---

#### DOMÉNA 1: IDENTITY (Identita)

**Odpovědnost:** Správa uživatelů, autentizace, autorizace, session management

**Agregáty:**
```typescript
// Aggregate: User
interface User {
  id: UserId;
  email: Email;
  profile: UserProfile;
  credentials: Credentials[];
  status: UserStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Aggregate: Role
interface Role {
  id: RoleId;
  name: RoleName;
  permissions: Permission[];
  isSystemRole: boolean;
}

// Aggregate: Session
interface Session {
  id: SessionId;
  userId: UserId;
  deviceInfo: DeviceInfo;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  lastActivityAt: Timestamp;
}
```

**Domain Events:**
- `UserRegistered`
- `UserEmailVerified`
- `UserPasswordChanged`
- `UserRoleAssigned`
- `UserRoleRevoked`
- `SessionCreated`
- `SessionTerminated`
- `PasswordResetRequested`

**Tabulky (12):**
| Tabulka | Účel |
|---------|------|
| users | Základní údaje uživatele |
| user_profiles | Profilové informace |
| user_credentials | Přihlašovací údaje (hesla, OAuth) |
| roles | Definice rolí |
| permissions | Definice oprávnění |
| role_permissions | Mapování role → oprávnění |
| user_roles | Přiřazení role uživateli |
| sessions | Aktivní session |
| password_reset_tokens | Tokeny pro reset hesla |
| email_verification_tokens | Tokeny pro ověření emailu |
| mfa_configs | Konfigurace MFA |
| login_attempts | Historie pokusů o přihlášení |

---

#### DOMÉNA 2: HEALTH (Zdraví)

**Odpovědnost:** Správa citlivých dat (sensitive data), check-iny, dokumenty, laboratorní výsledky

**Agregáty:**
```typescript
// Aggregate: ActivityRecord
interface ActivityRecord {
  id: ActivityRecordId;
  userId: UserId;
  checkIns: CheckIn[];
  documents: ActivityDocument[];
  labResults: LabResult[];
}

// Aggregate: OperationalAssessment
interface OperationalAssessment {
  id: AssessmentId;
  userId: UserId;
  dimensions: AssessmentDimension[];
  tags: AssessmentTag[];
  status: AssessmentStatus;
  completedAt?: Timestamp;
}

// Aggregate: DistributionPlan
interface DistributionPlan {
  id: DistributionPlanId;
  userId: UserId;
  protocolId: ProtocolId;
  schedule: DistributionSchedule;
  logs: DosingLog[];
}
```

**Domain Events:**
- `CheckInSubmitted`
- `ActivityDocumentUploaded`
- `ActivityDocumentVerified`
- `LabResultRecorded`
- `OperationalAssessmentStarted`
- `OperationalAssessmentCompleted`
- `DistributionLogRecorded`
- `DistributionPlanAdjusted`

**Tabulky (15):**
| Tabulka | Účel |
|---------|------|
| health_records | Hlavní privátní záznam |
| check_ins | Denní check-iny |
| check_in_metrics | Metriky check-inu |
| health_documents | Zdravotní dokumenty |
| document_analyses | AI analýzy dokumentů |
| lab_results | Laboratorní výsledky |
| lab_result_values | Hodnoty lab. výsledků |
| biomarker_ranges | Referenční rozsahy |
| operational_assessments | Klinická hodnocení |
| assessment_dimensions | Dimenze hodnocení |
| assessment_tags | Tagy hodnocení |
| distribution_plans | Plány dávkování |
| activity_logs | Záznamy dávkování |
| wearables_data | Data z nositelných zařízení |
| compliance_scores | Skóre dodržování |

---

#### DOMÉNA 3: RESEARCH (Výzkum)

**Odpovědnost:** Správa studií, registration, protokoly, souhlasy

**Agregáty:**
```typescript
// Aggregate: Study
interface Study {
  id: StudyId;
  name: LocalizedText;
  description: LocalizedText;
  type: StudyType;
  status: StudyStatus;
  protocol: StudyProtocol;
  registrations: Registration[];
  blindingConfig?: BlindingConfig;
}

// Aggregate: Registration
interface Registration {
  id: RegistrationId;
  studyId: StudyId;
  userId: UserId;
  consents: Consent[];
  status: RegistrationStatus;
  arm?: StudyArm;
}

// Aggregate: Consent
interface Consent {
  id: ConsentId;
  userId: UserId;
  type: ConsentType;
  version: ConsentVersion;
  grantedAt: Timestamp;
  revokedAt?: Timestamp;
}
```

**Domain Events:**
- `StudyCreated`
- `StudyPublished`
- `StudyCompleted`
- `RegistrationRequested`
- `RegistrationApproved`
- `RegistrationCompleted`
- `RegistrationWithdrawn`
- `ConsentGranted`
- `ConsentRevoked`
- `QualificationTestPassed`
- `QualificationTestFailed`

**Tabulky (14):**
| Tabulka | Účel |
|---------|------|
| studies | Definice studií |
| study_protocols | Protokoly studií |
| study_arms | Ramena studií (zaslepení) |
| blinding_configs | Konfigurace zaslepení |
| registrations | Zařazení do studií |
| registration_consents | Souhlasy pro registration |
| consent_templates | Šablony souhlasů |
| consent_versions | Verze souhlasů |
| qualification_tests | Kvalifikační testy |
| test_questions | Otázky testů |
| test_attempts | Pokusy o test |
| study_consultants | Konzultanti studie |
| questionnaires | Dotazníky |
| questionnaire_responses | Odpovědi na dotazníky |

---

#### DOMÉNA 4: COMMERCE (Obchod)

**Odpovědnost:** Produkty, objednávky, platby, doručení

**Agregáty:**
```typescript
// Aggregate: Product
interface Product {
  id: ProductId;
  name: LocalizedText;
  description: LocalizedText;
  price: Money;
  accessRules: ProductAccessRule[];
  inventory: InventoryInfo;
}

// Aggregate: Order
interface Order {
  id: OrderId;
  userId: UserId;
  items: OrderItem[];
  status: OrderStatus;
  payment: PaymentInfo;
  shipment: ShipmentInfo;
  totals: OrderTotals;
}

// Aggregate: Cart
interface Cart {
  id: CartId;
  userId: UserId;
  items: CartItem[];
  expiresAt: Timestamp;
}
```

**Domain Events:**
- `ProductCreated`
- `ProductUpdated`
- `CartItemAdded`
- `CartItemRemoved`
- `OrderCreated`
- `OrderPaid`
- `OrderShipped`
- `OrderDelivered`
- `OrderCancelled`
- `RefundIssued`

**Tabulky (12):**
| Tabulka | Účel |
|---------|------|
| products | Katalog produktů |
| product_variants | Varianty produktů |
| product_access_rules | Pravidla přístupu |
| carts | Nákupní košíky |
| cart_items | Položky košíku |
| orders | Objednávky |
| order_items | Položky objednávky |
| order_status_history | Historie stavů |
| payments | Platby |
| payment_transactions | Transakce plateb |
| shipments | Zásilky |
| shipment_tracking | Sledování zásilek |

---

#### DOMÉNA 5: PARTNER (Partneři)

**Odpovědnost:** Správa partnerů, plánování, matching, recenze

**Agregáty:**
```typescript
// Aggregate: Partner
interface Partner {
  id: PartnerId;
  userId: UserId;
  profile: PartnerProfile;
  certifications: Certification[];
  availability: Availability[];
  type: PartnerType; // professional | amateur
}

// Aggregate: Appointment
interface Appointment {
  id: AppointmentId;
  partnerId: PartnerId;
  memberId: UserId;
  scheduledAt: Timestamp;
  duration: Duration;
  status: AppointmentStatus;
  notes: AppointmentNote[];
}

// Aggregate: DataSharingConsent
interface DataSharingConsent {
  id: ConsentId;
  memberId: UserId;
  partnerId: PartnerId;
  permissions: DataPermission[];
  grantedAt: Timestamp;
  expiresAt?: Timestamp;
}
```

**Domain Events:**
- `PartnerRegistered`
- `PartnerCertified`
- `PartnerAvailabilityUpdated`
- `AppointmentScheduled`
- `AppointmentCompleted`
- `AppointmentCancelled`
- `DataSharingConsentGranted`
- `DataSharingConsentRevoked`
- `ReviewSubmitted`

**Tabulky (10):**
| Tabulka | Účel |
|---------|------|
| partners | Základní údaje partnera |
| partner_profiles | Veřejný profil |
| partner_certifications | Certifikace |
| partner_availability | Dostupnost |
| partner_matching | Preference matchování |
| appointments | Schůzky |
| appointment_notes | Poznámky ke schůzkám |
| data_sharing_consents | Souhlasy se sdílením |
| consent_permissions | Detailní oprávnění |
| reviews | Recenze |

---

#### DOMÉNA 6: PRODUCTION (Výroba)

**Odpovědnost:** Výrobní dávky, kvalita, inventář, etikety

**Agregáty:**
```typescript
// Aggregate: Batch
interface Batch {
  id: BatchId;
  batchNumber: string;
  product: ProductReference;
  status: BatchStatus;
  purpose: BatchPurpose;
  vials: Vial[];
  qualityChecks: QualityCheck[];
  milestones: Milestone[];
}

// Aggregate: Vial
interface Vial {
  id: VialId;
  batchId: BatchId;
  serialNumber: string;
  status: VialStatus;
  contentType: VialContentType;
  assignment?: VialAssignment;
}
```

**Domain Events:**
- `BatchCreated`
- `BatchStarted`
- `BatchQCPassed`
- `BatchQCFailed`
- `BatchReleased`
- `VialManufactured`
- `VialAssigned`
- `VialDispensed`
- `MilestoneAchieved`

**Tabulky (10):**
| Tabulka | Účel |
|---------|------|
| batches | Výrobní dávky |
| batch_protocols | Výrobní protokoly |
| batch_milestones | Milníky dávky |
| quality_checks | Kontroly kvality |
| vials | Lahvičky |
| vial_assignments | Přiřazení lahviček |
| production_logs | Výrobní logy |
| label_templates | Šablony etiket |
| label_prints | Tištěné etikety |
| inventory_movements | Pohyby inventáře |

---

#### DOMÉNA 7: TOKEN (Tokeny)

**Odpovědnost:** Tokenová ekonomika, transakce, odměny

**Agregáty:**
```typescript
// Aggregate: TokenAccount
interface TokenAccount {
  id: AccountId;
  userId: UserId;
  balances: TokenBalance[];
  locks: TokenLock[];
}

// Aggregate: TokenTransaction
interface TokenTransaction {
  id: TransactionId;
  type: TransactionType;
  from: AccountId;
  to: AccountId;
  amount: TokenAmount;
  reason: TransactionReason;
  createdAt: Timestamp;
}
```

**Domain Events:**
- `TokensAllocated`
- `TokensTransferred`
- `TokensLocked`
- `TokensUnlocked`
- `TokensBurned`
- `RewardEarned`

**Tabulky (8):**
| Tabulka | Účel |
|---------|------|
| token_accounts | Účty uživatelů |
| token_balances | Zůstatky |
| token_transactions | Transakce |
| token_locks | Zamčené tokeny |
| token_burns | Spálené tokeny |
| reward_rules | Pravidla odměn |
| reward_events | Události odměn |
| token_config | Konfigurace tokenů |

---

#### DOMÉNA 8: AUDIT (Audit)

**Odpovědnost:** Centralizované logování, compliance, blockchain audit

**Agregáty:**
```typescript
// Aggregate: AuditEvent
interface AuditEvent {
  id: EventId;
  correlationId: CorrelationId;
  timestamp: Timestamp;
  actor: ActorInfo;
  action: AuditAction;
  resource: ResourceInfo;
  context: AuditContext;
  outcome: AuditOutcome;
}

// Aggregate: BlockchainRecord
interface BlockchainRecord {
  id: RecordId;
  eventType: BlockchainEventType;
  payload: BlockchainPayload;
  hash: Hash;
  previousHash: Hash;
  createdAt: Timestamp;
}
```

**Domain Events:**
- `AuditEventRecorded`
- `BlockchainRecordCreated`
- `ComplianceReportGenerated`

**Tabulky (6):**
| Tabulka | Účel |
|---------|------|
| audit_events | Hlavní audit log |
| audit_event_details | Detaily události |
| blockchain_records | Blockchain záznamy |
| compliance_reports | Reporty compliance |
| retention_policies | Politiky uchovávání |
| audit_queries | Uložené dotazy |

---

#### DOMÉNA 9: NOTIFICATION (Notifikace)

**Odpovědnost:** Všechny typy notifikací

**Agregáty:**
```typescript
// Aggregate: Notification
interface Notification {
  id: NotificationId;
  userId: UserId;
  type: NotificationType;
  channel: NotificationChannel;
  content: NotificationContent;
  status: NotificationStatus;
  sentAt?: Timestamp;
  readAt?: Timestamp;
}
```

**Domain Events:**
- `NotificationCreated`
- `NotificationSent`
- `NotificationRead`
- `NotificationFailed`

**Tabulky (5):**
| Tabulka | Účel |
|---------|------|
| notifications | Notifikace |
| notification_templates | Šablony |
| notification_preferences | Preference uživatele |
| notification_channels | Kanály |
| delivery_attempts | Pokusy o doručení |

---

#### DOMÉNA 10: CONTENT (Obsah)

**Odpovědnost:** CMS, archiv, překlady

**Agregáty:**
```typescript
// Aggregate: Document
interface Document {
  id: DocumentId;
  type: DocumentType;
  title: LocalizedText;
  content: LocalizedText;
  metadata: DocumentMetadata;
  versions: DocumentVersion[];
}

// Aggregate: Translation
interface Translation {
  key: TranslationKey;
  namespace: Namespace;
  values: Map<Language, string>;
}
```

**Domain Events:**
- `DocumentCreated`
- `DocumentUpdated`
- `DocumentPublished`
- `TranslationUpdated`

**Tabulky (6):**
| Tabulka | Účel |
|---------|------|
| documents | Dokumenty |
| document_versions | Verze dokumentů |
| document_metadata | Metadata |
| translations | Překlady |
| translation_namespaces | Namespace překladů |
| supported_languages | Podporované jazyky |

---

## ČÁST 4: TECHNICKÝ STACK V2

### 4.1 Doporučený Stack

| Vrstva | Technologie | Důvod |
|--------|-------------|-------|
| **Frontend** | Next.js 15 + React 19 | SSR, App Router, Server Components |
| **Styling** | Tailwind CSS + shadcn/ui | Konzistence s V1, osvědčené řešení |
| **State** | TanStack Query + Zustand | Server state + jednoduchý client state |
| **Forms** | React Hook Form + Zod | Osvědčené z V1 |
| **API Gateway** | Kong / Traefik / AWS API Gateway | Centralizované řízení API |
| **Backend Services** | Node.js + Fastify / NestJS | TypeScript, rychlost, modularita |
| **Message Queue** | RabbitMQ / Redis Streams | Event-driven komunikace |
| **Primary DB** | PostgreSQL 16 | Osvědčená databáze |
| **Audit DB** | TimescaleDB | Time-series optimalizace |
| **Cache** | Redis | Session, cache, pub/sub |
| **Search** | Meilisearch / Typesense | Full-text search |
| **File Storage** | S3-compatible (MinIO/Cloudflare R2) | Škálovatelné úložiště |
| **Monitoring** | Prometheus + Grafana | Metriky a dashboardy |
| **Tracing** | OpenTelemetry + Jaeger | Distribuované trasování |
| **Logging** | ELK Stack / Loki | Centralizované logy |
| **CI/CD** | GitHub Actions | Osvědčené z V1 |
| **Container** | Docker + Kubernetes | Orchestrace |
| **IaC** | Terraform / Pulumi | Infrastructure as Code |

### 4.2 Alternativní Stack (Jednodušší)

Pro menší tým nebo rychlejší start:

| Vrstva | Technologie | Důvod |
|--------|-------------|-------|
| **Frontend** | Next.js 15 | Full-stack framework |
| **Backend** | Next.js API Routes + tRPC | Type-safe API |
| **Database** | Supabase (PostgreSQL) | Managed, osvědčené |
| **Auth** | Supabase Auth / Clerk | Managed auth |
| **Queue** | Supabase Edge Functions + pg_cron | Jednodušší async |
| **Monitoring** | Sentry + Vercel Analytics | Managed monitoring |
| **Deployment** | Vercel + Supabase | Managed infrastructure |

---

## ČÁST 5: DATABÁZOVÉ SCHÉMA V2

### 5.1 Principy Návrhu DB

1. **Jedna DB per bounded context** (nebo schéma per context)
2. **Explicitní audit fieldy** na každé tabulce
3. **Soft delete** jako výchozí
4. **UUID** jako primární klíče
5. **Timestamptz** pro všechny časové údaje
6. **JSONB** pro flexibilní metadata
7. **Enum typy** pouze pro stabilní hodnoty

### 5.2 Standardní Audit Fieldy

```sql
-- Každá tabulka MUSÍ obsahovat:
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
created_by UUID REFERENCES identity.users(id),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_by UUID REFERENCES identity.users(id),
deleted_at TIMESTAMPTZ,
deleted_by UUID REFERENCES identity.users(id),
version INTEGER NOT NULL DEFAULT 1
```

### 5.3 Standardní Triggery

```sql
-- Auto-update updated_at
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON {table}
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Audit log trigger
CREATE TRIGGER audit_log_trigger
AFTER INSERT OR UPDATE OR DELETE ON {table}
FOR EACH ROW
EXECUTE FUNCTION audit.log_change();

-- Optimistic locking
CREATE TRIGGER check_version
BEFORE UPDATE ON {table}
FOR EACH ROW
EXECUTE FUNCTION check_version();
```

### 5.4 Celkový Počet Tabulek V2

| Doména | Počet Tabulek |
|--------|---------------|
| Identity | 12 |
| Activity | 15 |
| Research | 14 |
| Commerce | 12 |
| Partner | 10 |
| Production | 10 |
| Token | 8 |
| Audit | 6 |
| Notification | 5 |
| Content | 6 |
| **CELKEM** | **98** |

**Poznámka:** Podobný počet jako V1 (87), ale **jasně oddělené domény** a **standardizovaná struktura**.

---

## ČÁST 6: API DESIGN

### 6.1 API Konvence

```
Base URL: https://api.platform.example/v1

# Resource naming (plural nouns)
GET    /health/check-ins           # List
POST   /health/check-ins           # Create
GET    /health/check-ins/:id       # Get one
PUT    /health/check-ins/:id       # Update
DELETE /health/check-ins/:id       # Delete

# Nested resources
GET    /research/studies/:id/registrations

# Actions (verbs)
POST   /commerce/orders/:id/cancel
POST   /identity/auth/login
POST   /identity/auth/logout

# Query parameters
GET    /health/check-ins?from=2025-01-01&to=2025-12-31&limit=50&offset=0

# Filtering
GET    /commerce/orders?status=pending,paid

# Sorting
GET    /research/studies?sort=-created_at,name

# Fields selection
GET    /partner/partners?fields=id,name,rating
```

### 6.2 Standardní Response Format

```typescript
// Success response
{
  "success": true,
  "data": { ... } | [...],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "hasMore": true
  }
}

// Error response
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ],
    "requestId": "req_abc123"
  }
}
```

### 6.3 API Versioning

```
# URL versioning (preferováno)
https://api.platform.example/v1/...
https://api.platform.example/v2/...

# Header versioning (alternativa)
Accept: application/vnd.platform.v1+json
```

---

## ČÁST 7: AUDIT SYSTÉM V2

### 7.1 Centralizovaný Audit

```typescript
interface AuditEvent {
  // Identifikace
  id: string;
  correlationId: string;        // Propojení souvisejících událostí
  causationId?: string;         // ID události, která způsobila tuto

  // Čas
  timestamp: Date;

  // Kdo
  actor: {
    type: 'user' | 'system' | 'service';
    id: string;
    ip?: string;
    userAgent?: string;
    sessionId?: string;
  };

  // Co
  action: {
    type: AuditActionType;      // 'create' | 'read' | 'update' | 'delete' | 'login' | ...
    category: AuditCategory;    // 'phi' | 'auth' | 'admin' | 'commerce' | ...
    name: string;               // 'health.check_in.create'
  };

  // Na čem
  resource: {
    type: string;               // 'health.check_in'
    id: string;
    ownerId?: string;           // Pro sensitive data - vlastník dat
  };

  // Kontext
  context: {
    service: string;            // 'health-service'
    environment: string;        // 'production'
    version: string;            // '2.1.0'
    metadata?: Record<string, unknown>;
  };

  // Výsledek
  outcome: {
    status: 'success' | 'failure';
    errorCode?: string;
    duration?: number;          // ms
  };

  // Data (BEZ sensitive-data!)
  changes?: {
    before?: Record<string, unknown>;  // Redaktováno
    after?: Record<string, unknown>;   // Redaktováno
    diff?: string[];                   // Změněná pole
  };
}
```

### 7.2 Audit Categories

| Kategorie | Popis | Retention |
|-----------|-------|-----------|
| `phi` | Přístup ke privátním datům | 7 let (compliance) |
| `auth` | Autentizační události | 2 roky |
| `admin` | Administrativní akce | 5 let |
| `commerce` | Obchodní transakce | 10 let |
| `consent` | Změny souhlasů | 7 let |
| `system` | Systémové události | 1 rok |

### 7.3 Audit API

```typescript
// Publikování události
await auditService.publish({
  action: {
    type: 'read',
    category: 'phi',
    name: 'health.check_in.list'
  },
  resource: {
    type: 'health.check_in',
    id: '*',
    ownerId: userId
  },
  context: {
    service: 'health-service',
    metadata: { limit: 30, dateRange: '2025-01' }
  }
});

// Dotazování (admin)
const events = await auditService.query({
  actor: { id: userId },
  action: { category: 'phi' },
  timeRange: { from: '2025-01-01', to: '2025-01-31' },
  limit: 100
});
```

---

## ČÁST 8: BEZPEČNOST V2

### 8.1 Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: NETWORK                                            │
│ • WAF (Web Application Firewall)                           │
│ • DDoS protection                                           │
│ • TLS 1.3                                                   │
│ • IP whitelisting (admin)                                   │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: API GATEWAY                                        │
│ • Rate limiting                                             │
│ • Request validation                                        │
│ • JWT verification                                          │
│ • CORS enforcement                                          │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: SERVICE                                            │
│ • Authorization (RBAC/ABAC)                                │
│ • Input validation (Zod)                                   │
│ • Business rule enforcement                                │
│ • Audit logging                                            │
├─────────────────────────────────────────────────────────────┤
│ Layer 4: DATA                                               │
│ • RLS (Row Level Security)                                 │
│ • Column encryption                                         │
│ • Connection pooling                                        │
│ • Query parameterization                                   │
├─────────────────────────────────────────────────────────────┤
│ Layer 5: INFRASTRUCTURE                                     │
│ • Secrets management (Vault)                               │
│ • Network isolation                                         │
│ • Backup encryption                                         │
│ • Compliance monitoring                                    │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 sensitive data Protection Strategy

```typescript
// sensitive data Access Flow
async function accessSensitiveData(userId: string, targetId: string) {
  // 1. Verify authentication
  const session = await verifySession(request);

  // 2. Check secure mode (re-authentication)
  if (!session.phiModeActive) {
    throw new SecureModeRequired();
  }

  // 3. Verify authorization
  const canAccess = await authz.check({
    actor: session.userId,
    action: 'read',
    resource: { type: 'health_data', id: targetId }
  });

  if (!canAccess) {
    // Log attempt
    await audit.log({
      action: { type: 'read', category: 'phi', name: 'access_denied' },
      outcome: { status: 'failure', errorCode: 'UNAUTHORIZED' }
    });
    throw new Forbidden();
  }

  // 4. Check consent (if accessing other's data)
  if (targetId !== session.userId) {
    const hasConsent = await consent.check(session.userId, targetId);
    if (!hasConsent) throw new NoConsent();
  }

  // 5. Audit the access
  await audit.log({
    action: { type: 'read', category: 'phi', name: 'health_data.read' },
    resource: { type: 'health_data', id: targetId, ownerId: targetId },
    outcome: { status: 'success' }
  });

  // 6. Return data (minimal fields)
  return await healthService.getData(targetId, {
    fields: ['id', 'date', 'summary']
  });
}
```

### 8.3 compliance Compliance Checklist

| Požadavek | Implementace V2 |
|-----------|-----------------|
| Access Controls | RBAC + ABAC + RLS |
| Audit Controls | Centrální Audit Service |
| Integrity Controls | Optimistic locking + Checksums |
| Transmission Security | TLS 1.3 + mTLS mezi službami |
| sensitive data Encryption | AES-256 at rest, TLS in transit |
| Automatic Logoff | Session timeout (30 min sensitive-data) |
| Unique User ID | UUID per user |
| Emergency Access | Break-glass procedure |
| Audit Log Protection | Append-only, separate DB |
| Backup Encryption | Encrypted backups |

---

## ČÁST 9: TESTOVÁNÍ V2

### 9.1 Test Pyramida

```
                    ┌─────────────────┐
                    │   E2E Tests     │  10%
                    │  (Playwright)   │
                    ├─────────────────┤
                    │ Integration     │  30%
                    │ Tests           │
                    ├─────────────────┤
                    │  Unit Tests     │  60%
                    │                 │
                    └─────────────────┘
```

### 9.2 Test Requirements

| Typ | Coverage Target | Nástroj |
|-----|-----------------|---------|
| Unit Tests | 80%+ | Vitest |
| Integration Tests | Kritické paths | Vitest + Testcontainers |
| E2E Tests | Happy paths | Playwright |
| Security Tests | 100% auth/authz | Custom + OWASP ZAP |
| Performance Tests | P95 < 200ms | k6 |
| Contract Tests | All APIs | Pact |

### 9.3 Test Naming Convention

```typescript
describe('ActivityService', () => {
  describe('submitCheckIn', () => {
    it('should create check-in for authenticated user', async () => {});
    it('should reject check-in without authentication', async () => {});
    it('should audit sensitive data write operation', async () => {});
    it('should validate input data', async () => {});
  });
});
```

---

## ČÁST 10: DEPLOYMENT & OPERATIONS

### 10.1 Deployment Pipeline

```yaml
# Simplified CI/CD Pipeline
stages:
  - lint           # ESLint, TypeScript
  - test           # Unit, Integration
  - security       # SAST, Dependency scan
  - build          # Docker images
  - deploy-staging # Staging environment
  - e2e-tests      # Playwright on staging
  - deploy-prod    # Production (manual approval)
  - smoke-tests    # Production verification
```

### 10.2 Environment Strategy

| Environment | Účel | Data |
|-------------|------|------|
| Local | Development | Fake/Seed |
| CI | Automated tests | Fake |
| Staging | Pre-production | Anonymized |
| Production | Live | Real |

### 10.3 Monitoring & Alerting

| Metrika | Threshold | Alert |
|---------|-----------|-------|
| Error rate | > 1% | Critical |
| P95 latency | > 500ms | Warning |
| P99 latency | > 1000ms | Critical |
| CPU usage | > 80% | Warning |
| Memory usage | > 85% | Warning |
| DB connections | > 90% pool | Critical |
| Disk usage | > 80% | Warning |

---

## ČÁST 11: MIGRACE Z V1 NA V2

### 11.1 Migrační Strategie

```
┌─────────────────────────────────────────────────────────────┐
│                    STRANGLER FIG PATTERN                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1: Parallel Run                                       │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  V1 (Supabase)  ←─┬─→  V2 Services                      ││
│  │                   │    (new features)                   ││
│  │                   │                                     ││
│  │              API Gateway                                ││
│  │            (routes traffic)                             ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Phase 2: Gradual Migration                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  V1 (shrinking)  ←─┬─→  V2 Services                     ││
│  │  - Auth           │    - Activity ✓                       ││
│  │  - Legacy         │    - Research ✓                     ││
│  │                   │    - Commerce ✓                     ││
│  │              API Gateway                                ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Phase 3: Complete Migration                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │               V2 Services (all)                         ││
│  │  - Identity ✓    - Activity ✓      - Research ✓          ││
│  │  - Commerce ✓    - Partner ✓     - Production ✓        ││
│  │  - Token ✓       - Audit ✓       - Notification ✓      ││
│  │                                                         ││
│  │              API Gateway                                ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 Data Migration Plan

| Fáze | Data | Strategie |
|------|------|-----------|
| 1 | Users & Profiles | Dual-write, sync |
| 2 | Activity Data (sensitive data) | ETL s šifrováním |
| 3 | Research Data | Batch migration |
| 4 | Commerce Data | Real-time sync |
| 5 | Audit Logs | Archiv + nový systém |

### 11.3 Rollback Strategy

```
1. Feature flags pro každou migrovanou funkcionalitu
2. Database snapshots před každou fází
3. Traffic splitting (canary releases)
4. Automated rollback triggers na error rate
```

---

## ČÁST 12: IMPLEMENTAČNÍ PLÁN

### 12.1 Fáze Implementace

```
┌─────────────────────────────────────────────────────────────┐
│ FÁZE 1: FOUNDATION (Core Infrastructure)                     │
│ ─────────────────────────────────────────                   │
│ • API Gateway setup                                          │
│ • Identity Service (auth, authz)                            │
│ • Audit Service (event logging)                             │
│ • Database schemas (per domain)                             │
│ • CI/CD pipeline                                            │
│ • Monitoring & logging infrastructure                       │
├─────────────────────────────────────────────────────────────┤
│ FÁZE 2: CORE SERVICES                                        │
│ ─────────────────────────────────────────                   │
│ • Activity Service                                            │
│ • Research Service                                          │
│ • Partner Service                                           │
│ • Notification Service                                      │
│ • Frontend: Member Portal                                   │
│ • Frontend: Partner Portal                                  │
├─────────────────────────────────────────────────────────────┤
│ FÁZE 3: COMMERCE & PRODUCTION                                │
│ ─────────────────────────────────────────                   │
│ • Commerce Service                                          │
│ • Production Service                                        │
│ • Token Service                                             │
│ • Payment integrations                                      │
│ • Shipping integrations                                     │
│ • Frontend: Shop                                            │
├─────────────────────────────────────────────────────────────┤
│ FÁZE 4: ADMIN & CONTENT                                      │
│ ─────────────────────────────────────────                   │
│ • Content Service (CMS)                                     │
│ • Admin Dashboard                                           │
│ • Reporting & Analytics                                     │
│ • Full V1 feature parity                                    │
├─────────────────────────────────────────────────────────────┤
│ FÁZE 5: OPTIMIZATION & MIGRATION                             │
│ ─────────────────────────────────────────                   │
│ • Performance optimization                                  │
│ • Data migration from V1                                    │
│ • User migration                                            │
│ • V1 deprecation                                            │
└─────────────────────────────────────────────────────────────┘
```

### 12.2 Definition of Done

Pro každou feature:

- [ ] Unit testy (80%+ coverage)
- [ ] Integration testy
- [ ] API dokumentace (OpenAPI)
- [ ] Audit logging implementován
- [ ] Security review
- [ ] Performance test (P95 < 200ms)
- [ ] Error handling
- [ ] i18n (CS/EN)
- [ ] Accessibility (WCAG 2.1 AA)
- [ ] Code review approved
- [ ] Deployed to staging
- [ ] E2E testy prošly

---

## ČÁST 13: KLÍČOVÉ ROZDÍLY V1 vs V2

| Aspekt | V1 | V2 |
|--------|----|----|
| **Architektura** | Monolith | Microservices |
| **API** | Přímý Supabase | API Gateway + Services |
| **Databáze** | 1 DB, 87 tabulek | Per-domain DBs |
| **Audit** | V RPC funkcích | Centrální Audit Service |
| **Auth** | Supabase Auth | Dedicated Identity Service |
| **Events** | Synchronní | Event-driven (Message Queue) |
| **data protection** | RLS + secure mode | Dedicated Activity Service + Encryption |
| **Consent** | V hlavní DB | Dedicated service |
| **Typy** | 303KB generated | Per-domain packages |
| **Škálování** | Vertikální | Horizontální |
| **Deployment** | Edge Functions | Kubernetes |
| **Observability** | Basic | Full stack (metrics, logs, traces) |

---

## ČÁST 14: RIZIKA A MITIGACE

| Riziko | Pravděpodobnost | Dopad | Mitigace |
|--------|-----------------|-------|----------|
| Komplexita microservices | Vysoká | Střední | Začít s modulárním monolitem |
| Data migration failures | Střední | Vysoký | Dual-write, rollback plány |
| Performance degradation | Střední | Střední | Performance testy, caching |
| Team learning curve | Vysoká | Střední | Školení, dokumentace |
| Security vulnerabilities | Nízká | Vysoký | Security reviews, pentesty |
| Downtime during migration | Střední | Vysoký | Blue-green deployment |

---

## ČÁST 15: DOPORUČENÍ

### 15.1 Pro Malý Tým (1-3 vývojáři)

```
DOPORUČENÁ CESTA:
1. Zůstat u Supabase jako backend
2. Implementovat "Modular Monolith" pattern
3. Jasně definovat domain boundaries v kódu
4. Centralizovat audit do jednoho místa
5. Postupně extrahovat services když potřeba
```

### 15.2 Pro Střední Tým (4-8 vývojářů)

```
DOPORUČENÁ CESTA:
1. Hybridní přístup: Supabase + vlastní services
2. Extrahovat Identity a Audit jako první
3. Event-driven komunikace mezi moduly
4. Shared type definitions (monorepo)
5. Postupná migrace po doménách
```

### 15.3 Pro Velký Tým (9+ vývojářů)

```
DOPORUČENÁ CESTA:
1. Full microservices architektura
2. Kubernetes pro orchestraci
3. Dedikované týmy per doména
4. API-first development
5. Continuous deployment
```

---

## PŘÍLOHY

### A. Slovník Pojmů

| Pojem | Definice |
|-------|----------|
| sensitive data | sensitive data - chráněné privátní informace |
| RLS | Row Level Security - zabezpečení na úrovni řádků |
| RBAC | Role-Based Access Control |
| ABAC | Attribute-Based Access Control |
| DDD | Domain-Driven Design |
| CQRS | Command Query Responsibility Segregation |
| Event Sourcing | Ukládání stavu jako sekvence událostí |

### B. Reference

- Domain-Driven Design (Eric Evans)
- Building Microservices (Sam Newman)
- compliance Security Rule
- OWASP Top 10
- 12-Factor App

---

**Dokument vytvořen:** 29. prosince 2025
**Autor:** Claude AI (na základě analýzy V1)
**Status:** Draft pro review

---

*Tento dokument je živý a měl by být aktualizován na základě feedbacku a změn požadavků.*
