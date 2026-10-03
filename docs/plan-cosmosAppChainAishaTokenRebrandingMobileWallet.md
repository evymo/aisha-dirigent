# Plan: Cosmos App-Chain + AISHA Token Rebranding + Mobile Wallet

## TL;DR

Tři provázané iniciativy:
1. **Token Rebranding:** `PLATFORM`/`RTNT` → `AISHA` (symbol `ASH`) — utility token platformy
2. **Mobile Wallet & Signing Tool:** Mobilní aplikace jako aktivní nástroj komunity — podepisování governance hlasování a rozhodnutí (utility + gov tokeny), správa Cosmos identity. Soukromý klíč nikdy neopouští zařízení (Expo SecureStore + biometrika).
3. **Cosmos Integration:** App-chain jako vyšší vrstva tokenomiky (analogie Keycloak → GoTrue) — Supabase zůstává SoT, Cosmos = immutable audit ledger pro `governance` + `AISHA` tokeny s budoucí veřejnou fází (IBC/DEX)

---

## NOVÁ Fáze A: Token Rebranding (PLATFORM/RTNT → AISHA)

**Cíl:** Sjednotit `PLATFORM` + `rtnt` do jednoho utility tokenu `AISHA` (symbol `ASH`).

### Dopad rename

**Proč sjednotit:** Dnes existuje 5 token typů, kde `PLATFORM` a `rtnt` jsou de facto duplikáty (oba = utility/reward token). Sjednocení na `AISHA` = 4 token typy celkem: `AISHA` (utility), `governance` (hlasování), `impact` (příspěvky), `data` (data contributions).

### Krok A1: DB migrace — token_config + token_type rename

Nová migrace: `supabase/migrations/YYYYMMDDHHMMSS_rename_platform_rtnt_to_aisha.sql`
- UPDATE `token_config SET token_type = 'aisha', name = 'AISHA Token', symbol = 'ASH'` WHERE `token_type IN ('PLATFORM', 'rtnt')`
- UPDATE `token_transactions SET token_type = 'aisha'` WHERE `token_type IN ('PLATFORM', 'rtnt')`
- UPDATE `token_locks SET token_type = 'aisha'` WHERE `token_type IN ('PLATFORM', 'rtnt')`
- UPDATE `token_burns SET token_type = 'aisha'` WHERE `token_type IN ('PLATFORM', 'rtnt')`
- UPDATE `token_allocations SET token_type = 'aisha'` WHERE `token_type IN ('PLATFORM', 'rtnt')`
- UPDATE `token_reward_rules SET token_type = 'aisha'` WHERE `token_type IN ('PLATFORM', 'rtnt')`
- UPDATE `production_token_events SET token_type = 'aisha'` WHERE `token_type IN ('PLATFORM', 'rtnt')`
- Merge `memberships.tokens_platform` do nového sloupce `tokens_aisha` (ADD COLUMN + migrate + DROP old)

**Relevantní SoT soubory k aktualizaci:**
- `supabase/sql/tables/token_config.sql`, `token_locks.sql`, `token_burns.sql`, `token_allocations.sql`, `token_reward_rules.sql`
- `supabase/sql/functions/award_tokens.sql` — validace `IF p_token_type NOT IN ('governance', 'impact', 'data', 'aisha')`
- `supabase/sql/functions/create_token_lock_admin.sql` — default `'aisha'` místo `'PLATFORM'`
- `supabase/sql/functions/mint_production_tokens_on_release.sql` — fallback `'aisha'`
- `supabase/sql/functions/upsert_leaderboard_reward_config_admin.sql` — default `'aisha'`
- `supabase/seed/core/06_subscriptions.sql` — merge 2 seed rows do 1

### Krok A2: TypeScript typy

- `src/hooks/useTokens.ts` L13: `TokenType = "governance" | "impact" | "data" | "aisha"`
- `src/services/voucherService.ts` L4: stejná změna
- `src/hooks/useTokenomics.ts` — všechny `"PLATFORM"` → `"aisha"`
- `src/hooks/useLeaderboardRewards.ts` — `"PLATFORM"` → `"aisha"`
- `mobile-app/src/types/schemas.ts` — `token_type: z.enum(["aisha", "governance", "impact", "data"])`

