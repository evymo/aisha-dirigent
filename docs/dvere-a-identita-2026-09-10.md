# Dveře a identita: co se uzavřelo, co je otevřené

**Datum:** 2026-09-10 · **Navazuje na:** `dvere-flow-2026-08-20.md`, `dvere-stav-a-navrh-2026-08-19.md`

Každé tvrzení níž má u sebe, čím je změřené. Kde měřeno nebylo, je to řečeno.

Dva starší dokumenty zůstávají beze změny — jsou to **datované snímky** a byly
tehdy pravdivé. Tenhle je nahrazuje jako popis stavu, ne jako opravu jejich
historie.

---

## 1. Zadání majitele (2026-09-09 a 09-10, jeho slovy)

> „Aplikace nezjistí, jestli je schválená, jinak než tím, že po zaklepání stále
> nemá přístup k endpointům — a pak má smysl nabídnout uživateli ruční
> zaklepání platným kódem."

> „Posílat otisk správci je hovadina, ten se má stát součástí zaklepání
> a administrátor ho dostane a může ho schválit, aniž by mu uživatel aplikace
> musel něco posílat."

> „Pokud uživatel na začátku zaklepe ručně a pak se přihlásí, tak máme tím
> pádem spojenou informaci o tom, na koho je vázán tablet. […] Zároveň pak víme,
> jaký uživatel používá jaká zařízení."

> „Pozvánka je propojení **budoucí identity** s entitou v systému." — a k tomu:
> „Přijetí pozvánky a přihlášení — autorizace uživatele je další krok, ale už
> schválený, resp. **předpřipravený tím, kdo tu pozvánku posílá**."

> „Je to zásadní moment, protože jim pouštíme lidi k informacím."

---

## 2. Co se od 08-20 uzavřelo

Tabulka z `dvere-flow-2026-08-20.md`, přeměřená.

| tvrzení | čím změřeno | tehdy | dnes |
|---|---|---|---|
| někdo `knockOnce` volá | `git grep` v `mobile-app/src` | ⛔ 0 volajících | ✅ `obsluhaDveri` → `kroky.tsx`, `naturel-calibration.tsx` |
| je kam pověření uložit | `knock-native.ts` | ⛔ slot neexistuje | ✅ Keychain/Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` |
| pověření **VER 2** jde vyrobit | `knock-roster.mjs` | ⚠️ jen `--device` = VER 1 | ✅ `--pubkey` (viz §3) |
| zařízení má vlastní průkaz | `verify.ts` | ⛔ HMAC z lidského hesla | ✅ P-256, klíč neopustí telefon |

⚠️ **`--device` v `dvere-flow` bylo označené ✅ chybně.** Vyrábí VER 1, tedy
symetrické tajemství, které `operatorDefects` u VER 2 výslovně zakazuje
(*„zařízení NESMÍ mít hmacKeyHex"*). Pro VER 2 neexistovala cesta vůbec —
schopnost byla na obou stranách a mezi nimi nic.

---

## 3. Jak se dnes zařízení dostane do rosteru

```
telefon: vyrobí P-256 pár, soukromá půlka NEODEJDE
   ↓ otisk (kid = dev-<16 hex z klíče>, odvozený, ne vymyšlený)
knock-roster.mjs --pubkey <hex> --owned-by <kdo> --scope <co>
   ↓ ověří TÝMŽ operatorDefects, jakým se řídí start služby
