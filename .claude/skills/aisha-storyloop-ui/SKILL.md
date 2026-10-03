---
name: aisha-storyloop-ui
description: StoryLoop React vzory v AISHA UI — Hook-Only Data Access, story hooky (useStoryLoop, useStoryBlockActions, useStoryAiConsult), block renderer řetěz StoryDetail → StoryEntryBlockRenderer → block komponenty, audited RPC napojení a Zod schémata. Použij při práci na story UI, member story flow nebo story detail. Triggers on "story hook", "storyloop", "block renderer", "useStory", "story ui", "member story", "block action", "story detail".
---

# AISHA StoryLoop UI Skill

**StoryLoop** je v tomto repu partner/member workspace nad "stories" (příběhy klientů): timeline entries, strukturované bloky (meeting, questionnaire, consent, lab, web-artifact, QA…), AI konzultace a delivery kontext. UI vrstva žije v `src/components/storyloop/`, data vrstva výhradně v custom hooks v `src/hooks/useStory*.ts`. Hloubková analýza modulu: `docs/analysis/STORYLOOP_MODULE_ANALYSIS.md`.

Platí **Hook-Only Data Access** (Absolute Rule #1, viz `docs/generated/dirigent-source-pack/04-.cursorrules`): API/RPC volání POUZE z custom hooks — komponenta nikdy nevolá `aisha.rpc()` ani `aisha.functions.invoke()` přímo. Hooky volají výhradně audited RPC (`*_audited`), nikdy `.from('table')`.

## Kdy to platí

| Scénář | Použij tento skill |
|---|---|
| Nový/upravený story hook (`src/hooks/useStory*.ts`) | **Ano** |
| Nový block typ v timeline (block komponenta + renderer registry) | **Ano** |
| Napojení block akce na RPC (`useStoryBlockActions`) | **Ano** |
| AI konzultace panel / optimistic updates (`useStoryAiConsult`) | **Ano** |
| Member story flow (`useEnsureMemberStory`, `src/pages/member/MemberStory.tsx`) | **Ano** |
| Nová/změněná Postgres RPC funkce (`aisha/db/sql/functions/*.sql`) | **Ne** — viz `aisha-rpc` skill |
| Fastify edge route (`services/svc-*/src/routes/*.ts`) | **Ne** — viz `aisha-edge-fn` skill |
| DB migrace / nová tabulka | **Ne** — viz `aisha-migration` skill |

## Architektura: řetěz block akcí

Ground truth (MASTER_PLAN, bug #2 resolution — původně 7 block typů / 5 RPC akcí, dnes registry ~19 typů a 6 akcí):

```
src/components/storyloop/StoryDetail.tsx          # detail view, drží useStoryBlockActions
  └─ src/components/storyloop/blocks/StoryEntryBlockRenderer.tsx   # registry entry_type → komponenta
       └─ blocks/MeetingRequestBlock.tsx, ConsentRequestBlock.tsx, LabOrderBlock.tsx, …
            └─ src/hooks/useStoryBlockActions.ts                   # callbacks + mutation
                 └─ RPC respond_to_story_block_audited              # aisha/db/sql/functions/respond_to_story_block_audited.sql
```

RPC `respond_to_story_block_audited` dnes zná 6 akcí: `accept_meeting`, `decline_meeting`, `reschedule_meeting`, `send_questionnaire_reminder`, `resend_consent_request`, `approve_flow_gate`. Novou akci přidáváš v SQL (→ `aisha-rpc` skill) + callback v `useStoryBlockActions.ts` + prop v rendereru.

## Kanonický tvar — query hook (viz `src/hooks/useStoryLoop.ts`)

Každý story hook má: (1) query-key factory, (2) `aisha.rpc('..._audited')`, (3) `safeError` + throw na RPC error, (4) Zod `safeParse` s bezpečným fallbackem na validation error.

```ts
import { useQuery } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { safeError } from '@/lib/security/safeLogger';
import { StoryListItemSchema, type StoryListItem } from '@/schemas/storyLoopSchemas';
import { z } from 'zod';

export const storyLoopKeys = {
  all: ['storyloop'] as const,
  stories: (filters?: { status?: string }) => [...storyLoopKeys.all, 'stories', filters] as const,
  story: (id: string) => [...storyLoopKeys.all, 'story', id] as const,
};

export function useStories(filters?: { status?: string | null }) {
  return useQuery({
    queryKey: storyLoopKeys.stories({ status: filters?.status ?? undefined }),
    queryFn: async (): Promise<StoryListItem[]> => {
      const { data, error } = await aisha.rpc('get_my_stories_audited', {
        p_status: filters?.status ?? undefined,
      });
      if (error) {
        safeError('storyloop.useStories', error);
        throw new Error(error.message);        // RPC error → throw (React Query retry/error state)
      }
      const validated = z.array(StoryListItemSchema).safeParse(data);
      if (!validated.success) {
        safeError('storyloop.useStories.validation', validated.error);
        return [];                              // validation error → safe fallback, NIKDY crash UI
      }
      return validated.data;
    },
  });
}
```

Infinite-scroll varianta (offset paginace přes `useInfiniteQuery` + `nextOffset`): `useInfiniteStories` tamtéž.

## Kanonický tvar — mutation hook

```ts
export function useUpdateStoryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { story_id: string; status: string }) => {
      const { data, error } = await aisha.rpc('update_story_status_audited', {
        p_status: params.status,
        p_story_id: params.story_id,
      });
      if (error) {
        safeError('storyloop.updateStoryStatus', error);
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.story(variables.story_id) });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stories() });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stats() });
    },
  });
}
```

- Mutating RPC má vždy sufix `_audited` (audit trail dělá RPC sama — viz `aisha-rpc`).
- JSONB parametry serializuj `JSON.parse(JSON.stringify(params.metadata ?? {}))` (vzor v `useCreateStoryEntry` i `useStoryBlockActions`).
- Toast + i18n: `toast.success(t('storyloop.blockActions.meetingAccepted'))` — nikdy hardcoded string.

## Optimistic update (viz `src/hooks/useStoryAiConsult.ts`)

`chatMutation` ukazuje plný vzor: `onMutate` → `cancelQueries` + snapshot `previousMessages` + optimistická user message do cache; `onError` → rollback ze snapshotu; `onSuccess` → `invalidateQueries`. AI dispatch jde přes `aisha.functions.invoke('ai-story-consult', …)` a konverzace se resolvuje RPC `edge_story_ai` + `get_chat_messages_audited` — server persistence, žádný `useState` jako zdroj pravdy.

## Block renderer registry (viz `src/components/storyloop/blocks/StoryEntryBlockRenderer.tsx`)

Renderer je objektový registry `entry_type → () => JSX.Element` typovaný `satisfies Partial<Record<StoryEntry['entry_type'], () => JSX.Element>>`. Speciální případ: `consent_request` sdílí entry_type mezi klinickým consentem a flowboard gate — diskriminuje se přes `metadata.flowboard.kind === 'consent_request'` → `FlowConsentGateBlock`.

### Checklist: přidání nového block typu

1. `src/schemas/storyLoopSchemas.ts` — přidej hodnotu do `StoryEntryTypeSchema` enum + `*Metadata` schema/typ.
2. `src/components/storyloop/blocks/{Name}Block.tsx` — nová komponenta (+ export v `src/components/storyloop/blocks/index.ts`).
3. `StoryEntryBlockRenderer.tsx` — registrace v registry.
4. `src/components/storyloop/blocks/utils.ts` — přidej typ do `isBlockEntry()` (jinak se renderuje jako plain text entry).
5. `src/components/storyloop/StoryDetail.tsx` — ikona v `entryTypeIcons`.
6. Interaktivní blok → callback v `src/hooks/useStoryBlockActions.ts` + akce v `respond_to_story_block_audited.sql` (→ `aisha-rpc`).
7. Test v `src/tests/hooks/` + i18n klíče v `src/i18n/segments/*/`.

## Zod schémata

- `src/schemas/storyLoopSchemas.ts` — `StoryEntryTypeSchema` (note/action/… + strukturované bloky vč. `web_artifact_*` a `qa_playwright_*`), `StoryListItemSchema`, `StoryDetailSchema`, `StoryStatsSchema`, metadata typy (`MeetingRequestMetadata`, `ConsentRequestMetadata`, …), `AiConsultResponseSchema`.
- `src/schemas/storyDeliverySchemas.ts` — delivery kontext (`DeliveryStatusEnum`, `StoryRulesetSchema`, story environments).

Každá RPC response MUSÍ projít Zod parse v hooku (Absolute Rule #3) — komponenty už dostávají validované typy.

## Member story

- `src/hooks/useEnsureMemberStory.ts` — idempotentní `ensure_member_story_exists` RPC při vstupu do member diary (vrací existující nebo nově vytvořené `storyId`).
- `src/pages/member/MemberStory.tsx` — member pohled; partner pohled je `src/pages/partner/StoryLoop.tsx`, admin `src/pages/admin/AdminStoryLoop.tsx` + `src/pages/admin/AdminStoryDetail.tsx`.

## Common pitfalls

❌ `aisha.rpc()` / `aisha.functions.invoke()` přímo v komponentě → porušuje Hook-Only Data Access; vždy nový/existující hook.
❌ `.from('table').select()` → BANNED, vždy audited RPC.
❌ `console.log` / `console.error` → `safeError`/`safeInfo` z `src/lib/security/safeLogger.ts` (hlídá `npm run lint:console`).
❌ Throw na Zod validation error v query hooku → UI crash; vzor je `safeError` + fallback (`[]` / `null`).
❌ Zapomenutá invalidace `storyLoopKeys.story(storyId)` po mutaci → stale timeline.
❌ Nový entry_type jen v rendereru → bez záznamu v `StoryEntryTypeSchema` + `isBlockEntry()` se blok nevyrenderuje.
❌ Záměna hooků: `useStoryDetail` exportuje JAK `src/hooks/useStoryLoop.ts` (partner detail, plná Zod validace), TAK `src/hooks/useStoryDetail.ts` (admin drill-in, raw JSONB pole). Zkontroluj import path.
❌ Hardcoded UI text nebo emoji → `t('key')` + lucide-react ikony (Absolute Rules #4, #6).
❌ `as any` → `unknown` + type guard / Zod (Absolute Rule #2).

## Gates / validace

```bash
npm run type-check        # tsc --noEmit
npm run lint              # eslint .
npm run lint:console      # zákaz console.* mimo safeLogger
npm test                  # vitest — hook testy: src/tests/hooks/useStoryLoop.test.tsx, useStoryBlockActions.test.tsx, useStoryAiConsult.test.ts
npm run test:gates        # gates (story-adjacent kontrakty např. src/tests/gates/story-self-eval.gate.test.ts)
npm run test:e2e:local    # Playwright — e2e/partner-storyloop.spec.ts, e2e/storyloop-sota.spec.ts, e2e/storyloop-access.spec.ts, e2e/storyloop-delivery-panel.spec.ts, e2e/story-web-artifact.spec.ts
```

## Reference

- `src/hooks/useStoryLoop.ts` — query-key factory + query/mutation vzory
- `src/hooks/useStoryBlockActions.ts` — block akce + modal state + `respond_to_story_block_audited`
- `src/hooks/useStoryAiConsult.ts` — optimistic updates + server-persisted AI thread
- `src/components/storyloop/StoryDetail.tsx` — kompozice detail view
- `src/components/storyloop/blocks/StoryEntryBlockRenderer.tsx` — registry vzor
- `aisha/db/sql/functions/respond_to_story_block_audited.sql` — SoT RPC pro block akce

## Související

- **`aisha-rpc`** — jak psát `*_audited` SECURITY DEFINER funkce, které hooky volají
- **`aisha-edge-fn`** — Fastify routes, které `aisha.functions.invoke()` zasahuje (např. `ai-story-consult`, `flowboard-execute`)
- **`aisha-migration`** — nové tabulky/RPC SoT soubory + baseline pravidla
- **Absolute Rules** — `docs/generated/dirigent-source-pack/04-.cursorrules` (Hook-Only, No any, Zod, i18n, no console.log, no emoji)