### Krok A3: UI konstanty + komponenty

- `src/pages/admin/tokenomics-constants.ts` — `rtnt:` → `aisha:`, ikona Coins, barva `text-green-500`
- `src/components/admin/tokenomics/constants.ts` — totéž + ACTIVITY_TEMPLATES
- `src/pages/admin/BurnsPanel.tsx` — default `"aisha"`
- `src/pages/admin/AllocationsPanel.tsx` — default `"aisha"`
- `src/pages/admin/LeaderboardRewardsPanel.tsx` — `"PLATFORM"` → `"aisha"`
- `src/pages/member/MemberTokens.tsx` — `PLATFORM` key → `aisha` key
- `src/pages/member/MemberRewardShop.tsx` — `"PLATFORM"` → `"aisha"`
- `src/components/gamification/GamificationWidget.tsx` — aktualizovat token items

### Krok A4: i18n (6 jazyků)

Segmenty k aktualizaci:
- `src/i18n/segments/{en,cs}/member.json` — `rewardShop.tokenUnit: "ASH"`, `rewardShop.subtitle`, `rewardShop.yourBalance`
- `src/i18n/segments/{en,cs}/core.json` — `tokens.types.aisha: "AISHA Token"`, `tokens.descriptions.aisha`
- Všechny jazyky přes: `npm run i18n:segments:translate-missing`
- ⚠️ `research.json` CS — 2× "RTN tokeny" → "AISHA tokeny"
- ⚠️ RU `member.json` — "RTN Токены" → "AISHA Токены"

**NEPŘEPISOVAT** legal texty (`legal.json`) — "RTN Therapeutics s.r.o." je obchodní jméno, ne token. Vyžaduje právní review.

### Krok A5: Testy

- `src/tests/hooks/useTokenLocks.test.tsx` — `'rtnt'` → `'aisha'`
- `src/tests/hooks/useCreateTokenLock.test.ts` — `'rtnt'` → `'aisha'`
- `src/tests/hooks/useUpdateTokenLock.test.ts` — `'rtnt'` → `'aisha'`
- `src/tests/hooks/useRewardShop.test.ts` — `"PLATFORM"` → `"aisha"`
- `src/tests/hooks/useLeaderboardRewards.test.ts` — `"PLATFORM"` → `"aisha"`

### Krok A6: Whitepaper

- `public/directives/RTNT-Whitepaper-v2.pdf` → přejmenovat na `AISHA-Token-Whitepaper-v3.pdf`
- 3× reference: `src/pages/Whitepaper.tsx`, `src/components/home/WhitepaperSection.tsx`, `src/components/studies/WhitepaperSection.tsx`

---

## NOVÁ Fáze B: Mobile Wallet & Signing Tool

**Cíl:** Mobilní aplikace jako aktivní nástroj komunity — uživatel podepisuje svá rozhodnutí (governance hlasování, potvrzení token operací) svým soukromým klíčem, který **nikdy neopustí zařízení**.

**Architektura podpisu:**
- **On-device key:** BIP39 mnemonic → secp256k1 keypair → Cosmos address (deterministická derivace)
- **Expo SecureStore:** Mnemonic uložen v hardware-backed Keychain (iOS) / Keystore (Android)
- **Biometrická autorizace:** Face ID / fingerprint potvrzení před každým podpisem
- **Přímý broadcast:** App volá Cosmos LCD API (`http://cosmos-node:1317`) přímo — bez edge function prostředníka
- Backend signing (`COSMOS_SIGNER_MNEMONIC`) = pouze pro automatizované audit operace a platform rewards

### Současný stav mobilní app

- 3 taby: Home (dashboard), Stories (projekty), Profile (monitor)
- Token balances: pasivní strip na Profile (4 čísla z `useMembership`)
- `tokenTransactionSchema` existuje ale **nikde se nepoužívá** — hook chybí
- Žádná wallet screen, žádný signing flow, žádná transakční historie

