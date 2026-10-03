# Předání očima řidiče — UX rozbor terénního potvrzování

**Měřeno:** kód `feat/ridic-samostatna-appka @ eb6f967` + běžící build (simulátor) + maketa v2 „Páska dne" · 2026-08-20
**Plná verze s vizuálem:** artifact `6a69a022` (claude.ai/code)

## Měřítko: řidič u rampy, ne uživatel u stolu

Rukavice/mokro · protisvětlo i tma v 5:30 · zákazník čeká vedle · signál je výjimka ·
**telefon se podává cizímu člověku** (podpis) · věk 30–60 · zařízení spíš levný
Android tablet v držáku (na šířku) — platforma je jedno, ŠÍŘKA ne.

## Co už stojí (nebourat)

- páska Hotovo → **TEĎ** (hero, „7. ze 12 dnes") → Přede mnou — `BlockRenderer.tsx:502`
- záchrana práce podle PŘÍČINY selhání (rejected/denied/unreachable) — `kroky.tsx:296`, `zachranaPrace.ts`
- OCR navrhuje, člověk potvrzuje; návrh nikdy nepřepíše ruční hodnotu — `kroky.tsx:118`
- sloty fotek i povaha kroku jsou DATA šablony, ne kód — `kroky.tsx:39,545`
- podpis: lokální kontrola limitu, srozumitelná chyba — `SignaturePad.tsx:47`
- `occurredAt` = čas stisku v terénu, ne synchronizace

## Cesta předání: dnes 5+ interakcí + psaní → návrh 3 ťuknutí + podpis, nula psaní

## Nálezy

### P0 — před řidiče to takhle nesmí
| # | Nález | Důkaz | Návrh |
|---|---|---|---|
| N1 | Podpis = podání telefonu cizímu: 180px pad ve scrollu (tah krade scroll), zákazník vidí pásku s JMÉNY dalších odběratelů a +ASH | SignaturePad.tsx:100, kroky.tsx:534 | celoobrazovkový **Moment podpisu**: jméno + doklad + velká plocha + Hotovo/Znovu, nic interního |
| N2 | Fronta čekajících odeslání NENÍ vidět — „neztratilo se mi to?" nemá odpověď | useOffline.ts má stav, nikdo ho nekreslí | trvalý chip „⏳ 2 čekají" / „✓ odesláno", ťuk = seznam |
| N3 | Jméno přebírajícího se PÍŠE — nejdelší krok úkonu | kroky.tsx:497 | prefill z dat šablony (jako photoSlots); psát jen výjimku |
| N4 | Klávesnice zakryje Potvrdit | kroky.tsx:348 — bez KeyboardAvoidingView | KeyboardAvoidingView + persistTaps |
| N5 | „Odchylka (krok selhal)" natvrdo — PROTI rozhodnutí majitele (odchylka není řídicí parametr řidiče); šablona dv_handover ji vyřadila | kroky.tsx:511 vs 41_surface_blocks.sql | přítomnost přepínače řídit daty šablony; poznámka zůstává vždy |
| N6 | Dotykové cíle pod 44 pt: Foto toggle ≈29, Smazat ≈30, řádky ≈37 | EvidencePhotos.tsx:130, SignaturePad.tsx:143, BlockRenderer.tsx:724 | minHeight 48 na terénní cestě |

### P1 — aby to milovali
| # | Nález | Návrh |
|---|---|---|
| N7 | úspěch není cítit (bez haptiky — expo-haptics chybí; banner 14px nahoře) | haptika + **pečeť na hero**: „✓ Předáno · 8. ze 12 · další: …" |
| N8 | textMuted #6A6A72 na #0E0E10 ≈ 3,6:1 (AA chce 4,5) na 10–12,5px | podlaha 13px; „terénní kontrast" v design-tokens |
| N9 | jazyk systému: „Přihlaste se ke svému backendu", „Moje kroky", „Provoz" | instanční i18n overlay: „Moje dodávky", „Dnešní rozvoz" |
| N10 | ťuk na hotovou fotku ji SMAŽE bez potvrzení (EvidencePhotos.tsx:40) | undo chip „Fotka odebrána · Vrátit" (4 s) |
| N11 | podpisu chybí věta, kterou podepisující stvrzuje | „Podpisem potvrzuji převzetí dodávky {doklad}" + jméno |
| N12 | páska se neobnoví při návratu do popředí | refetch on AppState + po potvrzení |
| N13 | tablet dostane víc místa a stejnou jednosloupcovku (BlockRenderer.tsx:499) | width breakpoint ~700dp: master–detail (páska vlevo, krok vpravo); Android Zpět zavírá formulář, ne appku |

### P2 — evoluce ESDK (po prvním ostrém týdnu, po jednom, s paritou)
- **FieldCta** (JAZYK-07: terénní akce je jedna) — 56pt, plná šířka, haptika
- **QueueChip** (JAZYK-08: o uložené práci se mluví nahlas) — ⏳/✓/🔒, v mission control ukazuje dispečerovi neodeslanou práci řidiče
- **SignatureMoment** (JAZYK-09: podpis je předání obrazovky druhé straně) — web kreslí jen pečeť
- **SealedStep** (JAZYK-10: hotové je zapečetěné — kdo/kdy/✓)

## Metriky oblíbenosti (přes twin_events, od 1. dne)
čas TEĎ→pečeť < 30 s · předání bez úhozu > 90 % · podíl offline dokončení (sledovat) ·
dotazy „ztratilo se mi" = 0 · opakované podpisy < 5 %

## Pořadí realizace
1. balíček „terén": N3+N4+N5+N6 (~1 den)
2. Moment podpisu: N1+N11 (~1–2 dny) — největší viditelný skok
3. důvěra: N2+N7 (~1 den)
4. slovník + kontrast: N9+N8 (~hodiny)
5. ESDK slova P2 podle metrik, po jednom

---

## Stav realizace (2026-08-20)

Všech 13 nálezů je hotových. Co se cestou ukázalo jinak, než rozbor tvrdil, je
zapsané rovnou tady — rozbor je záznam v čase, ne pravda o kódu.

| # | stav | commit | kde |
|---|---|---|---|
| N3 N4 N5 N6 | ✅ | `89d3eeb92` | balíček „terén" |
| N1 N11 | ✅ | `1a16c0728` | `components/MomentPodpisu.tsx` |
| N2 N7 | ✅ | `d8af0a6d0` | `lib/stavFronty.ts`, `components/PruhFronty.tsx`, `lib/odezva.ts` |
| N8 N9 | ✅ | `1da5190d5` | `config/slovnik.ts`, `__tests__/terenniCitelnost.test.ts` |
| N12 N13 | ✅ | `69878874f` | `lib/oziveni.ts`, `lib/sirkaObsahu.ts` |
| N10 | ✅ | `911eb7e60` | vratné okno v `EvidencePhotos` |

### Kde byl rozbor vedle

**N1 — „zákazník vidí pásku s JMÉNY dalších odběratelů" BYLO ŠPATNĚ.** Řidič se
na krok dostane výhradně přes položku pásky (`/kroky?step=<id>`), a tím se
obrazovka zužuje na JEDEN krok (`kroky.tsx`, `all = [focused]`). Cizí zakázky
vidět nebyly nikdy. Platný důvod pro celoobrazovkový moment zůstal jiný, a lepší:
**přebírající musí vědět, co přebírá a co stvrzuje** (zadání majitele) — plus
střet gest u 180px padu ve `ScrollView`.

**N3 — „prefill z dat šablony" NEJDE.** `input_data` kroku `predani` nese
`counterparty`, `delivery_address`, `dl_number`, `driver_name`,
`vehicle_registration` a `reward` — ŽÁDNOU OSOBU. `counterparty` je FIRMA;
dosadit ji do pole „Přebírající (jméno)" by znamenalo napsat do dokladu údaj,
který nikdo neřekl. Místo toho se nabízí **vlastní paměť řidiče**: koho sám
naposledy zapsal u téhle protistrany (`lib/prebirajici.ts`), a to KLEPNUTÍM,
nikdy dosazením (JAZYK-05).

**N13 — master–detail se NEDĚLAL.** Zadání znělo „mělo by to být jedno", tedy ne
druhá tabletová appka. Stačí, aby se obsah neroztahoval: strop 640 dp
(`lib/sirkaObsahu.ts`), žádná podmínka na zařízení. Ověřeno na iPad Pro 13".

### Co našel až pohled na obrazovku

* **Vratné okno 8 s bylo krátké** — vypršelo mezi klepnutím a pořízením snímku.
  Řidič v rukavicích se na displej hned nedívá; smazaný důkaz se znovu pořídit
  nedá ⇒ 20 s (`7b8591942`).
* **„Čeká na odeslání" byl nejslabší prvek obrazovky**, přitom je to pro řidiče
  nejběžnější stav (u rampy bez signálu) ⇒ bílá místo `textSecondary`.
* **Na tabletu se roztahovalo přihlášení** — první obrazovka, kterou člověk vidí.
* **Brána čitelnosti měřila půlku cesty**: vycházela z `kroky.tsx` a sledovala
  jen `components/`. Řidičovu PÁSKU kreslí `extranet/BlockRenderer`, kam
  nedosáhla — po rozšíření tam našla 7 barev pod AA a 10 stupňů pod podlahou
  (`d0ed064d2`).
* **Jediný dotek prošel jako podpis** — `strokesToDataUri` bere každý neprázdný
  tah a klepnutí vyrábí platnou cestu (`0a3418fb1`).

### Co zůstává rozhodnout majiteli

**Vratné okno u ODESLÁNÍ práce.** `services/offline` už umí zdržet položku
(`enqueueMutation(..., { notBefore })`) i ji vrátit (`vratDrzenePredani`) —
včetně čtyř testů. **Nikdo to nevolá**: jediní volající jsou vlastní testy.
Zapojit to znamená rozhodnout, kdy práce opouští zařízení; to je rozhodnutí
o produktu, ne o kódu.
