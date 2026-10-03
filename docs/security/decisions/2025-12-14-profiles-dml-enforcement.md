# Rozhodnutí: `profiles` DML enforcement (odložené plošné REVOKE)

Datum: 14. 12. 2025

## Kontext

- Tabulka `public.profiles` obsahuje mix PII + sensitive data polí.
- **RLS je pouze row-level**; pokud aplikace někde udělá broad `.select('*')` nebo `.select()` bez argumentu, hrozí overfetch citlivých sloupců.
- Pro admin/staff přístupy jsme přešli na DB-first (SECURITY DEFINER RPC + audit + minimal payload).
- Pro self-service sensitive data obrazovky jsme zavedli **secure mode** a nově audited RPC:
  - `public.get_my_profile_phi()`
  - `public.upsert_my_profile_phi(p_patch jsonb)`

## Rozhodnutí

- **Teď neprovádět plošné `REVOKE INSERT/UPDATE/DELETE` na `public.profiles` pro roli `authenticated`.**
- **sensitive-data čtení/zápis pro member sensitive data obrazovky se provádí přes audited RPC výše** (v secure mode), nikoli přímým DML.
- Self-service non-sensitive-data použití `profiles` (prefill apod.) je dočasně povoleno pouze s **explicitním whitelistem sloupců**.

## Důvody

- Plošný REVOKE na `profiles` je vysokoriziková změna: může rozbít existující flow (signup/onboarding, prefill formulářů, další komponenty), které se o `profiles` opírají.
- Než to zpřísníme, potřebujeme kompletní inventuru všech zápisů do `profiles` a jejich účelu + migrační plán.

## Důsledky

- Musíme dál striktně vynucovat:
  - zákaz `.select('*')` a `.select()` bez argumentu,
  - sensitive data obrazovky pouze v secure mode,
  - admin/staff pouze přes audited RPC.

## Follow-up (odložená implementace)

Před zavedením plošného REVOKE na `profiles`:

1. Sepsat seznam všech míst, kde se `profiles` zapisují/upsrtují (FE + Edge Functions + triggers).
2. Rozdělit `profiles` na:
   - non-sensitive-data pole (např. `display_name`, adresa pro checkout apod.)
   - sensitive data pole (diagnózy, medikace, historie, DOB, …)
3. Navrhnout dvě cesty:
   - audited self-service RPC pro sensitive data (už existuje),
   - audited/validated self-service RPC pro non-sensitive-data (nové) nebo jiná bezpečná alternativa.
4. Teprve potom aplikovat `REVOKE` a upravit všechna flow tak, aby používala jen povolené cesty.