### Krok B1: Nový hook `useTokenTransactions`

Soubor: `mobile-app/src/hooks/useTokenTransactions.ts`
- Volá existující RPC `get_my_token_transactions` (limit parametr)
- Parsuje přes existující `tokenTransactionSchema`
- Query key: `["my-token-transactions", { limit }]`

### Krok B2: Nový hook `useCosmosWallet`

Soubor: `mobile-app/src/hooks/useCosmosWallet.ts`

Zodpovídá za celý klíčový lifecycle:
1. **Generování klíče:** BIP39 `generateMnemonic()` → `SecureStore.setItemAsync("cosmos_mnemonic", mnemonic)`
2. **Načtení adresy:** `SecureStore.getItemAsync("cosmos_mnemonic")` → `@cosmjs/crypto` derivace → Cosmos address
3. **Signing:** `DirectSecp256k1HdWallet.fromMnemonic(mnemonic)` → `SigningStargateClient`
4. **Broadcast:** `client.broadcastTx(signedTx)` → Cosmos LCD endpoint
5. **Supabase sync:** po úspěšném broadcastu → `supabase.rpc("notify_cosmos_tx", { p_tx_hash })` pro balance cache update

Exponuje:
- `cosmosAddress: string | null`
- `governancePower: number` (z governance token balance)
- `signAndBroadcast(msgs: EncodeObject[]): Promise<DeliverTxResponse>`
- `isKeyGenerated: boolean`
- `generateNewWallet(): Promise<void>`

Dependencies: `@cosmjs/stargate`, `@cosmjs/proto-signing`, `@cosmjs/crypto`, `expo-secure-store`

### Krok B3: Wallet Screen

Soubor: `mobile-app/src/app/(tabs)/wallet.tsx` — nový 4. tab

Layout:
1. **Hero balance card** — celkový balance AISHA tokenů + governance/impact/data breakdown
2. **Cosmos Identity** — Cosmos adresa (zkrácená) + "Governance Power" badge (počet gov tokenů)
3. **Quick actions** — "Vote" (odkaz na governance), "Claim Rewards", "Leaderboard"
4. **Transaction history** — scrollable list s filtrováním per token type
5. **Chain verification badge** (Fáze 3+) — "On-chain verified" pro governance + AISHA transakce

Navigace: přidat 4. tab `Wallet` (ikona `Wallet` z lucide) do tab layoutu.

### Krok B4: Governance Voting Screen

Soubor: `mobile-app/src/app/governance.tsx`

Flow:
1. Načíst aktivní proposals z Cosmos REST API (`GET /cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD`)
2. Zobrazit proposal: titulek, popis, deadline, průběžné výsledky (% YES/NO/ABSTAIN/VETO)
3. Uživatel vybere hlas: YES / NO / ABSTAIN / NO_WITH_VETO
4. **Biometrická potvrzení** (`expo-local-authentication`) → konstruovat `MsgVote`
5. `useCosmosWallet().signAndBroadcast([msgVote])` → local signing → broadcast
6. Toast úspěch + TxHash + sync do Supabase `audit_journal`

Dependencies: `@cosmjs/stargate`, `@cosmjs/proto-signing`, `expo-local-authentication`

### Krok B5: Transaction Signing Flow

Soubor: `mobile-app/src/app/sign-tx.tsx`

Generická potvrzovací obrazovka pro libovolnou Cosmos transakci (token transfer, lock, atd.):
1. Zobrazit přehled transakce (typ, částka, příjemce/účel)
2. Biometrické potvrzení
3. `useCosmosWallet().signAndBroadcast(msgs)` → local signing → broadcast
4. Success/error feedback + invalidate React Query cache

### Krok B6: Reward Collection Flow

Soubor: `mobile-app/src/app/claim-reward.tsx`
- Volá existující RPC `process_token_reward`
- Animovaný reward notification (reuse patternu z web `RewardNotification.tsx`)
- Po úspěchu: invalidate wallet queries

