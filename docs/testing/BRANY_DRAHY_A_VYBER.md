# Brány: dráhy, výběr dotčených a co z toho plyne

> Naměřeno 2026-08-31 / 2026-09-01 na forku `<fork>`.
> Všechna čísla v tomhle dokumentu jsou z běhů, ne z odhadů.

## Proč to vzniklo

Sada bran měla 630 souborů a pouštěla se vždy celá. Pre-push hook s ní běžel
20–35 minut a byl jedinou existující kontrolou — Forgejo Actions je na tomhle
repu vypnuté (`enable_actions=false`), takže serverové CI se nikdy nespouští.
Stavění a nasazování dělá Coolify, testy na serveru neběží.

Ekonomika té smyčky tlačí k částečnému ověřování („pustím jen tu jednu bránu"),
a to selhává tiše.

## Co měření ukázalo

Per-soubor se sada do 2026-08-31 nikdy neměřila — existoval jen agregát.

| veličina | hodnota |
|---|---|
| souborů | 630 |
| **medián souboru** | **20 ms** |
| součet trvání | 333 s CPU |
| wall při 8 workerech | 77 s |
| devět nejdražších souborů | **114 s = 50 % celku** |

**Sada tedy nebyla pomalá, byla nerovnoměrná.**

Nejdražší soubor (60,1 s = 15 % celku) přitom nepracoval — **čekal**. Fixtura
mířila na nepřeložitelný host a vyčerpala retry politiku volaného skriptu
(`--retry 6 --retry-delay 10` = přesně 60 s). Rozhodnutí, které brána měří, je
na stdout v 0,52 s; zbytek bylo dojíždění. Test přitom PROCHÁZEL — zelená brána
tiše platící minutu za nic.

Po zkrácení jeho timeoutu klesl součet o 162 s, tedy **třikrát víc, než ten
soubor ušetřil sám**. Zbytek byla odlehčená kontence u bran, kterých se nikdo
nedotkl (`cold-start-doctor` 28,6 → 18,4 s). Náklad sady je superlineární
v zátěži, ne součet nezávislých položek.

## Dráhy

`src/tests/gates/lanes.json` dělí sadu na dvě dráhy; přepíná se
`AISHA_GATES_LANE` (uzavřený výčet `light` | `heavy` | jinak `all`).

| dráha | souborů | wall | workerů | timeout |
|---|---|---|---|---|
| light | 627 | 53 s | 8 | 60 s |
| heavy | 11 | 37 s | 3 | 300 s |
| all (bez proměnné) | 638 | 77 s | 8 | 300 s |

```bash
npm run test:gates          # obě dráhy, verdikt sečtený
npm run test:gates:light    # jen lehká
npm run test:gates:heavy    # jen těžká
npm run test:gates:dotcene  # jen brány dotčené změnou (viz níž)
npm run test:gates -- <soubor>   # jeden soubor (od 2026-08-31 to FILTRUJE)
```

### Co dráhy přinášejí

1. **Poctivý timeout.** 300 s je kalibrovaných na nejhorší případ pod kontencí;
   vyprchání pak hlásí PRÁZDNÝ nález a vypadá jako rozbitý detektor, ne jako
   pomalý test. V lehké dráze je 60 s, takže vyprchání zase něco znamená.
2. **Úspora CPU.** light + heavy = 252 s proti 333 s společně — samo rozdělení
   ušetří 81 s odlehčením kontence.

### Co dráhy NEPŘINÁŠEJÍ

Rychlou synchronní dráhu. Obě dráhy po sobě trvají **164 s**, tedy víc než
77 s celé sady najednou. Strop lehké dráhy neurčuje práce v branách, ale
**počet souborů**:

| souborů | wall |
|---|---|
| 20 | 8 s |
| 60 | 15 s |
| 150 | 46 s |
| 627 | 53 s |

Nasycení nastává kolem 150 souborů. Snížení prahu z 5 s na 1 s vyloučí
52 souborů (81 % CPU) a wall klesne jen z 53 na 40 s.

**Rychlou dráhu tedy dělá VÝBĚR, ne rozdělení.**

### Práh je změřený, ne zvolený

Čísla v manifestu pocházejí z definovaného běhu (8 workerů,
`AISHA_SKIP_ONLINE=1`, `--reporter=json`). Kdo seznam mění, ať přiloží měření.

⛔ **Čas z klidného běhu je DOLNÍ odhad, ne hodnota.** Naměřeno 2026-09-01: dvě
brány vyšly na nezatíženém stroji na 14 s a 11 s, pod pre-push zátěží na 42,6 s
a >30 s — trojnásobek. U brány s podprocesem počítej s trojnásobkem; má-li být
v lehké dráze, musí se do jejího limitu vejít i ten trojnásobek.

## Výběr dotčených

`scripts/test/brany-dotcene.mjs` rozhoduje CO pustit,
`brany-dotcene-spust.mjs` to spouští. Mapa kategorií je v `lanes.json`.

```
změna jednoho compose souboru → 7 bran místo 627 → 8 s místo 53 s
```

### Fail-closed je základ, ne výjimka

Cestu, kterou mapa nezná, NELZE mlčky prohlásit za nedotčenou. Táž třída mapy
se v `.forgejo/workflows/ci.yml` zdokumentovaně spletla **třikrát** (chyběly
`apps/`, `docker-compose*.yml` + `config/`, `packages/`) a pokaždé to znamenalo,
že „zelená znamenala NEMĚŘENO". Neznámá cesta proto padá na celou lehkou dráhu.

`package.json` a `vitest.gates.config.ts` do mapy SCHVÁLNĚ nepatří: změna
testovací konfigurace se dotýká všeho, takže fail-closed je u nich správná
odpověď, ne mezera.

### Co výběr NETVRDÍ

Úplnost. Tvrzení „žádná brána mimo kategorii X nečte compose" je pro 501
textových bran staticky nedokazatelné a pokus by byl jen další špatný regex.
**Úplnost zaručuje plný běh, ne mapa.**

Mapu hlídá orákulum `vyber-bran-je-fail-closed.gate.test.ts`, které selektor
SPOUŠTÍ nad syntetickými commity v dočasném repu. Ověřuje tři vlastnosti:
zužuje · fail-closed platí · vzory ve stromu na něco sedí.

## Zásady, které dnešek doložil

### 1. Přeskočeno není prošlo

Souhrn hlásil jen počty; soubor, jehož brány se celé přeskočily (chybí jq,
docker, DB, online), se nedal odlišit od souboru, který skutečně něco ověřil.
`gates-test-report.json` nyní nese jmenný seznam `skippedFiles`.

### 2. Neúplné měření není nález

Orákulum `compose-alias-oracle.sh` staví tabulku aliasů z toho, co se podařilo
vyrenderovat, a poctivě vydává `souboru_nezmereno`. Brána
`jmeno-na-sdilene-siti-nese-identitu` to číslo dostávala a **nepoužívala** —
hlídala jen dolní mez (`souboru_mereno > 25`), tedy případ „nezměřilo se nic".

Případ „některé chybí" ošetřený nebyl, a právě ten vyrábí nález z chybějících
dat: nevyrenderovaný soubor znamená chybějící `aliases:`, takže odkaz na jeho
službu vypadá jako osiřelý. Naměřeno 2026-09-01: `osirele_odkazy: 2` v plné
sadě, zatímco samostatně i sériově brána procházela (3+3+3 běhy).

**Nula je nápadná, neúplnost vypadá jako výsledek.** 32 z 33 souborů je skoro
všechno — a stačí to k obvinění nevinné služby.

### 3. Verdikt se čte z artefaktu, ne ze stdout

`run-vitest.mjs` má stráž ticha (180 s) s pravidlem „ticho není nikdy zelená"
a report bere jen tehdy, je-li novější než start běhu. Report nese i **verzi
Node** — naměřeno 2026-08-31, že zastaralý PATH s Node 10 zabil sadu s kódem 7
a NULOVÝM výstupem, a prázdný seznam selhání se dá přečíst jako zelená.

Podlaha verze je proto dvouvrstvá: `scripts/check-node.cjs` (schválně ES5) z
hooků, protože `run-vitest.mjs` sám používá `??` a pod Node 10 umře na syntaxi
dřív, než by cokoli zkontroloval.

### 4. Pozicní argumenty se protínají, nesjednocují

`npm run test:gates -- <soubor>` dosud NEFILTROVAL: adresář z `package.json`
i uživatelův argument byly pozicní vzory a vitest je bere jako sjednocení.
Dokázáno přes `vitest list`: **1 soubor samostatně vs. 628** při zápisu z npm
skriptu. Nově `--default-dir`; cesta mimo něj je hlasitá chyba (kód 2).

### 5. Brány se mohou navzájem rušit

Dvě správně napsané brány, obě samostatně zelené, selhávaly v souběhu:
`local-warmup-idempotence` psala pracovní soubory do `.tmp/` UVNITŘ repa a
uklízela je AŽ PO doběhnutí, kdežto `instance-identity-natvrdo` mezitím měřila
strom a nahlásila 16 falešných nálezů „realm vepsaný natvrdo".

Opravena strana, která dělá nepořádek (pracovní adresář mimo repo). Vyjmout
`.tmp/` z auditu by bylo kratší, ale audit `.gitignore` NECTÍ záměrně
(`.env.coolify` je ignorovaný a právě tam by identita škodila) — výjimka by
vyrobila slepou skvrnu v měřidle kvůli cizímu testu.

### 6. Rozdělení mění i to, co běží SPOLU

Vedlejší účinek drah, který se snadno přehlédne: v těžké dráze je **8
dockerových bran z 11** a se 3 workery si tři konkurují o Docker démona — což
bylo mezi 630 soubory vzácné. Sériový běh byl proto změřen (3×): je stejně
zelený jako paralelní a **3,5× dražší** (333–388 s proti 94–151 s). Sériovost
tedy není oprava, jen cena.

## Tři stavy běhu: zelená, červená, NEZMĚŘENO

> Naměřeno 2026-09-20 na úloze CI „Web: Tests" (4 647 řádků logu, 30 minut běhu).

Běh testů uměl do 2026-09-20 jen dva konce, a tím se do červené slévaly dvě
nesouvisející věci: **brána, která spadla** (opravuje se v kódu), a **běh, po
kterém nezbyl žádný důkaz** (opakuje se). Hlídač v `run-vitest.mjs` navíc
rozhodoval podle *uplynulého času bez výstupu*: po 180 s ticha běh zabil a když
nenašel report, uzavřel ho jako FAIL.

Obojí je vada měřidla:

| dosud | proč to nesedí |
|---|---|
| ticho 180 s = zamrznutí | nejdelší ticho v celém třicetiminutovém běhu bylo **55 s** a nikdy nepřesáhlo 60 s — práh nechytal pomalé brány, ale běhy bez postupu |
| stroj mezitím spal | zastavený proces vypadá po probuzení jako 2 h ticha; hlídač zabil zdravý běh |
| chybí report → FAIL | „nevím, jak dopadly" se hlásilo jako „spadly" |

Nově:

* **Postup, ne ticho.** Důkazem o životě je bajt na stdout/stderr **nebo** pohyb
  artefaktu běhu — `gates-test-progress.json` (tep, píše reportér nejvýš jednou
  za 2 s) a `gates-test-report.json` (závěr). Běh, který mlčí a přitom počítá,
  se nezabíjí.
* **Skok v čase se nezapočítá.** Rozdíl mezi dvěma tiky hlídače je měřitelný
  důkaz, že stál čas *nám*, ne běh; po probuzení se okno počítá znovu.
* **Verdikt z důkazu.** Pořadí zdrojů: report z tohoto běhu → závěrečný souhrn
  na obrazovce → **NEZMĚŘENO**.

| kód | význam | co s tím |
|---|---|---|
| `0` | změřeno, zelené | jde dál |
| `1` | změřeno, padlé | oprav bránu |
| `75` | **NEZMĚŘENO** — po běhu nezbyl důkaz | **zopakuj běh**; když se opakuje, hledej zamrznutí (osiřelí workeři, plný disk), ne vadu v kódu |

Kód 75 je `EX_TEMPFAIL` ze `sysexits.h`. Není zelený — přes NEZMĚŘENO se push ani
release neprotlačí. Je ale *odlišitelný*, takže:

* `brany-obe-drahy.mjs` nesečte nezměřenou dráhu jako „0 testů, 0 selhání"
  (prázdno není nula) a vrátí 75 místo plošné jedničky;
* `stack-smoke.mjs` pozná nezměřený běh z návratového kódu i tam, kde krok běží
  se `stdio: 'inherit'` a detektor nad výpisem je slepý;
* CI opakuje **jen** nezměřený běh a OOM — padlá brána padá hned, bez druhých
  patnácti minut.

Že se zamrznutí pořád **pozná**, hlídá negativní sonda:
`scripts/test/run-vitest-verdikt.test.mjs` pouští wrapper nad náhradním během
(`__sondy__/sonda-behu.mjs`), který doopravdy zamrzne, mlčí-ale-postupuje, nebo
skončí nulou bez jediného měření. Bez té sondy by se změna dala zkazit tím
nejhorším možným směrem: hlídač přestane zamrznutí poznávat a všechno je zelené.

## Kde co je

| soubor | role |
|---|---|
| `src/tests/gates/lanes.json` | manifest drah + mapa kategorií, s naměřenými časy |
| `src/tests/gates/drahy-bran-manifest.gate.test.ts` | hlídá manifest (existence, měření, ratchet, rozklad drah) |
| `src/tests/gates/vyber-bran-je-fail-closed.gate.test.ts` | orákulum výběru (spouští selektor nad syntetickými commity) |
| `scripts/test/brany-dotcene.mjs` | rozhoduje, co je dotčené |
| `scripts/test/brany-dotcene-spust.mjs` | spouští výběr, nebo poctivě celou dráhu |
| `scripts/test/brany-obe-drahy.mjs` | obě dráhy + sečtený verdikt (NEzkratuje) |
| `scripts/test/run-vitest.mjs` | běhoun: podlaha Node, průnik argumentů, stráže |
| `scripts/test/verdikt-kody.mjs` | tři stavy běhu (0 / 1 / 75 NEZMĚŘENO) na jednom místě |
| `scripts/test/run-vitest-verdikt.test.mjs` | sondy hlídače postupu, včetně povinné negativní |
| `src/tests/gates/gates-json-reporter.ts` | závěrečný report + tep běhu (`gates-test-progress.json`) |

## Poznámka k pořadí zjištění

Devět z jedenácti vad, které tahle práce odhalila, se **neprojevilo jako
červená** — projevilo se to tím, že dvě tvrzení o téže věci nesouhlasila:
brána procházela a trvala minutu; souhrn hlásil 72 testů a běh skončil chybou;
32 z 33 souborů změřeno a závěr jako by byla data úplná.

Nejužitečnější otázka proto nezní „funguje to?", ale **„co přesně tohle číslo
měří?"**
