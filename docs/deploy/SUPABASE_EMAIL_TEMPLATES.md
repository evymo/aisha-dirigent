# Supabase Email Templates - Lokalizované šablony

## 📋 Přehled

Šablony pro Supabase Auth se **generují automaticky** z i18n segmentů a je potřeba je **vložit do Supabase Dashboardu** → Authentication → Email Templates.

Používáme `{{ .Data.lang }}` pro přepínání jazyků a volitelné brand proměnné:
- `{{ .Data.brand_name }}` (fallback: *Platform*)
- `{{ .Data.support_email }}` (fallback: *support@example.com*)
- `{{ .Data.logo_url }}` (fallback: veřejný URL z bucketu *email-assets*)

---

## ⚠️ DŮLEŽITÉ: Supabase Cloud vs Self-Hosted

### Supabase Cloud (naše produkce)
- Šablony se nastavují **POUZE přes Dashboard UI**
- Supabase Cloud **nepodporuje** automatické nastavení přes API
- Každá šablona musí být zkopírována manuálně

### Self-Hosted Supabase
- Šablony se nastavují přes ENV vars (GOTRUE_MAILER_TEMPLATES_*)
- Možnost použít URL na Storage bucket

---

## ✅ Kompletní postup pro Supabase Cloud

### 1) Vygeneruj šablony

```bash
npm run supabase:email-templates:generate
```

### 2) Nahraj do Supabase Dashboard (MANUÁLNĚ!)

1. Jdi na: `https://supabase.com/dashboard/project/[PROJECT_ID]/auth/templates`
2. Pro KAŽDÝ typ emailu:

| Typ emailu | Soubor HTML | Soubor Subject |
|------------|-------------|----------------|
| **Confirm signup** | `confirmation.html` | `Your confirmation link - Platform` |
| **Invite user** | `invite.html` | `You've been invited to Platform` |
| **Magic link** | `magic-link.html` | `Your sign-in link - Platform` |
| **Change email** | `email-change.html` | `Confirm your new email - Platform` |
| **Reset password** | `recovery.html` | `Reset your password - Platform` |
| **Reauthentication** | `reauthentication.html` | `Verify your identity - Platform` |

3. V Dashboard:
   - Klikni na typ emailu
   - Do pole "Message body" vlož **celý obsah** HTML souboru
   - Subject line ponech anglicky (GoTrue nepodporuje dynamický subject)
   - Klikni "Save"

### 3) Ověř že auth posílá `lang`

```typescript
await supabase.auth.signInWithOtp({
  email,
  options: {
    data: { lang: i18n.language, brand_name: '...', support_email: '...', logo_url: '...' },
    emailRedirectTo: buildPublicUrl(`/auth?redirect=/member&lang=${i18n.language}`),
  },
});
```

**POZOR:** `resetPasswordForEmail()` nepodporuje `data` options přímo! Pro recovery emails:
- Před voláním `resetPasswordForEmail` aktualizuj user_metadata přes `updateUser({ data: {...} })`
- Toto funguje POUZE pro přihlášené uživatele

---

## 🔧 Troubleshooting

### Email chodí z fallback šablony
- **Příčina:** Šablona není nahrána v Supabase Dashboard
- **Řešení:** Zkopíruj HTML do Dashboard → Authentication → Email Templates

### Lokalizace nefunguje (email vždy anglicky)
- **Příčina:** `data.lang` se nepředává při auth volání
- **Řešení:** Přidej `data: { lang: i18n.language }` do options

### Recovery email nemá brand/logo
- **Příčina:** User nemá aktualizovaná metadata
- **Řešení:** Při každém loginu voláme `updateUser({ data: {...} })`

---

## 🖼️ Logo v e-mailech

Logo se načítá z veřejného bucketu `email-assets` na cestě `branding/logo`.
Nahrávání řeší **Admin Settings → Email Branding** (upload přepíše existující soubor).

## 🔁 Recovery e-maily a metadata

Recovery šablony používají `{{ .Data.* }}` hodnoty uložené v `user_metadata`.
Metadata aktualizujeme při přihlášení a při resetu hesla pro přihlášeného uživatele.
Pokud uživatel resetuje heslo bez aktivní session, šablona spadne na defaulty.