### Krok B7: i18n pro wallet

Nové klíče v `mobile-app/src/i18n/{cs,en}.json`:
- `wallet.title`, `wallet.totalBalance`, `wallet.transactionHistory`
- `wallet.cosmosAddress`, `wallet.governancePower`, `wallet.chainVerified`, `wallet.pending`
- `wallet.vote.title`, `wallet.vote.yes`, `wallet.vote.no`, `wallet.vote.abstain`, `wallet.vote.veto`
- `wallet.sign.title`, `wallet.sign.confirm`, `wallet.sign.biometricPrompt`
- `wallet.claimRewards`, `wallet.generateWallet`, `wallet.walletReady`

---

## Fáze 0: Architecture Decision Record (prerekvizita)

**Cíl:** Formalizovat rozhodnutí co jde on-chain vs. off-chain, a proč.

1. Vytvořit `docs/architecture/ADR_COSMOS_TOKEN_LEDGER.md` s:
   - Token segregation: `governance` + `RTNT` = on-chain kandidáti; `data` + `impact` = NAVŽDY off-chain (GDPR čl. 17 — right to erasure neslučitelné s immutable ledger, protože jsou přímo navázané na health_check_ins, lab_results, informed_consents)
   - Source of Truth matrix: Supabase = SoT pro business logiku (balances, rewards, locks), Cosmos = SoT pro audit integrity (immutable log)
   - Sync direction: Supabase → Cosmos jednosměrně (jako Keycloak pattern)
   - Failure mode: best-effort — Cosmos write failure loguje do `audit_journal`, neblokuje Supabase transakci

**Relevantní soubory:**
- `supabase/sql/tables/blockchain_audit_records.sql` — existující chain-like tabulka (id, record_hash, previous_hash, data) — bude sloužit jako "staging queue" pro Cosmos sync
- `supabase/sql/functions/edge_blockchain_audit.sql` — existující RPC s `count_requests` + `insert_record` akcemi
- `supabase/functions/record-blockchain-audit/index.ts` — existující edge function s guards (CORS, rate limit, allowlist, payload size)
- Keycloak ADR pattern: `docs/` (referenční architektura z KC integrace)

**Rozhodnutí k formalizaci:**
- `blockchain_audit_records.data` dnes obsahuje `created_by` (user UUID), `event_type`, `payload`, `reference_id`, `reference_table`, `status: pending` — žádné PII, jen ID reference → bezpečné pro on-chain zrcadlení
- `audit_journal` má `blockchain_hash`, `blockchain_tx_hash`, `blockchain_recorded_at`, `blockchain_status`, `requires_blockchain_record` sloupce — už designováno pro chain integraci!
- **Dual signing architektura:** Backend edge function (`cosmos-ledger-sync`) s `COSMOS_SIGNER_MNEMONIC` podepisuje automatizované operace (audit records, platform rewards); Uživatel podepisuje governance hlasování a explicitní akce z mobilní appky vlastním klíčem uloženým v SecureStore — klíč nikdy neopustí zařízení.

---

## Fáze 1: Cosmos Scaffolding (Go app-chain)

**Cíl:** Běžící lokální Cosmos app-chain s custom moduly.

1. Ignite CLI scaffold:
   - `ignite scaffold chain aisha-ledger --no-module`
   - Custom modul `x/tokenledger` pro token operace (mint, burn, lock, transfer, vesting)
   - Custom modul `x/auditlog` pro immutable audit záznamy

2. Genesis konfigurace:
   - Validator set: 1 uzel (privátní mainnet), rozšiřitelný na 3
   - Zero-gas: `min-gas-prices: "0stake"` + dostatečný genesis stake
   - Token denominations: `uevgov` (governance micro-unit), `uash` (AISHA micro-unit)

3. Docker integrace:
   - `Dockerfile.cosmos` pro Cosmos node
   - Přidat do `docker-compose.local.yml` jako service `cosmos-node` (analogie k `keycloak` v `docker-compose.coolify-integration.yml`)
   - Healthcheck: `curl -fsS http://localhost:26657/status`

