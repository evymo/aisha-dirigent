# Audience Module — průvodce pro marketéra

> Co to je za nástroj, jak se na něj dívat a co s ním reálně děláš.
> Tohle NENÍ technická dokumentace (ta je v `ops/OPS_RUNBOOK.md`). Tohle je
> mentální model a praktický návod pro člověka z marketingu.

---

## 1. Co to je: čočka nad živou komunitou

Nepřišel ti nový systém, do kterého musíš ručně přepisovat kontakty. **Audience
modul je čočka nad komunitou, která už existuje.** Lidé, jejich aktivita,
vztahy, akce — to všechno žije ve stávajícím stacku. Modul to jen agreguje,
obarví marketingovou optikou a dá ti nástroje, jak s tím pracovat.

Praktický důsledek: **nemáš "prázdnou databázi, kterou musíš naplnit".** Od
první minuty vidíš reálnou komunitu rozčleněnou na tiery, s historií aktivity
a vztahů. Tvoje práce není data zadávat — je je **interpretovat a působit na ně.**

Je to **měřicí přístroj**: pozoruje, co lidé skutečně dělají, a umožní ti
spouštět řízené experimenty s měřitelným dopadem — pracuješ spíš jako
v laboratoři než v adresáři.

---

## 2. Pět vrstev členství (tier funnel)

Každý člověk v komunitě je v jednom z pěti stavů — od anonymního po partnera.
Tier se **počítá automaticky** z jeho reálné aktivity, nezadáváš ho ručně:

| Tier | Kdo to je | Marketingově |
|---|---|---|
| **anonymous** | nepřihlášený návštěvník | vrchol trychtýře, zatím neznámý |
| **registered** | zaregistrovaný, ale neaktivní | "lead" — máš souhlas, čekáš na zapojení |
| **active** | pravidelně se vrací | "engaged" — reaguje, roste vztah |
| **qualified** | certifikovaný / prokázaná hodnota | "MQL/SQL" — kvalifikovaný pro hlubší vztah |
| **partner** | viditelný producent obsahu/akcí | "advocate/partner" — sám tvoří hodnotu |

Tier funnel ti ukáže, **kolik lidí je v každém stavu a jak konvertují** mezi
nimi. To je tvoje hlavní strategická mapa: kde je úzké hrdlo? Kolik
`registered` se za měsíc překlopilo do `active`? Který obsah to urychlí?

> Tier se nedá "zfalšovat" ani rozejít s realitou — protože se počítá za běhu
> z toho, co člověk doopravdy dělá. Žádný ruční override, žádná zastaralá data.

---

## 3. Jak na lidi působíš: tagy, follow-upy, story

Nad každým člověkem ("actor" v žargonu modulu) máš tři nástroje:

- **Tagy** — libovolné štítky (`yoga`, `retreat-2026`, `potential-partner`).
  Můžou vznikat ručně (ty je přidáš) nebo **automaticky** pravidlem: "kdokoli
  navštívil akci → otaguj `attended_event`". Tagy jsou polymorfní — stejný
  systém štítkuje lidi, akce, kampaně.