SPA_OPERATORS_B64 → svc-knock
```

**Ověřeno na zařízení** (Samsung SM-X115, 2026-09-09): klíč je 65 B, začíná
`04`, je to skutečný bod na P-256 (Node ho přijal jako `prime256v1`), odvození
`kid` na telefonu se shoduje s odvozením v Node a generátor rosteru záznam
přijal bez vad.

⛔ **`kid` se nevymýšlí.** U zařízení plyne z klíče; u appky **ze `slug`**
overlaye (`<fork>-ridic`). Dvě jména jedné věci se rozejdou a projeví se to jako
`unknown-kid` — tedy MLČENÍM, nerozeznatelně od zavřených dveří.

⛔ **`scope` patří k PRŮKAZU, ne k sestavení.** Ověřovatel ho porovnává
s rosterem a `scope-denied` se ven nehlásí. Kdyby se bral z konfigurace, změnila
by ho aktualizace appky pod schváleným zařízením a to by přestalo fungovat
způsobem k nerozeznání od zavřených dveří. Ukládá se při zavedení a je vidět
v otisku, aby ho správce zapsal shodně.

---

## 4. Řetěz identity: od osoby k tomu, co vidí

Rozhodovač viditelnosti je jeden (`workflow_step_visible_to`, ~20 konzumentů,
vymáháno bránou „single decider"). Bere tři věci: **přiřazení**, **roli**
a **potvrzenou vazbu účtu**.

```
ingest        → osoba existuje            twin + primary_id vazby
pozvánka      → propojení budoucí identity s entitou
uplatnění     → kandidát („tenhle účet přišel s tím kódem")
potvrzení     → fakt
   ↓
my_twins → krok je můj ⟺ input_data.authorized_twin_id ∈ my_twins
```

Bez potvrzené vazby je `my_twins` prázdné a člověk **nevidí nic**.

### Kdo vazbu zapisuje

| zapisovatel | co zapíše | kdo to smí |
|---|---|---|
| `twin_upsert_entity_audited` | `primary_id` z importu | ingest |
| `twin_identity_propose_binding` | `proposed` | admin/staff nebo service_role |
| `twin_identity_confirm_binding` | `confirmed` | admin/staff |
| `twin_identity_reject_binding` | `rejected` | admin/staff |
| `claim_invitation` | `confirmed` **nebo** `proposed` — viz §5 | uplatňující |

⭐ Vazbu **navrhuje ingest**, potvrzuje člověk v review lane
(`get_twin_ref_review_block`, blok `wb_twin_unmatched` posazený na povrch
`workbench`). Vazba účtu není jiný druh vazby než ostatní — proto pro ni
**nevznikla zvláštní RPC**; jedna napsaná byla zrušena jako druhé dveře.

---

## 5. Pozvánka: proč dvě větve

Autorizaci **předpřipravil odesílatel**. Otázka při uplatnění tedy není „smí ten
člověk dovnitř?", ale **„je to on?"**.

| pozvánka | podmínka | výsledek |
|---|---|---|
| adresovaná | `email` pozvánky = `email` účtu | `confirmed`, `confirmed_by` = **správce**, který ji vystavil |
| neadresovaná | kód předaný jinak | `proposed` — není koho ověřit, ratifikuje člověk |

Porovnání ignoruje velikost písmen i okolní mezery. **Účet bez profilu vyjde
jako `false`** — chybějící údaj nesmí vyjít jako potvrzení.

---

## 6. Tři vrstvy, které zavírají přístup

Naměřeno 2026-09-10 při revizi. Tři vlastnosti, každá zvlášť únosná, dohromady
dávaly průchod: uplatnění nekontrolovalo adresáta, `max_uses` vznikalo jako
`NULL` (tedy neomezeně), a jeden twin mohl mít víc účtů.

| vrstva | co zavírá |
|---|---|
| pozvánka s `twin_id` je **jednorázová** | neomezený kód, kterým se prokáže kdokoli |
| `uq_twin_external_refs_active_account` | jeden účet = nejvýš jeden aktivní twin |
| `uq_twin_external_refs_active_account_twin` | jeden twin = nejvýš jeden aktivní účet |

⛔ **Proč indexy, a ne jen oprava funkce.** Vazba vzniká pěti cestami (§4)
a přibývají. „Člověk je jeden" je vlastnost DAT — na úrovni tabulky platí i pro
cestu, kterou dnes nikdo nenapsal.

⛔ **Směr selhání určil volbu řešení.** Chybějící přístup uživatel nahlásí do
minuty; **přebývající nenahlásí nikdo**, protože „vidím víc" nevypadá jako
vada. Proto se zavírá u ZÁPISU (vadný zápis neprojde), ne filtrem při čtení, kde
by se navíc tiše ztratila stará data.

⛔ **Pojistky nesmí držet komentář — a chvíli držely.** Do první verze tohohle
dokumentu jsem napsal „kdo bude indexy uklízet, nesmí ty dva užší smazat".
Majitel na to řekl, že v tom vidí díru, a měl pravdu: pravidlo, které stojí na
tom, že si někdo přečte poznámku, není pravidlo. Zavřeno dvěma způsoby.

**1. Nejednoznačnost je odstraněná, ne zakrytá.** U `ref_kind='account'` smí být
jediný `source` (`twin_external_refs_account_source`). Obecně `source`
ROZLIŠUJE — týž klíč ve dvou zdrojích jsou dvě různé věci — ale účet je jeden
bez ohledu na to, kdo o něm píše, a `workflow_step_visible_to` ho proto vůbec
nečte. Dvě vazby na týž účet z různých zdrojů teď nejdou ani vyrobit.

⚠️ CHECK se na živou databázi přidává jako `NOT VALID`, protože existující
řádky odsud ověřit nejde (produkci nevidím, dveře vrátily 403). Vymáhá se na
všech nových a měněných řádcích; historii kryjí indexy. Ověřit ji jde kdykoli:
`ALTER TABLE … VALIDATE CONSTRAINT twin_external_refs_account_source;`

**2. Odstranění pojistek zastaví brána** (`vazba-uctu-ma-pojistky`). Měří, že
oba užší indexy existují, jsou v `heals.sql`, mají **přísný klíč** (samotná
existence souboru nestačí — „úklid" může znamenat i vrácení `source` do klíče),
a že CHECK je na OBOU místech: v `CREATE TABLE` pro čistou databázi i jako
idempotentní `ALTER` pro existující.

⭐ Ty tři indexy nejsou duplicity, jsou to různě silná pravidla:

| index | klíč | platí pro |
|---|---|---|
| `uq_twin_external_refs_active_owner` | `(source, source_key, ref_kind)` | všechny druhy vazeb |
| `uq_twin_external_refs_active_account` | `(source_key)` | jen `account` |
| `uq_twin_external_refs_active_account_twin` | `(twin_id)` | jen `account` |

Méně sloupců v klíči = přísnější podmínka.

---

## 7. Co zbývá

| # | co | čeká na |
|---|---|---|
| 1 | mergnout a nasadit | dojetí CI |
| 2 | regenerace typů → volání `register_knock_device` z appky | nasazení migrace |
| 3 | záznam `<fork>-ridic` v rosteru | člověka (změna přístupu do sítě) |
| 4 | plocha v administraci | rozhodnuto kam: administrace = **nastavení**, extranet = projekce |
| 5 | scope z odpovědnosti za oblast | zapojení, ne rozhodnutí — viz §8 |

Krok 2 se **připomene sám**: brána neměří jeden stav, ale soulad obou stran
a zčervená, jakmile RPC v typech bude a volající ne.

---

## 8. Odpovědnost za oblast

`twin_relations` (temporální, s `twin_relation_open_admin` / `_close_admin`)
a `twin_graph_descendants` existují. **Změřeno: `twin_graph_descendants` má nula
produkčních konzumentů a v repu není ani jedna hodnota `relation_kind`.**

Odpovědnost za oblast není nový druh věci — je to **další napojení**, stejný
úkon jako navázání účtu, jen mezi člověkem a oblastí. Není co vymýšlet, je co
zapojit.

⚠️ Pořadí, ve kterém to zapojit, není lhostejné: rozšíření scope je změna, jejíž
selhání je tiché. Nejdřív odvození, které umí říct **proč** (vrací cestu, ne jen
množinu), pak souběh nanečisto proti dnešnímu predikátu, teprve pak udělování —
a vyhodnocení **jednou za dotaz**, ne per řádek (naměřeno 2026-07-30: per-row
predikát = 41 s a páka na DoS).

---

## 9. Čemu při čtení tohohle dokumentu nevěřit

Při té práci jsem **třikrát tvrdil „tohle chybí" a pokaždé to existovalo**.
Pokaždé proto, že jsem přečetl část cesty a usoudil z ní na celek:

| tvrzení | čím jsem měřil | co jsem minul |
|---|---|---|
| „`stavFronty` nemá konzumenta" | grep s `\| head` | `PruhFronty.tsx` |
| „administrace bloky nekreslí" | jen `src/components/admin` | `web/RuntimeBlockRenderer`, `storyloop/StoryDetail` |
| „ratifikační blok není posazený" | grep, jehož výstup NEBYL prázdný | `49_surface_layouts.sql:73` |

⛔ Závěr „X neexistuje" se smí vyslovit jedině z měření, které nemá omezovač
výpisu, prohledává celý strom, a **jehož výstup si člověk přečetl, ne jen
olabeloval**.
