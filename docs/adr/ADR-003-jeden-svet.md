# ADR-003: Jeden svět — dvojče je entita, story je kontext; jádro zná druhy, ne jména

> **Status:** Accepted
> **Datum:** 2026-09-05
> **Kontext:** `docs/architecture/ONE_WORLD_MODEL.md` (model), `EXTRANET-AUDIENCE-ZADANI-2026-09-05.md`
> rev. 2 (první instanciace, <fork>), `TWIN_PULSE_MODEL.md`, `UNIVERSAL_MEMBER_MODEL.md`, ADR-002.

## Rozhodnutí

1. **Dvojče je entita a její identita.** Každý reálný subjekt (člověk, organizace, místo, stroj,
   dokument, šarže) má právě jednu entitu (`twin_entities`) s referencemi na cizí identity;
   zdroje reference **navrhují**, člověk **potvrzuje**. Účet je jedna potvrzená reference
   (`ref_kind='account'`), ne identita sama.
2. **Story je projekce a kontext entity.** Nese účastníky s rolemi, značky, cíl, naraci,
   hodnocení a hranici práv. Entita má hlavní story a účastní se cizích. Všechno ostatní
   (běhy, dokumenty, události, nudge, osa pohledu) visí na `story_id`.
3. **Jádro zná druhy věcí, nikdy jména věcí.** Druhy entit, vazeb, záznamů, rolí, šablon a sekcí
   jsou data instance (overlay). Jméno věci v jádru je dluh k překladu, ne struktura.
4. **Svět roste jen návrhem a potvrzením.** Vstupy (ingest, zdroje), práce člověka (potvrzení,
   kroky) a události (kadence, signály) vyrábějí návrhy; fakt vzniká potvrzením. Stroj
   navrhuje, nepotvrzuje.
5. **Práce = běh ze šablony.** Úkol, follow-up, onboarding, care cyklus, kampaň, expedice jsou
   běhy z pravidel-jako-data; aktivní uzel otevírá takt, potvrzení kroku ho uzavírá. Jediná
   zápisová cesta práce na ploše zůstává `submit_evidence_review_audited('workflow_step')`.

## Co to řeší

- Dvě „dvojčata" vedle sebe (story per aktér v audience doktríně 07/2026 vs. vrstva identity
  z RIQ větve) bez zapsaného vztahu.
- Audience modul klíčovaný na účet, který neumí vyjádřit kolegu bez účtu, firmu ani kontaktní
  osobu klienta.
- Follow-up jako takt a kompatibilní úkol mimo běh, zatímco plocha (věž, moje kroky, postup)
  i zápisová cesta existují jen pro běhy.
- Sklon každé nové instance zakládat vlastní tabulky s vlastními jmény (CRM, ERP, komunita).

## Důsledky

- **Jádro (upstream):** K1 identita do jádra + reference účtu při provisioningu, K2 kloub
  krok ↔ takt + follow-up jako jednouzlový běh, K3 `client_params`, K4 `surface_actions`,
  K5 osy pohledu jako data, K6 přejmenování `production_*` s aliasy, K7 ingest profil
  komunikace, K8 `audience_resolve_twins`, K9 brána zákona jmen. Pořadí a DoD v modelu §8.1.
- **Instance:** dodává pouze overlay (§8.2 modelu). Test: každé slovo overlaye lze nahradit
  bez změny řádku jádra.
- **<fork>:** zadání rev. 2 se řídí tímto ADR; entita `pulse_beat` ve frontě, registrové
  sekce jako cíl práce a instanční importní skripty jsou zrušeny; Raynet i komunikace jen
  přes ingest.
- **Kompatibilita:** `subject_type='twin'` je kanon polymorfní osy; `actor` a `story` zůstávají
  aliasy. `studies` zůstává kontejnerem členství, jeho identita je entita, kontext je story.

## Zamítnuté alternativy

- **Dvě identity vedle sebe** (profil pro lidi s účtem, entita pro ostatní) — dva registry,
  dvě deduplikace, dvě pravdy o tomtéž člověku.
- **Nová entita fronty pro follow-up** (`pulse_beat` v review) — druhá zápisová cesta práce
  vedle kroků; přesně to, co K2 ruší.
- **Doménové moduly per instance** (CRM tabulky pro komunitu, care tabulky pro klienty) —
  jádro by rostlo jmény, ne primitivy; překlad by přestal být možný.