- **Follow-upy** — naplánovaný úkol ("zavolat Bobovi ohledně partnerství,
  za 3 dny"). Objeví se ti ve frontě "moje úkoly dnes / tento týden / po
  termínu".
- **Story / timeline** — chronologická historie vztahu: co poslal, co otevřel,
  na co reagoval, jaké signály o něm přišly. Žádnou aktivitu nezadáváš ručně,
  skládá se sama z reálných událostí.

To dohromady tvoří **kontext vztahu** — ucelený obraz, který se plní sám
z reality, ne tvým přepisováním.

---

## 4. Kohorty: tady je ten nejsilnější koncept

Tohle je místo, kde modul přestává být "lepší adresář" a stává se nástrojem
marketingové vědy. **Kohorta není seznam lidí. Kohorta je řízený experiment.**

Pod kapotou kohorty využívají stejnou strukturu, jakou používá klinický výzkum
pro studie — a to není náhoda. Klinická studie a poctivý marketingový experiment
jsou **ta samá věc**: definuj populaci → získej souhlas → kontrolovaný zásah →
s rozpočtem → v čase → změř výsledek. Klinika to jen zformalizovala o 70 let
dřív. Marketing to dohání (A/B testy, holdout skupiny, consent management).

Proto kohorta umí mnohem víc než "segment":

| Co kohorta má | Co to pro tebe znamená |
|---|---|
| **qualifying_state** (vstupní podmínka) | Kdo do kohorty patří + kam vztah směřuje. Ne jen "kdo", ale "proč a kam". |
| **is_controlled_experiment** (A/B) | Zapneš → kohorta se rozdělí na varianty (arm). Měříš, která komunikace funguje líp, ne hádáš. |
| **holdout / placebo arm** | Kontrolní skupina vidí "placebo" stejné intenzity → izoluješ **skutečný přírůstkový efekt** od toho, že jsi prostě někoho oslovil. (Tomuhle Google říká "ghost ads".) |
| **permission_version** (souhlas) | Verzovaný marketingový souhlas — bez něj moderní komunikace legálně nesmí běžet (GDPR). Není to byrokracie navíc, je to záznam vůle člověka. |
| **budget_target / committed** (rozpočet) | Pokud je kohorta akce s rozpočtem (event, placená kampaň, fundraising), sleduješ cíl vs. utraceno vs. termín. |
| **is_program + sub-kohorty** | Velká kampaň s pod-kampaněmi (umbrella). Hierarchie programů. |
| **promoted_offers** | Co kohorta propaguje (nabídky, SKU, CTA). |
| **playbook_url** | Brief / scénář kampaně. |

### Co to mění v praxi

Klasický marketér pošle kampaň a podívá se na open rate. **Ty místo toho
spustíš kohortu jako experiment:** část lidí dostane variantu A, část B, část je
v holdout (nedostane nic / placebo). Po skončení vidíš ne "30 % otevřelo", ale
**"varianta B zvýšila konverzi o 4,2 procentního bodu oproti holdoutu" —
kauzální, ne korelační číslo.**

To je rozdíl mezi "myslím, že ta kampaň fungovala" a "vím, že fungovala, a o
kolik".

---

## 5. Kde to celé řídíš: Appsmith intranet

Veškerou práci děláš v **Appsmith** — low-code intranetu, který je tvůj.
Nepotřebuješ vývojáře, abys postavil nový dashboard nebo upravil pohled. Modul
ti dává bohatý "datový substrát" (pohledy + akce); ty si nad ním skládáš UI
přetahováním.

Typické obrazovky, které si postavíš (nebo naimportuješ z šablon):

1. **Contact Directory** — seznam všech lidí s tier odznakem, tagy, posledním
   kontaktem. Filtruješ podle tieru / tagu / kohorty.
2. **Actor Detail** — karta člověka: profil, tier, historie komunikace,
   engagement metriky, tlačítko "AI insight" (zeptáš se AI na konkrétního
   člověka).
3. **Follow-up Queue** — tvoje fronta úkolů (dnes / tento týden / po termínu).
4. **Tier Funnel** — KPI trychtýř + konverze mezi tiery.
5. **Campaign Performance** — výkon kampaní po kanálech, A/B výsledky.
6. **Cohort Manager** — zakládání a správa kohort (vč. experimentů).

> Marketér si tyto obrazovky **upravuje sám**. Chceš nový pohled "ohrožení
> členové" (vysoký tier, ale 30 dní neaktivní)? Postavíš ho v Appsmith jako
> jeden dotaz + tabulku, bez zásahu do kódu. To je celý smysl architektury:
> data jsou bohatá, UI si skládáš podle potřeby.

**Na co vázat v Appsmith (datové zdroje):**

| Co chceš | Dotaz (PostgREST) |
|---|---|
| Seznam kohort (marketingový slovník) | `GET /cohorts` |
| A/B arm + holdout členství | `GET /cohort_arms` |
| Seznam kontaktů s tier/tagy | `GET /audience_admin_contact_directory_v` |
| Tier trychtýř | `GET /audience_admin_tier_funnel_v` |
| Fronta follow-upů | `GET /audience_admin_followup_queue_v` |

> `cohorts` je **kanonický** pohled na kohorty (marketingový dialekt). Existuje
> i `audience_cohort_marketing_v` — je to jen jeho přesná kopie (passthrough)
> pro konzistenci pojmenování; obojí vrací identická data, takže je jedno,
> který použiješ.

---

## 6. Co se děje na pozadí (a proč tě to nemusí trápit)

Aby tahle čočka fungovala, na pozadí běží integrace, která tahá data z komunity,
agreguje je a ukládá. Ty to nevidíš a vidět nemusíš — ale dvě věci stojí za
zmínku, protože ti vysvětlí, proč je nástroj **spolehlivý**:

- **Nikdy nepíše nesmysly.** Integrace má "pojistku švu" (drift canary): když se
  zdrojový systém změní tak, že by data přestala dávat smysl, modul **raději
  přestane synchronizovat, než aby přepsal dobrá data nulami.** Radši chybí
  čerstvé číslo, než aby ti dashboard tiše lhal.
- **Souhlas je první třída.** `permission_version` u kohorty není kolonka navíc
  — je to záruka, že komunikuješ jen s lidmi, kteří ti to dovolili, a že máš
  o tom verzovaný záznam. To tě chrání právně i reputačně.

---

## 7. Shrnutí: co ti modul dává

Co ti modul dává:

- **Čočka nad živou komunitou** — data se skládají z reality, nezadáváš je ručně
- **Kohorty jako řízené experimenty** — ne statické seznamy; měříš kauzální lift
  (např. „varianta B: +4,2 p.b.")
- **Souhlas jako verzovaný záznam vůle** — ne pouhý checkbox
- **Dashboardy si skládáš sám v Appsmith** — bez vývojářského ticketu
- **Měříš, co tvůj zásah způsobil** — ne jen co se stalo

**Jedna věta:** je to přístroj na **měření a kauzální ovlivňování vztahu
s komunitou**, postavený nad daty, která už máš.

---

## Kam dál

- Praktické nastavení a provoz: `ops/OPS_RUNBOOK.md`
- Architektura a datový tok: `ARCHITECTURE.md`
- Krok-za-krokem scénář marketéra: `MARKETER_FLOW_WALKTHROUGH.md`
- Proč tier model vypadá takhle: `UNIVERSAL_MEMBER_MODEL.md`
- Import Appsmith šablon: `../../appsmith-templates/audience/DEPLOY.md`