4. Lokální endpointy:
   - Cosmos RPC: `http://localhost:26657`
   - Cosmos gRPC: `localhost:9090`
   - Cosmos REST (LCD): `http://localhost:1317`

**Relevantní reference:**
- `docker-compose.coolify-integration.yml` — Keycloak service pattern (healthcheck, networks, labels)
- `Dockerfile.keycloak` — referenční Dockerfile pro external service

---

## Fáze 2: Cosmos Module Logic (Go)

**Cíl:** Replikovat klíčovou business logiku z Supabase SQL funcí do Go modulů.

### x/tokenledger modul

Msg typy (mapování na existující RPC):
| Cosmos Msg | Supabase RPC | Popis |
|---|---|---|
| `MsgMintTokens` | `award_tokens` | Mint governance/AISHA (admin-only) |
| `MsgBurnTokens` | `create_token_burn_admin` | Burn tokenů |
| `MsgLockTokens` | `create_token_lock_admin` | Lock s vesting schedule |
| `MsgUnlockTokens` | `update_token_lock_admin` | Unlock po vesting období |
| `MsgTransferTokens` | `create_token_transaction` | Transfer mezi účty |

Validační pravidla (z `award_tokens` SQL funkce):
- Token type whitelist: `governance`, `aisha` only (data/impact ZAKÁZÁNY)
- Amount > 0 validace
- Balance check při burn/transfer (nelze spalit víc než je balance)
- Vesting schedule enforcement při unlock

Query typy:
- `QueryBalance(address)` → balance per token type
- `QueryTransactionHistory(address, pagination)` → token transactions
- `QueryTokenSupply(denom)` → total/circulating/locked/burned

### x/auditlog modul

Msg typy:
| Cosmos Msg | Zdroj | Popis |
|---|---|---|
| `MsgRecordAudit` | `blockchain_audit_records` sync | Immutable audit záznam |

Data model (mapuje `blockchain_audit_records.data`):
- `event_type: string`
- `reference_table: string`
- `reference_id: string`  (UUID, ne PII)
- `payload_hash: string` (SHA-256 payloadu, ne payload samotný!)
- `created_by: string` (UUID, ne email)
- `supabase_record_id: string` (vazba zpět na Supabase)

**Kritické:** Na chain JDE POUZE hash payloadu + reference ID. Samotný payload zůstává v Supabase `blockchain_audit_records.data`. Cosmos uchovává jen kryptografický důkaz integrity.

### x/gov modul (standardní Cosmos SDK)

Governance protokol pro hlasování komunity. Standardní `x/gov` modul — není potřeba custom implementace.

Klíčové zprávy:
- `MsgSubmitProposal` — podání návrhu (Dirigent / admin)
- `MsgVote` — hlas uživatele (YES / NO / ABSTAIN / NO_WITH_VETO)
- `MsgDeposit` — AISHA depozit k aktivaci návrhu

Query:
- `QueryProposals(status)` → seznam aktivních/uzavřených proposals
- `QueryTally(proposalId)` → průběžné výsledky hlasování
- `QueryVote(proposalId, voter)` → hlas konkrétního hlasujícího

Parametry genesis (privátní mainnet):
- `voting_period: 7 days`
- `quorum: 33.4%` governance token holder threshold
- `threshold: 50%` (prosté kvórum)
- `veto_threshold: 33.4%`

Hlasovací síla = balance `governance` tokenů (přímé nebo delegované).
Typy návrhů: textové návrhy, změny parametrů platformy, spending proposals.

---

## Fáze 3: Backend Bridge (TypeScript → CosmJS)

**Cíl:** Edge function jako bridge mezi Supabase a Cosmos — analogie `keycloak-role-sync`.

### 3a. Cosmos Sync Edge Function

