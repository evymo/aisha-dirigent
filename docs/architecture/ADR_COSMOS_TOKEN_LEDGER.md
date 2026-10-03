# ADR: Cosmos App-Chain jako Token Ledger

**Status:** Accepted  
**Date:** 2026-04-18  
**Deciders:** Zdeněk Beňo (Architect), AISHA Dirigent  
**Tags:** cosmos, tokenomics, blockchain, GDPR, audit

---

## Context

AISHA platforma používá 4 typy tokenů:

| Token | Účel | Citlivost |
|-------|------|-----------|
| **aisha (ASH)** | Utility token — odměny, reward shop, vouchery | Nízká |
| **governance** | Komunitní hlasování, rozhodování | Nízká |
| **impact** | Příspěvky pacientů (health data) | **Vysoká — GDPR Art. 17** |
| **data** | Laboratorní data contributions | **Vysoká — GDPR Art. 17** |

Potřebujeme immutable audit trail pro `aisha` a `governance` tokeny, ale zároveň musíme respektovat GDPR právo na výmaz pro `impact` a `data` tokeny.

## Decision

### Architektura: Supabase = SoT, Cosmos = Audit Ledger

```
Supabase (Source of Truth)
  │
  ├── token_transactions INSERT trigger
  │   └── pg_net → cosmos-ledger-sync Edge Function
  │         └── MsgMintTokens / MsgBurnTokens → Cosmos LCD
  │
  ├── governance-vote Edge Function
  │   └── MsgVote → Cosmos LCD (backend-signed)
  │
  └── Mobile App (user-signed)
      └── MsgVote → Cosmos LCD (CosmJS + biometric)
```

### Token Segregation Matrix (GDPR-Binding)

| Token | On-Chain (Cosmos) | Off-Chain (Supabase) | Důvod |
|-------|-------------------|----------------------|-------|
| **governance** | ✓ Balance + audit | ✓ Business logic | Auditovatelné komunitní hlasování |
| **aisha (ASH)** | ✓ Balance + audit | ✓ Business logic | Utility token, budoucí veřejný asset |
| **impact** | ✗ **NIKDY** | ✓ Plný lifecycle | Health data — GDPR Art. 17 (právo na výmaz) |
| **data** | ✗ **NIKDY** | ✓ Plný lifecycle | Lab results — GDPR Art. 17 |

### Sync Direction

**Jednosměrná: Supabase → Cosmos** (nikdy opačně)

- Cosmos NEMÁ přístup k Supabase datům
- Supabase je authoritative pro business logic
- Cosmos = append-only audit log + governance engine
- Failure mode: best-effort sync, neblokuje platformu
- Selhání se loguje do `audit_journal` a `blockchain_audit_records`

### Dual Signing Architecture

**Backend Path (Automatizovaný):**
- Edge function `cosmos-ledger-sync` podepisuje `COSMOS_SIGNER_MNEMONIC`
- Trigger: DB trigger na `token_transactions` INSERT (WHERE `token_type IN ('governance', 'aisha')`)
- Handles: audit records, platform rewards, token operations
- Idempotence: kontrola existujícího `transaction_id` v `blockchain_audit_records`

**User Path (Komunitní):**
- Mobilní app: BIP39 mnemonic → Expo SecureStore (hardware-backed)
- Biometrický gate PŘED každým podpisem
- CosmJS `DirectSecp256k1Wallet` lokální podepisování
- MsgVote broadcast na Cosmos LCD
- Privátní klíč **NIKDY neopouští zařízení**

### Chain Configuration

```
Chain ID:       aisha-1
Bech32 prefix:  aisha
Gas denom:      uash
HD Path:        m/44'/118'/0'/0/0 (Cosmos standard)
Validator:      Single validator (private mainnet)
Gas:            Zero-gas (private network)
```

## Consequences

### Positive
- Immutable audit trail pro governance a utility tokeny
- GDPR compliant — sensitive tokeny zůstávají off-chain
- Budoucí cesta k IBC/DEX (po MiCA clearance)
- Komunitní hlasování s kryptografickým závazkem (mobile signing)

### Negative
- Komplexita infrastruktury (Cosmos node maintenance)
- Best-effort sync = eventual consistency (ne real-time)
- Dual signing zvyšuje onboarding complexity pro mobile users

### Risks
- **MiCA compliance** vyžaduje právní review před veřejnou fází (BLOCKED)
- Cosmos node single point of failure (mitigace: state snapshots + monitoring)
- Mnemonic management pro backend signer (mitigace: env var rotation policy)

## Implementation Status

| Phase | Popis | Stav |
|-------|-------|------|
| A | Token rebrand PLATFORM/RTNT → AISHA | ✅ Complete |
| 0 | ADR (tento dokument) | ✅ Complete |
| B | Mobile Wallet + Signing | ✅ ~60% (hooks + screens ready) |
| 1 | Cosmos scaffolding (Dockerfile, genesis) | 🔲 Blocked on Ignite CLI |
| 2 | Cosmos module logic (x/tokenledger, x/auditlog) | 🔲 |
| 3 | Backend bridge (edge functions) | ✅ Complete |
| 4 | Frontend integration (admin + hooks) | 🔄 In progress |
| 5 | Private mainnet deployment | 🔲 |
| 6 | Public phase (IBC/DEX) | ⛔ Blocked on MiCA |

## References

- [Cosmos Plan](../plan-cosmosAppChainAishaTokenRebrandingMobileWallet.md)
- [Governance Index](../governance/GOVERNANCE_INDEX.md)
- Edge functions: `governance-vote`, `cosmos-ledger-sync`, `cosmos-gov-read`, `claim-cosmos-reward`
- DB: `blockchain_audit_records`, `token_transactions`, `audit_journal`
