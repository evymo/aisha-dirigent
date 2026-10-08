# StoryLoop Modul — Komplexní analytická zpráva

> **Typ:** RESEARCH-ONLY analýza  
> **Datum:** leden 2026  
> **Rozsah:** ~60 souborů (6 hooků, 1 schéma, 15+ SQL funkcí, 20+ komponent, 8 block rendererů, 8 composer forem, 2 stránky)

---

## Obsah

1. [Datový model a schéma](#1-datový-model-a-schéma)
2. [Role, oprávnění a přístupové vzory](#2-role-oprávnění-a-přístupové-vzory)
3. [Zápisové operace (mutace)](#3-zápisové-operace-mutace)
4. [Čtecí operace (queries)](#4-čtecí-operace-queries)
5. [AI integrace](#5-ai-integrace)
6. [Blokový systém (blocks)](#6-blokový-systém-blocks)
7. [Notifikace](#7-notifikace)
8. [Diskuze (Knowledge Base)](#8-diskuze-knowledge-base)
9. [Záložky a připomínky](#9-záložky-a-připomínky)
10. [Mezery, rizika a doporučení](#10-mezery-rizika-a-doporučení)

---

## 1. Datový model a schéma

### 1.1 Hlavní tabulky

| Tabulka | Účel | Klíčové sloupce |
|---------|------|-----------------|
| `partner_stories` | Hlavní příběhový kontejner | `partner_id`, `client_id`, `study_id`, `title`, `status`, `priority`, `is_starred`, `is_read`, `unread_count`, `last_activity_at` |
| `story_entries` | Jednotlivé záznamy v příběhu | `story_id`, `parent_id`, `entry_type`, `content`, `metadata` (JSONB), `is_internal`, `is_pinned`, `document_id`, `created_by` |
| `story_labels` | Štítky na příbězích | `story_id`, `partner_id`, `label`, `color` |
| `story_reminders` | Připomínky | `story_id`, `partner_id`, `remind_at`, `message`, `is_completed` |
| `story_ai_sessions` | AI konzultační relace | `story_id`, `session_type`, `tokens_used`, `context_snapshot` |

### 1.2 Podpůrné tabulky (sdílené s jinými moduly)

| Tabulka | Vztah ke StoryLoop |
|---------|-------------------|
| `knowledge_topics` | Diskuzní vlákna v StoryLoop sidebar |
| `knowledge_posts` | Příspěvky v diskuzních vláknech |
| `knowledge_post_translations` | Překlady příspěvků |
| `notifications` | Doručování notifikací členům |
| `member_health_documents` | Přílohy dokumentů k entryům |
| `document_sharing_permissions` | Sdílení dokumentů s partnery |
| `data_sharing_consents` | Consent management pro sensitive data přístup |
| `health_check_ins` | Zdravotní data zobrazovaná v panelu |
| `audit_journal` | Auditní záznamy |

### 1.3 Enum typy a hodnoty

**Status** (definováno v `storyLoopSchemas.ts`, řádky 5–11):
```
inbox | in_progress | scheduled | archived | trash
```

**Priorita** (řádky 13–18):
```
low | normal | high | urgent
```

**Entry typy** (18 typů, řádky 20–63):
```
note, action, system, tracking_event, request, message, email, ai_recap,
document, appointment, translation, meeting_request, questionnaire_request,
consent_request, lab_order, plan_adjustment, data_analysis, product_info
```

### 1.4 Block metadata schémata (Zod diskriminované unie)

Definovány v `src/schemas/storyLoopSchemas.ts`:

| Blok | Zod schéma | Klíčová metadata |
|------|-----------|------------------|
| `meeting_request` | `MeetingRequestMetadataSchema` | `meeting_type`, `location` (video/phone/in_person), `proposed_times[]`, `accepted_time`, `status`, `notes` |
| `questionnaire_request` | `QuestionnaireRequestMetadataSchema` | `questionnaire_key`, `questionnaire_name`, `due_date`, `status`, `response_id`, `completed_at`, `token_reward`, `reminder_sent` |
| `consent_request` | `ConsentRequestMetadataSchema` | `consent_type`, `consent_id`, `status` (pending/signed/declined/expired), `signed_at` |
| `lab_order` | `LabOrderMetadataSchema` | `tests[]`, `lab_name`, `status`, `scheduled_date`, `result_id` |
| `plan_adjustment` | `DistributionAdjustmentMetadataSchema` | `product_name`, `previous_dose`, `new_dose`, `effective_from`, `reason` |
| `data_analysis` | `BloodMatrixAnalysisMetadataSchema` | 3×3 matice (`matrix`), `counts` (I/II/III), `weighted_score`, `severity`, `recommendations[]`, `protocol_step_keys[]`, `analysis_source` |
| `product_info` | `ProductInfoMetadataSchema` | `product_name`, `batch_number`, `manufacturer`, `certifications[]` |

**BloodMatrixAnalysis** je nejkomplexnější schéma — 9 buněk (A1–C3), každá s `grade` (0/I/II/III) a `note`, váhovaný skóring, úrovně závažnosti (mild/moderate/severe/critical), doporučení suplementů s prioritami (core/support/optional).

### 1.5 StoryDetail kompozitní struktura

`StoryDetailSchema` (řádky 300–370) vrací:
- Základní pole příběhu (id, title, status, priority, ...)
- `user_display_name` — kontextuální: jméno uživatela pro partnera, obchodní název pro člena
- `entries[]` — pole `StoryEntry` s nested `metadata` (JSONB)
- `reminders[]` — aktivní připomínky
- `labels[]` — štítky příběhu

---

## 2. Role, oprávnění a přístupové vzory

### 2.1 Duální režim (Partner vs. Member)

StoryLoop operuje ve dvou fundamentálně odlišných režimech:

**Partner režim** (`src/pages/partner/StoryLoop.tsx`):
- Přístup přes oprávnění: `view_studies`, `view_partner_dashboard`, `view_assigned_members`
- Identifikace: `get_current_partner_id()` v SQL funkcích
- Plný přístup: see/create internal entries, manage status, labels, reminders
- Aisha AI konzultace dostupná v sheet panelu

**Member režim** (`src/pages/member/MemberStory.tsx`):
- Stránka neslouží jako StoryLoop, ale jako **Member Diary** — dashboardový pohled na suplementy, privátní stavy a timeline
- Member nativně nevidí StoryLoop workspace — přistupuje pouze přes `MemberTimelineView`
- Přístup přes `hasRole('member')`
- Member může vytvořit story přes `canCreateMemberStory` (řádek 56, StoryLoop.tsx)

### 2.2 SQL autorizační vzory

Každá SQL funkce implementuje vlastní autorizační logiku:

| Funkce | Autorizační vzor | Soubor |
|--------|-----------------|--------|
| `create_story_audited` | Partner: `has_data_sharing_consent()`. Member: vlastní stories v enrolled studiích | `create_story_audited.sql` |
| `create_story_entry_audited` | Kontrola `partner_id` nebo `client_id` match na story | `create_story_entry_audited.sql` |
| `get_story_detail_audited` | Partner: `partner_id` match. Member: `client_id` match. Member NIKDY nevidí `is_internal` entries | `get_story_detail_audited.sql` |
| `create_storyloop_notification` | Partner profil NEBO admin. Non-admin: `is_consultant_for_user()` NEBO `has_data_sharing_consent()` | `create_storyloop_notification.sql` |
| `get_storyloop_admin_overview` | `is_admin_or_staff()` guard | `get_storyloop_admin_overview.sql` |
| `get_story_attachable_documents_audited` | Partner: documents via `document_sharing_permissions`. Member: vlastní dokumenty. Consent check pro partner | `get_story_attachable_documents_audited.sql` |

### 2.3 Permission checks na frontend

V `StoryLoop.tsx` (řádky 43–57):
```typescript
canAccessStoryMode = hasAnyPermission('view_studies', 'view_partner_dashboard', 'view_assigned_members')
canAccessPartnerStories = hasAnyPermission('view_partner_dashboard', 'view_assigned_members')
canCreateMemberStory = isMemberStoryRoute && hasRole('member')
canCreateStory = (canAccessPartnerStories && isPartnerStoryRoute) || canCreateMemberStory
```

V `StoryComposer.tsx` — kompozerové formuláře kontrolují:
- `canUseInternalNotes` — oprávnění pro interní poznámky
- `canCreateMemberNotifications` — oprávnění pro notifikace členům

### 2.4 Consent-gated sensitive data přístup

Activity data v `UserActivityPanel.tsx` (řádky 320–330):
- Hook `useUserActivityData` interně kontroluje consent
- Fail-closed: bez grantu zobrazí `NoConsentPlaceholder`
- 3 stavy: loading → no-consent → granted (data)

`MemberAccessCard.tsx` definuje 4 úrovně přístupu:
- **full**: plný přístup ke všem datovým kategoriím
- **limited**: omezený přístup (některé kategorie skryté)
- **anonymized**: anonymizovaná data
- **none**: žádný přístup

6 datových kategorií v MemberAccessCard: `health_checkins`, `lab_results`, `documents`, `assessments`, `activity_logs`, `study_data`

---

## 3. Zápisové operace (mutace)

### 3.1 Přehled mutací v `useStoryLoop.ts`

| Hook | SQL funkce | Invalidace cache | Řádky |
|------|-----------|-------------------|-------|
| `useCreateStory` | `create_story_audited` | `storyLoopKeys.all` | 300–330 |
| `useCreateStoryEntry` | `create_story_entry_audited` | `storyLoopKeys.detail(storyId)` + `storyLoopKeys.lists()` | 332–375 |
| `useUpdateStoryStatus` | `update_story_status_audited` | `storyLoopKeys.detail(storyId)` + `storyLoopKeys.lists()` + `storyLoopKeys.stats()` | 377–410 |
| `useToggleStoryStar` | `toggle_story_star_audited` | `storyLoopKeys.detail(storyId)` + `storyLoopKeys.lists()` + `storyLoopKeys.stats()` | 412–440 |
| `useCreateStoryReminder` | `create_story_reminder_audited` | `storyLoopKeys.detail(storyId)` + `storyLoopKeys.reminders()` | 442–453 |

### 3.2 Story vytvoření — duální mód

V `create_story_audited.sql`:

**Partner mód** (partner_id je přítomno):
1. Ověří consent: `has_data_sharing_consent(p_client_id, partner_id)`
2. INSERT do `partner_stories`
3. Audit log

**Member mód** (partner_id je NULL):
1. Ověří registration: `program_registrations` WHERE `user_id = auth.uid()` AND `status = 'enrolled'`
2. Resolví partner_id přes `study_consultants` JOIN `data_sharing_consents`
3. INSERT do `partner_stories` s resolved partner_id
4. Audit log

### 3.3 Entry vytvoření s notifikací

V `StoryComposer.tsx` (řádky 360–420):
1. Volá `createEntry.mutateAsync({ ... })`
2. Po úspěchu volá `maybeNotifyMember()` — vytvoří notifikaci přes `useStoryLoopNotifications`, pokud:
   - Entry není `is_internal`
   - Uživatel má oprávnění `canCreateMemberNotifications`
   - Entry typ je notifikovatelný (7 typů)

### 3.4 Trigger: Automatická aktualizace aktivity

`update_story_last_activity.sql` — TRIGGER funkce na `story_entries` INSERT:
- Aktualizuje `last_activity_at` na `NOW()`
- Inkrementuje `unread_count` pokud `created_by != partner.user_id`
- Zajišťuje, že partner vidí nepřečtené entries

---

## 4. Čtecí operace (queries)

### 4.1 Query key factory

V `useStoryLoop.ts` (řádky 30–55):
```typescript
storyLoopKeys = {
  all: ['storyloop'],
  lists: () => [...all, 'list'],
  list: (filters) => [...lists(), filters],
  details: () => [...all, 'detail'],
  detail: (id) => [...details(), id],
  stats: () => [...all, 'stats'],
  labels: () => [...all, 'labels'],
  reminders: () => [...all, 'reminders'],
  aiContext: (id) => [...all, 'ai-context', id],
  attachableDocs: (storyId) => [...all, 'attachable-docs', storyId],
}
```

### 4.2 Přehled čtecích hooků

| Hook | SQL funkce | Parametry | Validace |
|------|-----------|-----------|----------|
| `useStories` | `get_my_stories_audited` | status, labels[], search, limit (=50) | `StoryListItemSchema.array()` |
| `useStoryDetail` | `get_story_detail_audited` | story_id | `StoryDetailSchema` |
| `useStoryStats` | `get_partner_story_stats` | (žádné) | `StoryStatsSchema` |
| `useStoryLabels` | `get_my_story_labels_audited` | (žádné) | `LabelStatsSchema.array()` |
| `useUpcomingReminders` | `get_my_upcoming_reminders_audited` | (žádné) | pole |
| `useStoryAiContext` | `get_story_context_for_ai_audited` | story_id | JSONB |
| `useStoryAttachableDocuments` | `get_story_attachable_documents_audited` | story_id | pole |

### 4.3 Filtrace a vyhledávání

**Server-side filtrování** (přes RPC parametry):
- `p_status` — filtr statusu
- `p_search` — full-text vyhledávání v title
- `p_labels` — filtr štítků (pole)

**Client-side filtrování**:
- **Starred** — `StoryList.tsx` filtruje lokálně přes `stories.filter(s => s.is_starred)` (řádek ve StoryList)
- **Limit hardcoded** na 50 bez paginace (StoryList předává `limit: 50`)

### 4.4 Story Detail — co vrací

`get_story_detail_audited.sql` vrací:
- Základní story pole
- `entries` jako `jsonb_agg` s `ORDER BY created_at ASC`
- `labels` jako `jsonb_agg`
- `reminders` jako `jsonb_agg` WHERE `is_completed = false`
- **Side effect**: Partner view auto-marks story jako přečtený (`is_read = true`, `unread_count = 0`)

---

## 5. AI integrace

### 5.1 Architektura

```
Frontend (AishaConsultPanel)
    │
    ├── useStoryAiContext (hook) → get_story_context_for_ai_audited (SQL)
    │                               └── Vrací JSONB: timeline_summary, study_info, recent_checkins, shared_docs_count
    │
    └── useStoryAiConsult (hook) → Edge Function (Supabase)
                                    └── edge_story_ai.sql (session persistence)
```

### 5.2 AI Context (SQL)

`get_story_context_for_ai_audited.sql`:
- Vrací posledních **20 entries** jako `timeline_summary`
- Vrací **study_info** (název, partner, registration status)
- Vrací posledních **10 check-ins** (sensitive-data — consent-gated)
- Vrací `shared_documents_count`
- **Consent check**: sensitive data sekce (check-ins) je zahrnuta POUZE pokud `has_data_sharing_consent()`

### 5.3 Session persistence

`edge_story_ai.sql`:
- Jednoúčelová funkce — podporuje pouze akci `'insert_session'`
- INSERT do `story_ai_sessions` (story_id, session_type, tokens_used, context_snapshot)
- Zapisuje do `audit_journal`
- `GRANT EXECUTE` na `service_role` i `authenticated`

### 5.4 Frontend — AishaConsultPanel

`AishaConsultPanel.tsx`:
- Sheet-based chat UI
- 4 quick akce přes `AishaQuickActions.tsx`: recap, translate, recommend, analyze
- Zprávy uložené v **lokálním stavu** — nezachované mezi otevřeními panelu
- Token usage zobrazení per zpráva

### 5.5 Zjištění

- **Session data se ztrácí** při zavření panelu (lokální state, ne persisted)
- Edge function je GRANT na `authenticated` — potenciálně příliš permisivní (každý přihlášený uživatel může vytvářet AI sessions)
- `context_snapshot` ukládá JSONB kontextu — může obsahovat sensitive data (check-in data) pokud consent existuje

---

## 6. Blokový systém (blocks)

### 6.1 Architektura bloků

```
StoryComposer (vytváření)           StoryDetail (zobrazení)
    │                                    │
    ├── EntryType selector               ├── StoryEntryBlockRenderer
    │   ├── note, action, message        │   ├── MeetingRequestBlock
    │   └── 7 block typů                 │   ├── QuestionnaireRequestBlock
    │       ├── MeetingBlockForm         │   ├── ConsentRequestBlock
    │       ├── QuestionnaireBlockForm   │   ├── LabOrderBlock
    │       ├── ConsentBlockForm         │   ├── DistributionAdjustmentBlock
    │       ├── LabOrderBlockForm        │   └── BloodMatrixAnalysisBlock
    │       ├── DistributionAdjustmentForm     │
    │       ├── BloodMatrixForm          └── CommunicationBlockTemplate (common layout)
    │       └── EmailBlockForm
    │
    └── metadata → JSONB do story_entries.metadata
```

### 6.2 Registr bloků

`StoryEntryBlockRenderer.tsx` — registr mapuje 6 entry typů na komponenty:

| Entry type | Renderer komponenta | Composer forma |
|------------|-------------------|----------------|
| `meeting_request` | `MeetingRequestBlock` | `MeetingBlockForm` |
| `questionnaire_request` | `QuestionnaireRequestBlock` | `QuestionnaireBlockForm` |
| `consent_request` | `ConsentRequestBlock` | `ConsentBlockForm` |
| `lab_order` | `LabOrderBlock` | `LabOrderBlockForm` |
| `plan_adjustment` | `DistributionAdjustmentBlock` | `DistributionAdjustmentBlockForm` |
| `data_analysis` | `BloodMatrixAnalysisBlock` | `BloodMatrixAnalysisBlockForm` |

### 6.3 `isBlockEntry()` utility

`blocks/utils.ts` — kontroluje 6 typů (identických s registrem). Používá se pro rozlišení block vs. plain entry v timeline renderingu.

### 6.4 CommunicationBlockTemplate

Sdílený layout vzor (`CommunicationBlockTemplate.tsx`):
- **Props**: `icon`, `title`, `subtitle`, `status`, `headerAside`, `body`, `actions[]`
- **Akce**: pole `CommunicationBlockAction` s `id`, `label`, `onClick`, `icon`, `variant`
- Používáno v: `MeetingRequestBlock`, `QuestionnaireRequestBlock`, `ConsentRequestBlock`, `LabOrderBlock`, `DistributionAdjustmentBlock`
- **NEpoužíváno** v: `BloodMatrixAnalysisBlock` (vlastní Card layout), `LabTestRecommendationBlock` (vlastní expandable Card)

### 6.5 Speciální bloky

**BloodMatrixAnalysisBlock** (225 řádků):
- 3×3 grid buněk s grading system (0/I/II/III)
- Severity assessment s doporučenou délkou programu
- Parazitární signál warning
- Protocol steps (lokalizované klíče)
- Product recommendations s prioritami

**LabTestRecommendationBlock** (303 řádků):
- Collapsible panel s test selection
- Checkbox-based výběr testů
- Cena v CZK formátování
- AI recommendations sekce (gradient background)
- Panel-level a celkový souhrn cen
- `onSelectTests` a `onOrderTests` callbacky

**QuestionnaireRewardBadge** (64 řádků):
- Standalone badge pro token reward zobrazení
- Tooltip s částkou

### 6.6 Kritické zjištění — Nepropojené akce

V `StoryDetail.tsx` je `StoryEntryBlockRenderer` renderován pro každý block entry, ale **žádné action callbacky nejsou propojeny**:

```tsx
// StoryDetail.tsx — block renderer je volaný BEZ action handleru:
<StoryEntryBlockRenderer
  entryType={entry.entry_type}
  metadata={entry.metadata}
  entryId={entry.id}
  storyId={storyId}
  isPartnerView={...}
  // onMeetingAccept → UNDEFINED
  // onMeetingDecline → UNDEFINED  
  // onViewResults → UNDEFINED
  // onSendReminder → UNDEFINED
/>
```

Všechny bloky definují akční tlačítka (Accept/Decline/View Results/Send Reminder), ale ta jsou **mrtvá** — nikde nejsou napojená na skutečnou business logiku.

---

## 7. Notifikace

### 7.1 Hook: `useStoryLoopNotifications.ts`

7 notifikačních typů:
```
questionnaire_request | meeting_request | consent_request |
lab_order | plan_adjustment | reminder | message
```

### 7.2 Notifikační flow

1. Partner vytvoří entry v `StoryComposer`
2. Po úspěšném uložení se volá `maybeNotifyMember()`
3. `buildNotificationContent()` mapuje entry_type na:
   - `title` (i18n klíč)
   - `message` (i18n klíč)  
   - `link` (deep link: `/member/story?view=stories&story={id}&post={entryId}`)
4. `useCreateStoryLoopNotification` volá RPC `create_storyloop_notification`

### 7.3 SQL: `create_storyloop_notification.sql`

Autorizace:
- Vyžaduje partner profil NEBO admin roli
- Non-admin musí být buď `is_consultant_for_user()` NEBO mít `has_data_sharing_consent()`
- INSERT do `notifications` tabulky

### 7.4 Zjištění

- Deep link formát (`/member/story?view=stories&story=...`) odkazuje na `MemberStory.tsx` stránku, která ale **neobsahuje StoryLoop workspace** — je to Member Diary s timeline view. Deep link tedy **nemusí správně navigovat** na konkrétní story/post.
- Notifikace se vytváří pouze pro 7 typů — `email`, `document`, `appointment`, `system`, `tracking_event`, `ai_recap`, `translation`, `note`, `action`, `data_analysis`, `product_info` nemají notifikační mapování.

---

## 8. Diskuze (Knowledge Base)

### 8.1 Datový model

| Tabulka | Sloupce |
|---------|---------|
| `knowledge_topics` | id, title, summary, body_markdown, visibility (public/members), is_locked, verification_status, post_count, links[] |
| `knowledge_posts` | id, topic_id, author_user_id, body_original, original_locale, status |
| `knowledge_post_translations` | post_id, locale, body_translated, provider |

### 8.2 SQL funkce

| Funkce | Účel | Security |
|--------|------|----------|
| `get_knowledge_topics_localized` | Výpis témat s lokalizací | SECURITY DEFINER, authenticated |
| `get_knowledge_topic_detail_by_id_localized` | Detail tématu | SECURITY DEFINER, authenticated |
| `get_knowledge_topic_posts_localized` | Příspěvky s cursor-based paginací | SECURITY DEFINER, authenticated |
| `create_knowledge_post_audited` | Vytvoření příspěvku s auditem | SECURITY DEFINER, authenticated |
| `create_knowledge_topic` | Admin vytvoření tématu | SECURITY DEFINER |
| `update_knowledge_topic` | Admin úprava | SECURITY DEFINER |
| `delete_knowledge_topic` | Admin smazání | SECURITY DEFINER |

### 8.3 Hook: `useStoryLoopDiscussions.ts`

- `useDiscussionThreads` → `get_knowledge_topics_localized`
- `useDiscussionTopicDetail` → `get_knowledge_topic_detail_by_id_localized`
- `useDiscussionPosts` → `get_knowledge_topic_posts_localized` (**useInfiniteQuery** s cursor-based paginací)
- `useCreateDiscussionPost` → `create_knowledge_post_audited`

Query key factory: `discussionKeys` (oddělaný od `storyLoopKeys`)

### 8.4 Frontend integrace

`StoryLoopFilterBar.tsx` — Tabs toggle mezi `stories` a `discussions` módem:
- Pokud uživatel nemá `canAccessStoryMode`, je přinucen do `discussions` módu
- Discussion mód skrývá status pills a label filtraci

`DiscussionList.tsx` — Výpis témat s:
- Visibility badge (members_only / public)
- Verification status badge
- Post count

`DiscussionDetail.tsx` (484 řádků):
- Collapsible topic info (summary + body_markdown + linked resources)
- Infinite scroll posts timeline
- Post composer s Ctrl+Enter submit
- Bookmark podpora per post
- Deep link podpora (`?post=` parameter)
- Locked topics skrývají composer

### 8.5 Překlad příspěvků

`get_knowledge_topic_posts_localized.sql` implementuje multi-locale support:
```sql
COALESCE(kpt.body_translated, kp.body_original) AS body
```
- LEFT JOIN na `knowledge_post_translations` podle `locale`
- Vrací `is_translated` boolean a `translation_provider`
- Autor display name přes `format_display_name_for_public()` (respektuje privacy)

---

## 9. Záložky a připomínky

### 9.1 Záložky — `useStoryLoopBookmarks.ts`

**Architektura**: Čistě client-side localStorage
- Storage key: `storyloop.bookmarks.v1.{userId}`
- Bookmark ID formát: `{threadType}:{threadId}:{entryId}`
- Thread types: `'story' | 'discussion'`

**Cross-tab synchronizace**:
- `StorageEvent` listener pro cross-tab
- `CustomEvent('storyloop-bookmarks-updated')` pro same-tab

**Operace**:
- `addBookmark(bookmark)` — přidání s metadaty (threadTitle, entryPreview, createdAt)
- `removeBookmark(bookmarkId)` — odebrání
- `isBookmarked(threadType, threadId, entryId)` — test existence
- `bookmarks` — reaktivní pole všech záložek

**StoryLoopBookmarkSheet** — Sheet panel v StoryLoop.tsx zobrazující záložky s navigací na konkrétní post.

### 9.2 Připomínky — Server-side

**Vytvoření**: `useCreateStoryReminder` → `create_story_reminder_audited`
- `remind_at` (timestamptz), `message`, `story_id`
- `partner_id` vždy nastaven na partnera příběhu

**Čtení**: `useUpcomingReminders` → `get_my_upcoming_reminders_audited`
- Vrací nesplněné připomínky seřazené podle `remind_at`

**Zobrazení**: V `StoryDetail.tsx` se zobrazují v header sekci příběhu.

### 9.3 Zjištění záložek

- **Záložky nejsou server-persisted** — ztratí se při vymazání localStorage nebo přechodu na jiné zařízení
- **Žádný limit** na počet záložek — potenciální problém u power users
- **Cross-tab sync funguje** přes StorageEvent, ale **custom event** synchronizace v rámci stejného tabu vyžaduje manuální dispatch

---

## 10. Mezery, rizika a doporučení

### 10.1 Bezpečnostní rizika

#### KRITICKÉ: `update_story_status_audited.sql` — chybějící ownership WHERE clause

```sql
-- Funkce ověřuje vlastnictví v SELECT:
SELECT ... WHERE id = p_story_id AND (partner_id = v_partner_id OR client_id = v_user_id)

-- Ale UPDATE používá jen:
UPDATE partner_stories SET status = p_new_status WHERE id = p_story_id;
```

UPDATE **nemá restriction** na `partner_id`/`client_id`. I když předchozí SELECT ověří vlastnictví, mezi SELECT a UPDATE existuje TOCTOU race condition. Správné řešení: přidat ownership podmínku přímo do UPDATE WHERE clause.

#### STŘEDNÍ: `edge_story_ai.sql` — příliš široký GRANT

```sql
GRANT EXECUTE ON FUNCTION edge_story_ai TO authenticated;
```

Každý přihlášený uživatel může vytvářet AI sessions — mělo by být omezeno na partnery nebo uživatele s konsent-validovaným přístupem k danému příběhu.

#### STŘEDNÍ: `get_block_response_history_audited.sql` — nestandartní audit

Funkce používá sloupec `'action'` v audit INSERT, který nemusí odpovídat aktuálnímu schématu `audit_journal`.

### 10.2 Funkční mezery

#### Nepropojené block akce (VYSOKÁ priorita)

`StoryDetail.tsx` renderuje bloky přes `StoryEntryBlockRenderer`, ale **NEpředává žádné action callbacky**:
- `onMeetingAccept` / `onMeetingDecline` / `onReschedule` → undefined
- `onViewResults` (questionnaire, lab) → undefined  
- `onSendReminder` (questionnaire) → undefined

**Dopad**: Všechna akční tlačítka v blocích (Accept Meeting, View Results, Send Reminder, atd.) jsou **nefunkční** — renderují se, ale po kliknutí se nic nestane.

**Doporučení**: Implementovat handlery v `StoryDetail.tsx` nebo `useStoryLoop.ts` pro každou block action, propojit s odpovídajícími RPC funkcemi.

#### Chybějící block renderery (STŘEDNÍ priorita)

| Entry type | Má composer formu? | Má block renderer? | Stav |
|------------|-------------------|--------------------|------|
| `product_info` | NE | NE | Chybí obojí — entry type definován v schématu, ale nikde neimplementován |
| `email` | ANO (`EmailBlockForm`) | NE | Může být vytvořen, ale zobrazí se jako plain text místo strukturovaného bloku |

`product_info` není ani v `isBlockEntry()` utility — nebude detekován jako blokový entry.

#### Deep link notifikací směřuje špatně (STŘEDNÍ priorita)

`buildMemberStoryEntryLink()` generuje:
```
/member/story?view=stories&story={id}&post={entryId}
```

Ale `MemberStory.tsx` **neobsahuje StoryLoop workspace** — je to Member Diary s `MemberTimelineView` a `DashboardGrid`. Tyto query parametry (`view`, `story`, `post`) nejsou na stránce zpracovány.

#### StoryDocumentPreview — nedokončené sdílení (NÍZKÁ priorita)

`StoryDocumentPreview.tsx` obsahuje share tlačítko s TODO komentářem:
```
// TODO: Implement document sharing via partner portal
```

### 10.3 Škálovatelnost

#### Chybějící paginace stories

`useStories` hook předává `p_limit: 50` bez offset/cursor parametru. Pro partnery s více než 50 příběhy jsou starší příběhy nedostupné.

**Doporučení**: Implementovat cursor-based paginaci (jako u discussion posts) s `useInfiniteQuery`.

#### Client-side filtrování starred

`StoryList.tsx` filtruje starred příběhy locálně: `stories.filter(s => s.is_starred)`. Při 50 příbězích to je efektivní, ale brání to zobrazení všech starred příběhů pokud jich je více a nejsou v prvních 50.

**Doporučení**: Přidat `p_starred_only` parametr do `get_my_stories_audited`.

#### Záložky v localStorage

Záložky jsou **pouze v prohlížeči** — neexistuje server persistence. Pro produkční app je to problém:
- Ztráta při vymazání cache
- Nesynchornizované mezi zařízeními
- Žádný audit trail

**Doporučení**: Vytvořit `story_bookmarks` tabulku s RLS a auditní RPC funkci.

### 10.4 UX mezery

#### AI panel — ztráta konverzace

`AishaConsultPanel.tsx` udržuje zprávy v `useState` — při zavření Sheet panelu se konverzace ztratí. AI sessions jsou persisted na serveru (via `edge_story_ai.sql`), ale **obsah zpráv se neobnovuje** při znovuotevření.

**Doporučení**: Načítat historii AI sessions z DB při otevření panelu.

#### Chybějící trash/archive bulk operace

Status management je per-story (dropdown v StoryDetail). Chybí:
- Hromadný výběr stories
- Bulk status change
- Bulk archivace/smazání

### 10.5 Datová integrita

#### Template Builder — žádná server persistence viditelná

`PartnerTemplateBuilder.tsx` (485 řádků) implementuje kompletní DnD template builder, ale v analyzovaných SQL funkcích **neexistuje** `save_partner_template` nebo podobná funkce. Template data mohou být ukládána jinde, ale v rámci StoryLoop SQL souborů chybí odpovídající persistence layer.

#### Reminders — žádný notifikační mechanismus

`story_reminders` se ukládají do DB, ale **neexistuje** cron job nebo scheduled function, která by v čas `remind_at` odeslala notifikaci. Reminders jsou pouze pasivní — zobrazí se v UI jako nadcházející, ale aktivně nenotifikují.

### 10.6 Souhrnná matice priorit

| # | Zjištění | Závažnost | Oblast |
|---|---------|-----------|--------|
| 1 | Nepropojené block akce v StoryDetail | VYSOKÁ | Funkčnost |
| 2 | TOCTOU v `update_story_status_audited` | VYSOKÁ | Bezpečnost |
| 3 | Deep link notifikací na MemberStory nefunguje | STŘEDNÍ | Funkčnost |
| 4 | Chybějící `product_info` a `email` block renderery | STŘEDNÍ | Kompletnost |
| 5 | Edge AI function příliš široký GRANT | STŘEDNÍ | Bezpečnost |
| 6 | Žádná paginace stories (limit 50) | STŘEDNÍ | Škálovatelnost |
| 7 | Záložky pouze v localStorage | STŘEDNÍ | Data persistence |
| 8 | AI konverzace se ztrácí při zavření panelu | NÍZKÁ | UX |
| 9 | StoryDocumentPreview sdílení neimplementováno | NÍZKÁ | Kompletnost |
| 10 | Reminders bez aktivní notifikace | NÍZKÁ | Funkčnost |
| 11 | Template builder — nejasná server persistence | NÍZKÁ | Architektura |
| 12 | Starred filtr client-side only | NÍZKÁ | Škálovatelnost |

---

## Appendix A: Seznam analyzovaných souborů

### Hooks (6)
- `src/hooks/useStoryLoop.ts` (453 ř.)
- `src/hooks/useStoryLoopDiscussions.ts`
- `src/hooks/useStoryLoopBookmarks.ts`
- `src/hooks/useStoryLoopAdmin.ts`
- `src/hooks/useStoryLoopNotifications.ts`
- `src/hooks/useStoryLoopUiPreferences.ts`

### Schémata (1)
- `src/schemas/storyLoopSchemas.ts` (487 ř.)

### SQL funkce (15+)
- `supabase/sql/functions/create_story_audited.sql`
- `supabase/sql/functions/create_story_entry_audited.sql`
- `supabase/sql/functions/get_story_detail_audited.sql`
- `supabase/sql/functions/get_partner_story_stats.sql`
- `supabase/sql/functions/get_my_story_labels_audited.sql`
- `supabase/sql/functions/toggle_story_star_audited.sql`
- `supabase/sql/functions/update_story_status_audited.sql`
- `supabase/sql/functions/create_story_reminder_audited.sql`
- `supabase/sql/functions/get_story_context_for_ai_audited.sql`
- `supabase/sql/functions/edge_story_ai.sql`
- `supabase/sql/functions/create_storyloop_notification.sql`
- `supabase/sql/functions/get_storyloop_admin_overview.sql`
- `supabase/sql/functions/get_story_attachable_documents_audited.sql`
- `supabase/sql/functions/update_story_last_activity.sql`
- `supabase/sql/functions/get_block_response_history_audited.sql`
- `supabase/sql/functions/create_knowledge_post_audited.sql`
- `supabase/sql/functions/get_knowledge_topic_posts_localized.sql`

### Komponenty (20+)
- `src/components/storyloop/StoryComposer.tsx` (541 ř.)
- `src/components/storyloop/StoryDetail.tsx` (554 ř.)
- `src/components/storyloop/StoryList.tsx`
- `src/components/storyloop/StoryLoopFilterBar.tsx` (455 ř.)
- `src/components/storyloop/StoryLoopPageLayout.tsx`
- `src/components/storyloop/StoryLoopBookmarkSheet.tsx`
- `src/components/storyloop/NewStoryDialog.tsx`
- `src/components/storyloop/AishaConsultPanel.tsx`
- `src/components/storyloop/AishaQuickActions.tsx`
- `src/components/storyloop/DiscussionList.tsx`
- `src/components/storyloop/DiscussionDetail.tsx` (484 ř.)
- `src/components/storyloop/UserActivityPanel.tsx` (523 ř.)
- `src/components/storyloop/StoryActivitySummary.tsx`
- `src/components/storyloop/MemberAccessCard.tsx` (287 ř.)
- `src/components/storyloop/PartnerTemplateBuilder.tsx` (485 ř.)
- `src/components/storyloop/StoryDocumentPreview.tsx` (265 ř.)

### Block renderery (8)
- `src/components/storyloop/blocks/StoryEntryBlockRenderer.tsx`
- `src/components/storyloop/blocks/utils.ts`
- `src/components/storyloop/blocks/CommunicationBlockTemplate.tsx`
- `src/components/storyloop/blocks/MeetingRequestBlock.tsx`
- `src/components/storyloop/blocks/QuestionnaireRequestBlock.tsx`
- `src/components/storyloop/blocks/ConsentRequestBlock.tsx`
- `src/components/storyloop/blocks/LabOrderBlock.tsx`
- `src/components/storyloop/blocks/LabTestRecommendationBlock.tsx` (303 ř.)
- `src/components/storyloop/blocks/DistributionAdjustmentBlock.tsx`
- `src/components/storyloop/blocks/BloodMatrixAnalysisBlock.tsx` (225 ř.)
- `src/components/storyloop/blocks/QuestionnaireRewardBadge.tsx`

### Composer formy (8)
- `src/components/storyloop/composer/MeetingBlockForm.tsx`
- `src/components/storyloop/composer/QuestionnaireBlockForm.tsx`
- `src/components/storyloop/composer/ConsentBlockForm.tsx`
- `src/components/storyloop/composer/LabOrderBlockForm.tsx`
- `src/components/storyloop/composer/DistributionAdjustmentBlockForm.tsx`
- `src/components/storyloop/composer/BloodMatrixAnalysisBlockForm.tsx`
- `src/components/storyloop/composer/EmailBlockForm.tsx`

### Stránky (2)
- `src/pages/partner/StoryLoop.tsx` (458 ř.)
- `src/pages/member/MemberStory.tsx` (500 ř.)
