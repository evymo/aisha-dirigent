# Epocha 1 — Self-Awareness: Dirigent Backend + Monitoring

> **Status:** ✅ DONE  
> **Závislost:** Epocha 0 (Bridge) ✅  
> **Cíl:** Admin viditelnost moderačních session, decisions a celého Dirigent flow

---

## Přehled

Epocha 1 propojuje existující DB infrastrukturu (moderation tables + RPCs z migrace `20260301140000`) s frontend admin UI. Přidává admin RPCs, Zod validaci, React hooks a stránku pro monitoring moderačních aktivit.

### Co už existuje (z předchozích migrací)

| Komponenta | Stav | Zdrojová migrace |
|-----------|------|-------------------|
| `moderation_sessions` tabulka | ✅ Deployed | 20260301140000 |
| `moderation_decisions` tabulka | ✅ Deployed | 20260301140000 |
| `moderate_development_flow()` RPC | ✅ Deployed | 20260301140000 |
| `evaluate_test_strategy()` RPC | ✅ Deployed | 20260301140000 |
| `assess_code_quality()` RPC | ✅ Deployed | 20260301140000 |
| `estimate_effort()` RPC | ✅ Deployed | 20260301140000 |
| `dirigent_action` event type | ✅ Deployed | 20260305210000 |
| `n8n_workflow` event type | ✅ Deployed | 20260305210000 |

---

## Úkoly

### 1.1 — Migrace: Admin RPCs + Event Type + Seed Data ✅

**Soubor:** `supabase/migrations/YYYYMMDDHHMMSS_epocha1_admin_moderation.sql`

- [x] `get_moderation_sessions_admin()` — paginated list pro admin
- [x] `get_moderation_decisions_admin()` — decisions pro session
- [x] `moderation_decision` event type do `ai_event_type` enum
- [x] Dirigent agent INSERT do `agent_configurations`
- [x] `dirigent_full` context profile INSERT do `context_profiles`

### 1.2 — Zod Schemas Update ✅

**Soubor:** `src/lib/schemas/expertOverlaySchemas.ts`

- [x] Rozšířit `aiEventTypeSchema` o všech 27 hodnot (z 11)
- [x] Přidat `moderationSessionRowSchema`
- [x] Přidat `moderationDecisionRowSchema`
- [x] Exportovat nové typy

### 1.3 — Admin Hook: useModerationAdmin ✅

**Soubor:** `src/hooks/useModerationAdmin.ts`

- [x] `useModerationSessions()` — paginated sessions via admin RPC
- [x] `useModerationDecisions(sessionId)` — decisions pro session
- [x] Barrel export v `src/hooks/index.ts`

### 1.4 — Admin UI: ModerationSessions Page ✅

**Soubor:** `src/pages/admin/AdminModerationSessions.tsx`

- [x] Seznam sessions s filtry (session_type, status)
- [x] Inline decision preview
- [x] Expandable session detail with timeline
- [x] Route: `/admin/moderation`

### 1.5 — Router Integration ✅

- [x] Lazy import v `src/router.tsx`
- [x] Route path registrace

### 1.6 — TypeScript + Build Verification ✅

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] Relevantní testy

### 1.7 — Commit + Push ✅

- [x] Git commit
- [x] Push to origin/main

---

## Verifikace

```bash
# Po aplikaci migrace
npm run db:migrate:local
npm run db:types:gen:local

# TypeScript
npx tsc --noEmit

# Build
npm run build
```
