# App Integrity - Verifikace mobilní aplikace

**Verze:** 1.0 | **Datum:** 3. února 2026

---

## 📋 Přehled

App Integrity zajišťuje, že API requesty přicházejí z legitimní instance mobilní aplikace běžící na důvěryhodném zařízení. Chrání před:

- **Modifikovanými APK/IPA** - útočník nemůže spustit upravenou verzi aplikace
- **Emulátory a rooted zařízení** - detekce kompromitovaných prostředí
- **Replay útoky** - tokeny jsou vázané na konkrétní request

| Platforma | Technologie | Provider |
|-----------|-------------|----------|
| Android | Google Play Integrity API | Google Cloud |
| iOS | Apple App Attest | Apple DeviceCheck |

---

## 🔧 Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│ Mobile App                                                       │
│                                                                  │
│  1. useAppIntegrity() hook                                      │
│     ├── Android: requestIntegrityCheckAsync(challenge)          │
│     └── iOS: attestKeyAsync(keyId, challenge) / assertion       │
│                                                                  │
│  2. Přidá headers k API requestu:                               │
│     X-Integrity-Token: <token>                                  │
│     X-Integrity-Platform: android|ios                           │
│     X-Integrity-Type: integrity|attestation|assertion           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Supabase Edge Function                                          │
│                                                                  │
│  1. Extrahuje headers                                           │
│  2. Volá verify-app-integrity function                          │
│  3. Android: Google Play Integrity API dekóduje token           │
│  4. iOS: Apple DeviceCheck API validuje attestation             │
│  5. Vrací verdict (MEETS_DEVICE_INTEGRITY, etc.)               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Setup: Google Cloud (Android)

### 1. Vytvoření Google Cloud Projektu

