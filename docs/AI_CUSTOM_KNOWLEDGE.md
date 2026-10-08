# AI Custom Knowledge

Tento dokument je určený jako „shared memory“ pro AI asistenty a pro konzistentní úpravy v tomto repozitáři.

## Knowledge (Custom Knowledge)

Tento repozitář je produkční aplikace pracující s citlivými daty. Klíčové pilíře:

- Frontend: React + TypeScript + Vite, routing přes `react-router-dom`, data fetching přes `@tanstack/react-query`.
- Backend: Supabase (Postgres + RPC + Edge Functions + Storage). Preferovaný přístup k datům je „RPC-only“ (zejména pro sensitive-data) a auditovatelný tok.
- secure režim: existuje koncept „secure mode“ (in-memory session; bez persistace), určený pro operace se citlivými daty.
- Bezpečné logování: používat `safeError/safeWarn/safeInfo` z `src/lib/security/safeLogger.ts`; nikdy nelogovat emaily/jména/citlivá data/tokeny.
- i18n: všechny uživatelské texty musí jít přes překlady (`react-i18next`), soubory `src/i18n/locales/{cs,en}.json`.
- Testování před změnami: změny musí projít `npm run test:run && npm run build`.

## Docs (Instructions & Guidelines)

### 1) Absolutní pravidla (security & compliance)

- Žádné sensitive data v logách ani v chybových hláškách. Žádné `console.*` mimo `safeLogger` (a i ten je dev-only).
- „RPC-only“ pro sensitive-data: žádné přímé dotazy na restricted tables přes `supabase.from(...)` / `phiClient.from(...)`. sensitive data číst/zapisovat přes `supabase.rpc(...)` funkce s auditem (`*_audited`).
- Žádné `.select("*")`. Vždy explicitně vyjmenovat sloupce (a ideálně vracet přes RPC typované projekce).
- Nezobrazovat syrové backend error message uživateli. Použít mapování typu `getUserFacingDataErrorMessage` (`src/lib/security/userFacingErrors.ts`) + i18n.
- Neukládat auth tokeny do `localStorage`. Session persistence musí být bezpečná; sensitive data session nikdy neperzistovat.

### 2) Data access standard (konzistence + audit)

Preferovaný vzor je:

- UI komponenty nevolají Supabase přímo.
- Všechny síťové operace jsou soustředěné v hookách (`src/hooks/*`) nebo integračních modulech (`src/integrations/*`).
- Pro sensitive-data:
  - čtení/zápis přes `supabase.rpc("..._audited", { ... })`
  - pro „write“ operace preferovat RPC, které zároveň provede authorization check a audit zápis
- Pro ne-sensitive-data/public data:
  - může být RPC nebo (pokud je to opravdu veřejné a bezpečné) `.from(...)`, ale stále platí „explicitní sloupce“ a žádné obcházení RLS
- Pro Edge Functions:
  - používat centrální wrapper `invokeEdgeFunction` (`src/integrations/api/edge.ts`)
  - validovat odpověď přes `zod` schéma a logovat jen přes `safeLogger` (bez citlivých dat)

### 3) Error handling a UX

- Veškeré chyby logovat přes `safeError("context.key", err)`; context klíče držet stabilní (auditovatelné).
- Uživatelský toast/dialog text vždy přes i18n.
- Při selhání data fetch:
  - vracet bezpečné fallbacky (prázdné seznamy) jen tam, kde to nezkresluje bezpečnostní stav
  - jinak fail-fast a řízeně zobrazit UI stav (error state)
- Nikdy neukazovat `error.message` přímo, pokud může obsahovat identifikátory nebo sensitive-data.

### 4) i18n pravidla (homogenita UI)

- Žádné hardcoded stringy v komponentách (tlačítka, hlášky, labely, dialogy).
- Vše přes `const { t } = useTranslation()` a klíče typu `common.save`, `errors.genericError`, apod.
- Každá nová větev UI textu = doplnit `cs.json` i `en.json`.

### 5) React/TS konvence (čitelnost a údržba)

- TypeScript: žádné `any` mimo testy; preferovat přesné typy z `src/integrations/supabase/types.ts`.
- Komponenty:
  - „container vs presentational“: data/side effects do hooků, komponenty primárně render
  - nepřidávat zbytečné lokální stavy, pokud jde odvodit z query/mutation stavu
- React Query:
  - konzistentní `queryKey` struktura (`['domain', userId, filters...]`)
  - invalidace cíleně (`invalidateQueries({ queryKey: [...] })`)
  - žádné „silent“ refetch loops; `enabled` flagy pro podmíněné query

### 6) UI systém

- Používat existující `src/components/ui/*` (shadcn-style) komponenty; nevytvářet duplikáty.
- Stylovat přes Tailwind utility; globální CSS minimalizovat (primárně `src/index.css`, `src/App.css`).

### 7) Supabase typy a generované soubory

- Respektovat soubory označené jako generated (např. `src/integrations/supabase/client.ts` uvádí „do not edit directly“).
- Změny kontraktů dělat přes DB migrace + regeneraci typů (pokud je v projektu standardizovaný postup).

### 8) Testování a „definition of done“

Každá změna musí:

- projít `npm run test:run`
- projít `npm run build`
- neporušit: RPC-only (sensitive data), žádné `.select("*")`, žádné sensitive data v logách, i18n pro UI texty

### 9) Review AI změn (automatické commity)

- Vyhnout se „Changes“ commitům bez popisu; požadovat popisné názvy a auditovatelný rozsah.
- Při AI změnách vždy kontrolovat:
  - neobjevila se přímá `.from()` cesta k sensitive-data
  - nepřibyly hardcoded stringy mimo i18n
  - nepřibyly `console.*` logy nebo zobrazení `error.message`
  - nepřibyly `.select("*")` nebo neexplicitní selecty
  - nezhoršila se konzistence query keys, typů a hranic vrstev (UI vs hooks vs integrations)

