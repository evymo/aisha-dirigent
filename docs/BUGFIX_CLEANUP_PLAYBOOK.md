# BUGFIX / DOČIŠTĚNÍ – Minimalistický playbook (produkce, sensitive-data)

Tento dokument je **kontext a pracovní protokol** pro postupné „dočištění“ aplikace formou **pouze bugfixů** s **minimálním (ideálně nulovým) dopadem** na okolní aplikaci.

Platí pro celý repozitář a doplňuje / zpřesňuje:
- [AGENTS.md](../AGENTS.md)
- [.github/copilot-instructions.md](../.github/copilot-instructions.md)
- [docs/security/SECURITY.md](security/SECURITY.md) a další bezpečnostní dokumenty v `docs/security/`

## Základní zásady (NEPORUŠIT)

- **Pouze bug fixy**: žádné „refactory“, žádné vylepšování architektury, žádné nové UX, žádné přepisování stylů, žádné přejmenovávání bez nutnosti.
- **Minimalistické změny**:
  - preferuj 1–3 lokální změny místo větších zásahů,
  - zachovej existující veřejná API komponent / hooků / utilit,
  - žádné „sweeping changes“ napříč repo.
- **Hierarchická kontrola jen směrem dolů**:
  - ověřuj dopady pouze na **podřízené** části (child komponenty, volané hooky, volané utility, integrační klienty),
  - neprováděj plošný audit „nahoru“ (routy, rodičovské layouty) – **pokud to není přímo součást opravovaného flow**.
- **Produkční production + sensitive-data**:
  - nikdy neloguj sensitive data (ani do konzole, ani do toastů, ani do error message),
  - žádné obcházení RLS / oprávnění „jen na FE“.
- **Vždy test na konci**: minimálně `npm run test:run` + `npm run build`.

## Definice „flow“ pro naši práci

„Flow“ = nejmenší uživatelský tok, který bug přímo ovlivňuje (např. „Partner Dashboard načítání dat“, „uložení formuláře“, „zobrazení seznamu objednávek“).

**Dopadové hranice**:
- Bugfix se může dotknout jen toho flow a jeho **downstream závislostí**.
- Pokud se ukáže, že oprava vyžaduje zásah mimo hranici (větší refaktor / změnu API / nový UI prvek), práce se **zastaví** a sepíše se návrh (krátká poznámka do issue/PR) – bez implementace velké změny.

## Standardní postup pro každý bug (checklist)

### 1) Rekonstrukce a důkaz bugu
- Sepsat 2–5 kroků reprodukce.
- Jasně určit očekávané vs. skutečné chování.
- Najít nejbližší konkrétní místo v kódu (soubor + funkce/komponenta/hook).

### 2) Určení nejmenší možné opravy
- Zvolit variantu s **nejmenším** dopadem:
  - oprava podmínky, edge-case, null-handling,
  - doplnění validace (Zod / typy) pouze tam, kde to bug vyžaduje,
  - oprava dotazu na Supabase (minimální select, správný filtr).
- Zakázáno: „přepíšeme to celé, ať je to čisté“.

### 3) Downstream kontrola (jen dolů)

Po změně v X ověř:
- **X → child komponenty**: props kontrakty, default hodnoty, render stavy.
- **X → hooky**: návratové typy, error/loading stavy, side effects.
- **X → utils/lib**: očekávané vstupy, výstupy, chování na null/undefined.
- **X → integrace (Supabase/HTTP)**: parametrizace, minimal data, žádné logování citlivých dat.

Prakticky:
- změna v `src/pages/...` → ověř `src/components/...` a `src/hooks/...` které stránka volá,
- změna v `src/hooks/...` → ověř volané `src/lib/...` a integrace, případně child helpery,
- změna v `src/lib/...` → ověř pouze její interní helpery; volající komponenty **jen pokud je to součást flow**.

### 4) Testovací povinnost
- Přidej/aktualizuj test jen pokud:
  - bug nemá pokrytí a lze ho pokrýt lokálně bez velkých přestaveb,
  - nebo existující test selhává kvůli reálnému bugu.
- Preferuj:
  - unit test pro utilitu/hook,
  - integrační test pro konkrétní dotaz/flow (mock Supabase),
  - security test pokud se dotýká auth/RLS/sensitive-data.

### 5) Spuštění testů (vždy na konci každého bugu)
- `npm run test:run`
- `npm run build`

Poznámka: Pokud fix mění pouze testy nebo čistě typy, testy se stejně spouští.

## Bezpečnostní guardrails (sensitive-data, auth, RLS)

- **Nelogovat**:
  - emaily, jména, adresy, citlivá data, tokeny, session, interní IDs (pokud to může být citlivé).
- **Chybové hlášky**:
  - uživateli jen obecně („Něco se nepovedlo…“),
  - detail chyby jen interně (telemetrie pokud existuje) – bez sensitive-data.
- **Supabase**:
  - žádný raw SQL s uživatelským vstupem,
  - minimal select (ne `*`),
  - spoléhat na RLS (UI je jen UX),
  - žádné `SECURITY DEFINER` obcházení.

## Jak poznat „zakázanou větší změnu“

Stop signál (neimplementovat bez explicitního schválení):
- změna veřejného API sdílené komponenty/hooku, která vyžaduje úpravy na mnoha místech,
- zavedení nového UI flow nebo nové obrazovky,
- přepsání state managementu / query vrstvy,
- rozsáhlé přeuspořádání složek, přejmenování, hromadné formátování.

Místo toho:
- napiš stručný návrh (1 odstavec) do PR/issue: co a proč je potřeba, rizika, odhad dopadu.

## Šablona „Bugfix záznam“ (doporučeno do PR popisu)

- **Bug**: (1 věta)
- **Reprodukce**: (kroky)
- **Root cause**: (1–2 věty)
- **Fix**: (1–3 body, minimalisticky)
- **Downstream ověření**: (co bylo zkontrolováno směrem dolů)
- **Testy**: `npm run test:run`, `npm run build` (+ případné nové testy)

## Praktická poznámka k práci v této fázi

Budeme postupovat iterativně: **1 bug = 1 malý fix + ověření downstream + testy**. Nic víc.
