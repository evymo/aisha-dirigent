# Kritický Bezpečnostní Review (Prosinec 2025)

**Datum:** 16. 12. 2025
**Autor:** GitHub Copilot (Security Audit)
**Status:** 🔴 CRITICAL ISSUES FOUND

Tento dokument obsahuje výsledky "maximálně kritického" bezpečnostního auditu aplikace Platform. Audit se zaměřil na ochranu sensitive data (sensitive data), integritu API a soulad s compliance standardy.

---

## 🚨 Kritická Zjištění (P0 - Okamžitá Náprava)

### 1. Obcházení Audit Logů při přístupu Partnerů/Konzultantů
**Popis:** Aplikace implementovala mechanismus auditování čtení sensitive data pomocí RPC funkce `get_my_health_check_ins_audited` (viz migrace `20251214183000`). Tento mechanismus je však používán **pouze** pro přístup samotného uživatela.
Konzultanti a partneři přistupují k citlivým datům (`health_check_ins`, `lab_results`) pomocí přímých `SELECT` dotazů v `useConsultantUsers.ts` a `usePartnerDashboard.ts`.

**Důkaz:**
- `src/hooks/useConsultantUsers.ts`:
  ```typescript
  supabase.from("health_check_ins").select("...pain_level, ...")
  ```
- Přímé `SELECT` dotazy v Postgres **nevyvolávají** auditní záznam (pokud není nastaven složitý `pgAudit` nebo trigger na `SELECT`, což migrace explicitně zmiňuje jako důvod pro použití RPC).

**Riziko:** Porušení compliance požadavků na "Accounting of Disclosures". Neexistuje záznam o tom, že se konzultant podíval na konkrétní citlivá data uživatela.

**Náprava:**
1. Vytvořit `SECURITY DEFINER` RPC funkce pro přístup partnerů/konzultantů (např. `get_user_health_data_audited(client_id)`).
2. Tyto funkce musí zapsat záznam do `audit_journal` před vrácením dat.
3. Zakázat přímý `SELECT` na tabulky `health_check_ins` a `lab_results` pro role partner/consultant pomocí RLS (povolit pouze přes RPC).

### 2. Chybějící Content Security Policy (CSP)
**Popis:** Soubor `index.html` neobsahuje žádnou definici `Content-Security-Policy`.
**Riziko:** Aplikace je zranitelná vůči XSS (Cross-Site Scripting). Pokud by útočník dokázal vložit škodlivý skript (např. přes kompromitovanou npm knihovnu nebo chybu v sanitizaci), prohlížeč jej bez omezení spustí a může exfiltrovat tokeny ze `sessionStorage`.
**Náprava:** Implementovat striktní CSP hlavičku (meta tag nebo server header), která omezí zdroje skriptů, stylů a connect-src pouze na důvěryhodné domény (Supabase, vlastní API).

---

## 🟠 Vysoká Priorita (P1 - Vyřešit před dalším releasem)

### 3. Implicitní a Složitá RLS Pravidla
**Popis:** Přístupová práva pro partnery ke čtení dat uživatelů nejsou v migracích jasně viditelná na první pohled (např. v `health_check_ins` tabulce chybí explicitní politika pro partnery v původní definici). Spoléhá se pravděpodobně na pozdější migrace nebo složité JOINy v politikách.
**Riziko:** "Security by obscurity" nebo neúmyslné otevření dat. Těžká auditovatelnost.
**Náprava:** Konsolidovat RLS politiky. Každá tabulka s sensitive data by měla mít jasně definované politiky pro všechny role (Admin, Owner, Partner).

### 4. Source Maps v Produkci
**Popis:** `vite.config.ts` má `sourcemap: true` (nebo default).
**Riziko:** Odhaluje kompletní zdrojový kód aplikace v produkci. Ačkoliv kód je klientský, usnadňuje to útočníkům hledání zranitelností a logiky validací.
**Náprava:** Nastavit `sourcemap: false` pro produkční buildy.

---

## 🟡 Střední Priorita (P2 - Best Practices)

### 5. Hardcoded Supabase Fallback
**Popis:** `src/integrations/supabase/client.ts` obsahuje hardcoded "anon" klíč pro dev fallback.
**Riziko:** Pokud by se tento kód dostal do produkce bez nastavených ENV proměnných (chyba v CI/CD), aplikace by se připojila k dev/demo databázi, což může vést k úniku dat nebo zmatení uživatelů.
**Náprava:** V produkčním buildu vyhazovat chybu, pokud chybí ENV proměnné, místo fallbacku.

### 6. Použití `dangerouslySetInnerHTML`
**Popis:** Nalezeno v `src/components/ui/chart.tsx` pro injektování stylů.
**Riziko:** Nízké (pokud je config pod kontrolou), ale je to potenciální vektor pro CSS injection.
**Náprava:** Auditovat vstupy do grafů.

---

## ✅ Pozitiva (Co je uděláno dobře)

- **Session Storage:** Aplikace správně používá `sessionStorage` místo `localStorage` (v `client.ts`), což snižuje riziko perzistence tokenu po zavření prohlížeče.
- **Safe Logger:** `safeLogger.ts` správně potlačuje logy v produkci.
- **RPC pro vlastní data:** `get_my_health_check_ins_audited` je správně navržená funkce.

## Doporučený Postup

1. **Okamžitě:** Implementovat auditované RPC pro konzultanty (`get_user_health_data_audited`).
2. **Okamžitě:** Přidat CSP do `index.html`.
3. **Tento týden:** Zakázat source maps v produkci.
4. **Tento týden:** Revidovat RLS politiky pro `health_check_ins` a zakázat přímý SELECT pro ne-vlastníky.
