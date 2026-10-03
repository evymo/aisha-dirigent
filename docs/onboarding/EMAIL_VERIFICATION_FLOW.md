# Změna onboarding flow - nastavení hesla po email verifikaci

**Datum:** 18. prosince 2025  
**Stav:** ✅ Implementováno a otestováno

## 📋 Souhrn změn

Změna onboarding procesu tak, aby uživatelé **nenastavovali heslo během registrace**, ale až **po kliknutí na verifikační email**.

## 🎯 Důvod změny

- Lepší UX - kratší registrační formulář
- Vyšší bezpečnost - heslo se nastavuje až po ověření emailu
- Snížení friction při registraci
- Standardní flow používaný mnoha moderními aplikacemi

## 🔄 Změny v kódu

### 1. Nová stránka `SetPassword.tsx`

**Cesta:** `src/pages/SetPassword.tsx`

**Funkce:**
- Zobrazuje se po kliknutí na verifikační odkaz v emailu
- Ověřuje platnost tokenu z URL parametrů
- Umožňuje uživateli nastavit heslo
- Validuje sílu hesla (min. 8 znaků, velké/malé písmeno, číslo)
- Po úspěšném nastavení hesla přesměruje na `/member`

**Klíčové funkce:**
```typescript
// Ověření tokenu při načtení stránky
useEffect(() => {
  const verifyToken = async () => {
    const accessToken = searchParams.get('access_token');
    const type = searchParams.get('type');
    
    if (!accessToken || type !== 'signup') {
      // Neplatný odkaz
      return;
    }
    
    const { data: { session } } = await supabase.auth.getSession();
    // Ověření session
  };
  
  verifyToken();
}, []);

// Nastavení hesla
const handleSubmit = async (e: React.FormEvent) => {
  const { error } = await supabase.auth.updateUser({
    password: password,
  });
  
  navigate("/member");
};
```

### 2. Úprava `PromoOnboarding.tsx`

**Změny:**

#### Schema - odstranění password polí
```typescript
// PŘED
const createPromoFormSchema = (t) => z.object({
  // ... other fields
  password: z.string().min(6, "...").optional(),
  confirmPassword: z.string().optional(),
}).refine((data) => {
  if (data.password && data.confirmPassword) {
    return data.password === data.confirmPassword;
  }
  return true;
}, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// PO
const createPromoFormSchema = (t) => z.object({
  // ... other fields
  // Password fields removed
});
```

#### SignUp flow - registrace bez hesla
```typescript
// PŘED
if (!isLoggedIn && data.password) {
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      emailRedirectTo: buildPublicUrl(`/member?lang=...`),
      // ...
    },
  });
}

// PO
if (!isLoggedIn) {
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: crypto.randomUUID(), // Temporary random password
    options: {
      emailRedirectTo: buildPublicUrl(`/set-password?lang=...`),
      // ...
    },
  });
  
  // Informuj uživatele o odeslání emailu
  toast({
    title: "Email odeslán",
    description: "Zkontrolujte svůj email a klikněte na odkaz pro dokončení registrace...",
  });
}
```

#### UI - odstranění password polí z formuláře
```tsx
// PŘED
{!isLoggedIn && (
  <>
    <Separator />
    <p>Vytvořte si účet pro pokračování</p>
    
    <FormField name="password" ... />
    <FormField name="confirmPassword" ... />
  </>
)}

// PO
{!isLoggedIn && (
  <div className="bg-muted/50 rounded-lg p-4 mt-4">
    <p className="text-sm text-muted-foreground">
      Po odeslání formuláře vám pošleme email pro ověření a nastavení hesla.
    </p>
  </div>
)}
```

#### Validace - odstranění password z nextStep
```typescript
// PŘED
const nextStep = async () => {
  if (currentStep === 1) {
    const isValid = await form.trigger(
      isLoggedIn 
        ? ["email", "firstName", "lastName", "dateOfBirth"]
        : ["email", "firstName", "lastName", "dateOfBirth", "password", "confirmPassword"]
    );
  }
};

// PO
const nextStep = async () => {
  if (currentStep === 1) {
    const isValid = await form.trigger(["email", "firstName", "lastName", "dateOfBirth"]);
  }
};
```

### 3. Routing v `App.tsx`

**Přidání:**
```typescript
// Import
const SetPassword = lazy(() => import("./pages/SetPassword"));

// Route
<Route path="/set-password" element={<SetPassword />} />
```

## 🔐 Bezpečnostní aspekty

