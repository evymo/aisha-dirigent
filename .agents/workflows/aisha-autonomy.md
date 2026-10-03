---
description: How Antigravity operates autonomously within the AISHA Platform codebase
---
# AISHA Autonomous Agent Workflow

This workflow equips Antigravity with the exact steps to autonomously develop, test, and orchestrate features in the AISHA ecosystem. AISHA is rigorous; this workflow bypasses common errors and leverages built-in scripts efficiently.

## Core Rules of Engagement
- **Database Modding**: All DB changes MUST occur through migrations. Never use `.from()` directly in client code; always use `supabase.rpc()` and define RPC functions with `SECURITY DEFINER` (if anon) in SQL migrations.
- **Strict Testing**: Never run the full test suite when pushing a small change. Run ONLY individual tests that cover the modified hook or component using `npm run test:run -- path/to/test.test.ts`.
- **Zero Hardcoded Strings**: All text MUST use the i18n segments. If you add text, run `npm run i18n:check`.
- **No Emojis**: Always use `lucide-react` icons.

## Autonomous Operation Loop

Follow these steps dynamically whenever given a new objective:

// turbo
1. **Analyze Needs & Contextualize**
   - Run `grep_search` to find related patterns (např. search for similar `use*` hooks in `src/hooks`).
   - If changing SQL, check `supabase/migrations/` to understand existing structures.

// turbo
2. **Consult Aisha Dirigent (On-the-Fly Architecture Validation via MCP)**
   - **VŽDY** před zahájením samotného kódování (nebo při nejistotě během kódování) konzultuj navrhovaný směr s "Aisha Dirigent" přes integrovaný MCP Knowledge Server.
   - Stejně jako ve VS Code/Copilot integraci, použij dostupné MCP tools pro validaci tvých úvah:
     - Zavolej `suggest_next_step` pro doporučení správného postupu od Dirigenta.
     - Zavolej `moderate_flow` pro nastartování moderační session k plánovanému vývoji.
     - Zavolej `assess_quality` pro zhodnocení tvého kódu před odevzdáním.
   - Aisha Dirigent drží kontext celého AISHA (Knowledge, Compliance, Delivery). Antigravity NESMÍ dělat zásadní strukturální rozhodnutí bez této on-the-fly synchronizace přes MCP.

// turbo
3. **Implement Feature & Migrations**
   - Poskytni řešení s absolutní prioritou TypeScript bezpečnosti (bez `any`) a i18n standardů.
   - Databázové změny: vytvoř nový SQL soubor v `supabase/migrations/` a spusť postupně `npm run db:migration:register` -> `npm run db:migrate:local` -> `npm run db:types:gen:local` (vše autonomně v pozadí).

// turbo
4. **Verify Compliance (The "Gate" Check)**
   - Před dokončením úkolu MUSÍŠ iterovat tyto příkazy, dokud neprojdou bez chyb:
     - `npx tsc --noEmit`
     - `npm run lint`
     - `npm run test:gates`
   - Jakoukoliv chybu z těchto nástrojů se pokus ihned a autonomně opravit.

// turbo
5. **Test Run**
   - Spusť izolovaně pouze test file, který jsi měnil nebo přidal: `npm run test:run -- src/tests/...`
   - Ignoruj globální spouštění celého test suite, pokud to není absolutně nutné. Testuj chytře.

// turbo
6. **Finalize and Report**
   - Jakmile běh v pozadí projde na 100%, zabal a prezentuj uživateli výsledek s garancí, že jsi prošel validací u Dirigenta a testovacími gates.
   - Pro orchestraci n8n použij případně `node scripts/n8n-ops.mjs sync`.

*By adhering to this workflow, Antigravity functions as a fully integrated "Dirigent", executing tasks precisely against AISHA's strict standards.*