1. Jdi na [Google Cloud Console](https://console.cloud.google.com/)
2. Vytvoř nový projekt nebo vyber existující
3. Zapamatuj si **Project Number** (ne Project ID!)
   - Najdeš ho v Dashboard → Project info → Project number
   - Formát: `123456789012` (pouze čísla)

### 2. Aktivace Play Integrity API

1. V Cloud Console jdi do **APIs & Services → Library**
2. Vyhledej "Play Integrity API"
3. Klikni **Enable**

### 3. Vytvoření Service Account

1. Jdi do **IAM & Admin → Service Accounts**
2. Klikni **Create Service Account**
3. Název: `play-integrity-verifier`
4. Popis: `Verifies Play Integrity tokens from mobile app`
5. Klikni **Create and Continue**

### 4. Přidělení Role

1. V sekci "Grant this service account access to project"
2. Role: `Service Account Token Creator` (pro JWT signing)
3. Klikni **Continue → Done**

### 5. Vytvoření JSON klíče

1. Klikni na vytvořený service account
2. Tab **Keys → Add Key → Create new key**
3. Typ: **JSON**
4. Stáhne se soubor `project-name-xxxx.json`

### 6. Propojení s Google Play Console

1. Jdi do [Google Play Console](https://play.google.com/console/)
2. Vyber svou aplikaci
3. **Setup → App signing** - zapamatuj si SHA-256 certifikátu
4. **Grow → Play Integrity API**
5. Klikni **Link Cloud project**
6. Vyber projekt který jsi vytvořil v Cloud Console

---

## 🍎 Setup: Apple App Attest (iOS)

### 1. Apple Developer Account

1. Přihlaš se do [Apple Developer](https://developer.apple.com/)
2. V **Certificates, Identifiers & Profiles**
3. Vyber svůj App ID (Bundle ID)

### 2. Aktivace App Attest

App Attest je automaticky dostupný pro všechny aplikace od iOS 14+. 
Není potřeba žádná speciální konfigurace v Apple Developer Portal.

### 3. APPLE_APP_ID formát

```
TEAMID.com.example.app
```

- **TEAMID**: 10-znakový Team ID z Apple Developer účtu
- **Bundle ID**: Bundle Identifier tvé aplikace

Příklad: `ABC123DEF4.com.app.example`

---

## 🔐 Environment Variables

### Mobile App (Expo)

V `app.config.ts` nebo `.env`:

```env
EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER=123456789012
```

### Supabase Edge Functions

Nastav přes Supabase Dashboard nebo CLI:

```bash
# Pomocí Supabase CLI
supabase secrets set GOOGLE_CLOUD_PROJECT_NUMBER=123456789012
supabase secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
supabase secrets set APPLE_APP_ID=ABC123DEF4.com.app.example
```

Nebo v Supabase Dashboard:
1. **Project Settings → Edge Functions → Secrets**
2. Přidej každou proměnnou

| Variable | Popis | Příklad |
|----------|-------|---------|
| `GOOGLE_CLOUD_PROJECT_NUMBER` | Project Number z Google Cloud Console | `123456789012` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Celý obsah JSON klíče service accountu | `{"type":"service_account",...}` |
| `APPLE_APP_ID` | Team ID + Bundle ID | `ABC123DEF4.com.app.example` |

---

## 📱 Použití v Mobile App

### Hook: useAppIntegrity

```tsx
import { useAppIntegrity } from '@/hooks/useAppIntegrity';

function SecureComponent() {
  const { 
    requestIntegrityToken, 
    isReady, 
    isLoading, 
    error 
  } = useAppIntegrity();

  const handleSecureAction = async () => {
    // Challenge by měl přijít ze serveru (nonce)
    const challenge = await fetchChallengeFromServer();
    
    const result = await requestIntegrityToken(challenge);
    
    if (result) {
      // Pošli token s API requestem
      await fetch('/api/secure-action', {
        method: 'POST',
        headers: {
          'X-Integrity-Token': result.token,
          'X-Integrity-Platform': result.platform,
          'X-Integrity-Type': result.tokenType,
        },
        body: JSON.stringify(data),
      });
    }
  };

  return (
    <Button 
      onPress={handleSecureAction} 
      disabled={!isReady || isLoading}
    >
      Secure Action
    </Button>
  );
}
```

### Fetch wrapper: integrityFetch

```tsx
import { integrityFetch, initializeIntegrity } from '@/services/api/integrityFetch';

// Při startu aplikace (v _layout.tsx)
await initializeIntegrity();

// Pro jednotlivé requesty
const response = await integrityFetch('/api/sensitive', {
  method: 'POST',
  body: JSON.stringify(data),
}, {
  challenge: serverNonce,
});
```

---

## 🛡️ Verifikace na Backendu

### Shared Helper

```typescript
// supabase/functions/_shared/appIntegrity.ts
import { verifyAppIntegrity, requireAppIntegrity } from './appIntegrity.ts';

// Volitelná verifikace (loguje warning pokud selže)
const result = await verifyAppIntegrity(req);
if (result.valid) {
  console.log('Device verdict:', result.verdict);
}

// Povinná verifikace (vrací 403 pokud selže)
const integrityError = await requireAppIntegrity(req);
if (integrityError) {
  return integrityError; // Response s 403
}
```

### Edge Function příklad

```typescript
serve(async (req) => {
  // Ověř integritu před zpracováním
  const integrityError = await requireAppIntegrity(req);
  if (integrityError) return integrityError;

  // Pokračuj se zpracováním...
});
```

---

## 📊 Verdicts

### Android (Google Play Integrity)

| Verdict | Význam |
|---------|--------|
| `MEETS_DEVICE_INTEGRITY` | Aplikace běží na fyzickém Android zařízení s Google Play |
| `MEETS_BASIC_INTEGRITY` | Aplikace běží na zařízení které prošlo základní kontrolou |
| `MEETS_STRONG_INTEGRITY` | Zařízení s hardware-backed security |
| `MEETS_VIRTUAL_INTEGRITY` | Virtuální zařízení (emulátor) - zamítnout! |

### iOS (App Attest)

| Typ tokenu | Kdy se používá |
|------------|----------------|
| `attestation` | První volání - attestuje klíč |
| `assertion` | Následující volání - podepisuje requesty |

---

## ⚠️ Důležité poznámky

### Development vs Production

```typescript
// V development módu můžeš přeskočit verifikaci
if (Deno.env.get('ENVIRONMENT') === 'development') {
  return { valid: true, platform: 'android', verdict: { ... } };
}
```

### Rate Limiting

Google Play Integrity API má limity:
- **10,000 requests/den** pro standardní tier
- Pro více kontaktuj Google

### Token Expiration

- Android tokeny jsou platné **několik minut**
- iOS assertions jsou vázané na konkrétní challenge
- **Vždy generuj nový token pro každý citlivý request**

### Error Handling

```typescript
const result = await requestIntegrityToken(challenge);

if (!result) {
  // Zařízení nepodporuje integrity check
  // Rozhodnutí: povolit/zamítnout/degraded mode
}
```

---

## 🔗 Reference

- [Google Play Integrity API](https://developer.android.com/google/play/integrity)
- [Apple App Attest](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)
- [@expo/app-integrity](https://github.com/expo/expo/tree/main/packages/expo-app-integrity)

---

## 📋 Checklist pro deployment

- [ ] Google Cloud projekt vytvořen
- [ ] Play Integrity API aktivováno
- [ ] Service Account vytvořen s JSON klíčem
- [ ] Cloud projekt propojen s Google Play Console
- [ ] `EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER` nastaveno v app
- [ ] `GOOGLE_CLOUD_PROJECT_NUMBER` nastaveno v Edge Functions
- [ ] `GOOGLE_APPLICATION_CREDENTIALS_JSON` nastaveno v Edge Functions
- [ ] `APPLE_APP_ID` nastaveno v Edge Functions
- [ ] Edge Function `verify-app-integrity` deployed
- [ ] Testováno na fyzickém zařízení (ne emulátor!)

---

*Dokument vytvořen: 3. února 2026*