Nová edge function `supabase/functions/cosmos-ledger-sync/index.ts`:
- Pattern: kopíruje `keycloak-role-sync` — best-effort, failure loguje do `audit_journal`
- Autentizace: Backend drží Cosmos master key v env vars (analogie `KC_ADMIN_CLIENT_SECRET`)
- CosmJS pro podepisování a broadcasting transakcí
- Input: JSON payload z DB triggeru (record ID + action type)
- Output: TxHash zpět do `blockchain_audit_records.blockchain_tx_hash` / `audit_journal.blockchain_tx_hash`

### 3b. DB Trigger pro sync

Nová migrace s triggerem (analogie `trg_sync_keycloak_roles`):

```
trigger: trg_cosmos_ledger_sync
on: token_transactions INSERT (WHERE token_type IN ('governance', 'aisha'))
action: INSERT INTO blockchain_audit_records (staging) + volání edge function cosmos-ledger-sync
```

Stejný best-effort pattern:
1. Trigger zapíše do `blockchain_audit_records` se `status: pending`
2. Async volání edge function přes `pg_net`
3. Edge function → CosmJS → Cosmos node
4. Success: update `blockchain_audit_records.status = 'confirmed'`, zapíše `blockchain_tx_hash`
5. Failure: update `status = 'failed'`, log do `audit_journal`

### 3c. Retry mechanismus

Cron job (n8n workflow nebo pg_cron):
- Každých 5 min: SELECT z `blockchain_audit_records WHERE status = 'pending' AND created_at < now() - interval '1 minute'`
- Retry volání cosmos-ledger-sync pro pending záznamy
- Max 5 retries, pak `status = 'permanently_failed'` + alert

### 3d. Key Management

- Cosmos privátní klíč: `COSMOS_SIGNER_MNEMONIC` env var v edge function
- Produkce: KMS (Coolify secrets / budoucí HashiCorp Vault)
- Nikdy v kódu, nikdy v logách
- Rotace: pravidelné klíčové rotace s multi-sig threshold (2-of-3 pro mainnet)

### 3e. User Signing Architecture (Dual Path)

Dva paralelní podpisové toky bez vzájemného zasahování:

**Backend path (automatizované operace):**
- Edge function `cosmos-ledger-sync` drží `COSMOS_SIGNER_MNEMONIC` v env vars
- Podepisuje: audit records, platform reward mints, token locks/unlocks
- Trigger: DB trigger → pg_net → edge function → CosmJS → Cosmos broadcast
- Plně automatizováno, uživatel neinteraguje

**User path (governance + explicitní akce):**
- Mobilní app generuje unsigned transakci (MsgVote, MsgTransfer...)
- Uživatel potvrdí biometrikou (Face ID / fingerprint)
- `@cosmjs/stargate SigningStargateClient` podepíše s klíčem ze SecureStore
- Přímý broadcast na Cosmos LCD (`http://cosmos-node:1317`) — **bez edge function prostředníka**
- Po broadcastu app volá `supabase.rpc("notify_cosmos_tx", { p_tx_hash })` pro sync balance cache

**Klíčový princip:** Soukromý klíč uživatele je VŽDY lokální — nikdy se neposílá na server ani neopustí zařízení.

**Relevantní soubory k použití jako reference:**
- `supabase/functions/keycloak-role-sync/index.ts` — vzorový pattern (auth, error handling, audit logging)
- `supabase/functions/record-blockchain-audit/index.ts` — existující guards + rate limiting (reuse!)
- `supabase/functions/_shared/recordBlockchainAuditGuards.ts` — reusable guards
- `supabase/functions/_shared/allowlists.ts` — `RECORD_BLOCKCHAIN_AUDIT_ALLOWED_EVENT_TYPES`
- `supabase/migrations/20260409121000_keycloak_role_sync.sql` — vzorový trigger + pg_net pattern

---

## Fáze 4: Frontend Integration

**Cíl:** Rozšířit existující hooks o Cosmos data (chain status, tx hashes).

### 4a. Nový hook `useCosmosLedgerStatus`

- Nový soubor: `src/hooks/useCosmosLedgerStatus.ts`
- RPC: nová funkce `get_cosmos_sync_status` (čte `blockchain_audit_records` statistiky)
- Zobrazuje: pending/confirmed/failed counts, poslední sync timestamp
- Použití: admin dashboard widget v `AdminTokenomics.tsx`