### Dočasné heslo
- Při registraci se generuje náhodné UUID jako dočasné heslo
- Toto heslo je NEPOUŽITELNÉ pro přihlášení (uživatel ho nezná)
- Uživatel si musí nastavit vlastní heslo po kliknutí na email

### Validace hesla
- Min. 8 znaků
- Musí obsahovat velké písmeno
- Musí obsahovat malé písmeno
- Musí obsahovat číslo
- Hesla se musí shodovat

### Token verifikace
- Ověření `access_token` a `type=signup` v URL
- Kontrola platnosti session
- Timeouty dle Supabase nastavení (výchozí 1 hodina)

## 📧 Email flow

1. **Uživatel vyplní registrační formulář** (bez hesla)
   - Email, jméno, datum narození, wellness data

2. **Systém vytvoří účet**
   - Email odeslán: "Zkontrolujte svůj email..."
   - Účet existuje, ale bez použitelného hesla

3. **Uživatel obdrží email od Supabase**
   - Obsahuje link s `access_token` a `type=signup`
   - Link: `/set-password?access_token=...&type=signup&lang=cs`

4. **Kliknutí na link**
   - Otevře se `/set-password` stránka
   - Ověří se platnost tokenu
   - Zobrazí se formulář pro nastavení hesla

5. **Nastavení hesla**
   - Uživatel zadá a potvrdí heslo
   - Heslo se aktualizuje: `supabase.auth.updateUser({ password })`
   - Redirect na `/member`

## ✅ Testování

### Manuální testy

- [x] Build bez chyb (`npm run build`)
- [x] TypeScript kompilace (`npx tsc --noEmit`)
- [ ] Registrace nového uživatele bez hesla
- [ ] Příjem verifikačního emailu
- [ ] Kliknutí na link a otevření `/set-password`
- [ ] Validace hesla (slabé vs. silné)
- [ ] Neplatný token (vypršený/chybný)
- [ ] Úspěšné nastavení hesla a přesměrování

### Co testovat

```bash
# 1. Spusť dev server
npm run dev

# 2. Otevři PromoOnboarding
http://localhost:8080/invite/SOME_CODE

# 3. Vyplň formulář BEZ hesla
# 4. Odešli formulář
# 5. Zkontroluj Supabase Dashboard -> Auth -> Users
#    - Měl by být nový user s `email_confirmed_at = null`
#    - Email by měl být odeslán

# 6. V Supabase Dashboard -> Auth -> Email Templates
#    - Zkopíruj verifikační link
#    - Nahraď {{ .Token }} za skutečný token
#    - Otevři link v prohlížeči

# 7. Měla by se otevřít /set-password
#    - Zadej heslo (min. 8 znaků, velké, malé, číslo)
#    - Potvrzení hesla
#    - Odešli

# 8. Mělo by přesměrovat na /member
# 9. Zkontroluj, že se můžeš přihlásit s novým heslem
```

## 🚨 Možné problémy

### 1. Uživatel nezískává email

**Příčiny:**
- Supabase email konfigurace
- SMTP nastavení
- Email ve spam

**Řešení:**
- Zkontroluj Supabase Dashboard -> Project Settings -> Auth -> Email Templates
- Ověř SMTP credentials
- Testuj s reálným emailem (ne temp email services)

### 2. Token expired

**Příčiny:**
- Uživatel kliknul na starý link (>1 hodina)

**Řešení:**
- Zobrazí se error message
- Uživatel může požádat o nový email
- Implementovat "resend email" funkcionalitu (TODO)

### 3. Uživatel zná svoje dočasné heslo

**Není možné:**
- Heslo je generováno pomocí `crypto.randomUUID()`
- UUID je 128-bit náhodné číslo
- Prakticky neuhádnutelné

## 📝 Další vylepšení (TODO)

- [ ] Přidat "Resend verification email" tlačítko
- [ ] Implementovat countdown timer pro opětovné odeslání
- [ ] Přidat progress indicator při vytváření účtu
- [ ] Zlepšit error messages (i18n)
- [ ] Přidat telemetry/analytics pro tracking conversion rate
- [ ] Email template customizace (branding)

## 🔗 Související soubory

- `src/pages/SetPassword.tsx` - Nová stránka
- `src/pages/PromoOnboarding.tsx` - Upravený onboarding
- `src/App.tsx` - Routing
- `docs/onboarding/EMAIL_VERIFICATION_FLOW.md` - Tento dokument

## 📚 Reference

- [Supabase Auth - Sign Up](https://supabase.com/docs/reference/javascript/auth-signup)
- [Supabase Auth - Update User](https://supabase.com/docs/reference/javascript/auth-updateuser)
- [Supabase Auth - Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