### 4b. Rozšíření existujících hooků

- `useTokenomics.ts`: `useTokenomicsStats()` — přidat `blockchain_confirmed_count` do overview
- `useTokens.ts`: `TokenTransaction` interface — přidat `blockchain_tx_hash?: string` pro zobrazení chain verifikace
- Admin panel: link na Cosmos explorer pro confirmed transakce
- Mobile wallet: chain verification badge na governance + AISHA transakcích

### 4c. Nové i18n klíče

- `admin.tokenomics.cosmos.syncStatus`, `admin.tokenomics.cosmos.pending`, `admin.tokenomics.cosmos.confirmed`
- Segmenty: `admin` (EN + CS)

### 4d. Governance Voting UI (Web)

Web protějšek mobilního governance hlasování:

**Member view:** `src/pages/member/MemberGovernance.tsx`
- Activní proposals načtené z Cosmos REST API
- Zobrazení výsledků hlasování (Fáze 4: read-only, signing z webu Fáze 6)
- Odkaz "Vote in App" → deep link do mobilní appky pro podpis

**Admin view:** `src/pages/admin/GovernancePanel.tsx`
- Přehled všech proposals (aktivní, uzavřené, zamítnuté)
- Výsledky hlasování: % YES / NO / ABSTAIN / VETO, quorum progress
- Statistiky participace: unikátní voličů, total governance power hlasujících

Nový hook: `src/hooks/useGovernanceProposals.ts`
- Volá Cosmos REST API (`/cosmos/gov/v1/proposals`)
- Výsledky cachuje přes React Query (`staleTime: 60 * 1000`)

Nové i18n klíče:
- `admin.governance.*` (segment: `admin`)
- `member.governance.*` (segment: `member`)

**Relevantní soubory:**
- `src/hooks/useTokenomics.ts` — 20 existujících RPC hooků, barrel export v `src/hooks/index.ts`
- `src/pages/admin/AdminTokenomics.tsx` — admin dashboard s Tabs (overview, configs, rules, locks, burns, allocations, transactions)
- `src/lib/validation/rpcSchemas.ts` — `tokenomicsOverviewSchema` k rozšíření

---

## Fáze 5: Privátní Mainnet

**Cíl:** Produkční nasazení 1-3 Cosmos nodů.

1. Docker Compose pro Coolify:
   - Nový service v `docker-compose.coolify-integration.yml` (vedle Keycloak, Ragnarok)
   - Healthcheck na `/status` endpoint
   - Persistent volume pro chain state
   - `traefik.docker.network=coolify` label

2. Genesis migration:
   - Existující `governance` + `AISHA` balances z `memberships` → genesis accounts
   - Historické `token_transactions` (governance/AISHA only) → genesis audit log
   - Mapping: Supabase `user_id` → Cosmos address přes deterministická derivace

3. Monitoring:
   - Cosmos Prometheus metriky → existující monitoring stack
   - Alert na: block height stagnation, validator downtime, sync queue backlog

4. Backup:
   - State snapshots každých 24h
   - WAL archivace pro point-in-time recovery

---

## Fáze 6: Gradual Migration (budoucí)

**Cíl:** Postupný přesun authority z Supabase na Cosmos pro governance + AISHA.

### Fáze 6a: Read from Chain
- `useTokenomicsStats()` čte governance/AISHA balances z Cosmos (přes LCD API) místo Supabase
- Supabase balances se stávají "cache" (jako GoTrue session vs. KC identity)

### Fáze 6b: Write to Chain First
- Token operace (mint, burn, lock) jdou NEJDŘÍV na Cosmos, pak se zrcadlí zpět do Supabase
- Obrácení sync směru (jako kdybychom přešli na KC jako primární auth)

### Fáze 6c: IBC / Public (podmíněno MiCA compliance)
- Otevření IBC kanálů pro `AISHA` (ASH)
- Registrace na Osmosis DEX
- **BLOKOVÁNO:** MiCA compliance assessment, CASP registrace, whitepaper

---

## Token Segregation Matrix (závazná)

| Token | On-chain (Cosmos) | Off-chain (Supabase) | Důvod |
|---|---|---|---|
| `governance` | Audit + balance (Fáze 3+) | Business logika, rewards | Veřejně auditovatelné hlasování |
| `aisha` (ASH) | Audit + balance (Fáze 3+) | Business logika, rewards | Utility token, budoucí veřejné aktivum |
| `impact` | NIKDY | Plný lifecycle | Navázán na informed_consents + health data (GDPR) |
| `data` | NIKDY | Plný lifecycle | Navázán na health_check_ins + lab_results (GDPR) |

---

## Verifikace

1. **Fáze A (rebranding):** Migrace bez chyb, `token_type = 'aisha'` v DB, TS build OK — `npm run test:run -- src/tests/hooks/useTokenLocks.test.tsx`
2. **Fáze B (signing):** `useCosmosWallet` vygeneruje keypair, Cosmos adresa derivována správně, `MsgVote` podepsán lokálně (mock network), biometrická autorizace funguje (mock `expo-local-authentication`), broadcast flow ověřen — `npm run test:run -- mobile-app/src/hooks/useCosmosWallet.test.ts`
3. **Fáze 0:** ADR review, GDPR legal confirmation na token segregation
4. **Fáze 1:** `cosmos-node` container běží lokálně, `/status` vrací 200, genesis block vytvořen
5. **Fáze 2:** `ignite chain serve` — custom moduly kompilují, unit testy v Go prochází; `x/gov` modul aktivní, `QueryProposals` vrací data
6. **Fáze 3:** Backend path: `award_tokens(governance)` → trigger → edge function → Cosmos tx confirmed; User path: `MsgVote` broadcast přes LCD → `notify_cosmos_tx` RPC zavolána → `audit_journal` aktualizován
7. **Fáze 4:** Admin dashboard zobrazuje Cosmos sync status + Governance Panel proposals — `npm run test:run -- src/tests/hooks/useCosmosLedgerStatus.test.ts`
8. **Fáze 5:** Produkční node synchronizován, historické balances v genesis, monitoring alerts funkční
9. **Gate testy:** Nový gate test `cosmos-integration.gate.test.ts` — validuje že `data`/`impact` tokeny NIKDY nejsou v `blockchain_audit_records` s `status != 'excluded'`

---

## Rozhodnutí

- **Cosmos SDK + CometBFT (Ignite)** — ověřený stack, IBC-ready, Go (tým má zkušenosti)
- **Supabase zůstává SoT** pro business logiku v Fázi 1-5 — Cosmos je sekundární (jako KC)
- **Jednosměrná sync** Supabase → Cosmos (Fáze 3-5), obrácení až ve Fázi 6
- **Best-effort pattern** — chain failure neblokuje platformu (jako KC role sync)
- **`blockchain_audit_records` = staging queue** — existující tabulka přesně sedí na tento účel
- **Payload hash on-chain, ne payload** — Cosmos uchovává SHA-256, Supabase uchovává data
- **data + impact tokeny = NAVŽDY off-chain** — GDPR zákonný požadavek
- **Dual signing:** Backend podepisuje automatizované operace (audit, rewards); Uživatel podepisuje governance hlasování a explicitní akce ze svého zařízení — klíč nikdy neopustí device
- **Active community signing tool:** Mobilní wallet je primárně signing nástroj — governance hlasování vyžaduje uživatelův vlastní podpis

## Vyloučeno ze scope

- MiCA compliance assessment (Fáze 6c) — samostatný právní projekt
- Obousměrná sync (Cosmos → Supabase write-back) — až ve Fázi 6b
- Multi-sig key management — Fáze 5+ (single-key postačí pro privátní mainnet)
- Web browser wallet signing (MetaMask-style) — Fáze 6 (mobilní signing postačí pro privátní mainnet)
- MiCA marketingová compliance — jiný tým, jiný timeline
