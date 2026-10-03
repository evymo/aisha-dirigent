package platforma.hlidac;

import android.app.admin.DevicePolicyManager;
import android.app.admin.SystemUpdatePolicy;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.MediaStore;
import android.os.UserManager;
import java.util.ArrayList;
import java.util.List;

/**
 * Co hlídač jako device owner na tabletu vynucuje.
 *
 * Každý krok je samostatný a jeho výsledek se VRACÍ jako řádek zprávy —
 * servisní panel ho ukáže. Selhání jednoho kroku (třeba výrobce nějaké
 * omezení nepodporuje) nesmí zastavit ostatní, ale nesmí ani zmizet.
 */
final class Politika {
    static final String OBCHOD = "com.android.vending";

    /**
     * Omezení v kiosku. ⛔ Záměrně NE `DISALLOW_INSTALL_APPS`: blokuje každou
     * instalační session uživatele — i tichou instalaci z device ownera, kterou
     * Kiosk Admin Řidiče aktualizuje. ⛔ A NIKDY `ENSURE_VERIFY_APPS` (viz
     * skryjObchod). Zákaz neznámých zdrojů stačí.
     */
    static final String[] OMEZENI = {
        UserManager.DISALLOW_SAFE_BOOT,
        UserManager.DISALLOW_DEBUGGING_FEATURES,
        UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY,
        UserManager.DISALLOW_ADD_USER,
        UserManager.DISALLOW_USB_FILE_TRANSFER,
        UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA,
        // Čas a poloha jsou součást evidence předání: řidič je nesmí vypnout
        // ani přestavit. Čas se bere ze sítě (setAutoTimeEnabled níž).
        UserManager.DISALLOW_CONFIG_DATE_TIME,
        UserManager.DISALLOW_CONFIG_LOCATION,
    };

    private Politika() {}

    static ComponentName admin(Context ctx) {
        return new ComponentName(ctx, SpravceReceiver.class);
    }

    static DevicePolicyManager dpm(Context ctx) {
        return ctx.getSystemService(DevicePolicyManager.class);
    }

    static boolean jsemSpravce(Context ctx) {
        return dpm(ctx).isDeviceOwnerApp(ctx.getPackageName());
    }

    /** Základ, který platí i v servisu: bez Obchodu Play, domovská obrazovka, kiosk povolený, čas, poloha, aktualizace systému. */
    static List<String> zaklad(Context ctx) {
        List<String> zprava = new ArrayList<>();
        DevicePolicyManager dpm = dpm(ctx);
        ComponentName a = admin(ctx);
        Nastaveni n = new Nastaveni(ctx);

        skryjObchod(ctx, dpm, a, zprava);
        // ⛔ Fotka evidence otevírá SYSTÉMOVÝ fotoaparát (ACTION_IMAGE_CAPTURE).
        // V zámku se smí spustit jen aplikace ze seznamu — bez fotoaparátu na něm
        // by řidič v kiosku nevyfotil nic. Který to je, se zjistí záměrem, ne jménem
        // výrobce: nastavení z QR ho mohlo vypnout, proto se nejdřív povolí.
        krok(zprava, "fotoaparát povolen", () -> dpm.enableSystemApp(a, new Intent(MediaStore.ACTION_IMAGE_CAPTURE)));
        // ⛔ ŽÁDNÝ PROHLÍŽEČ V KIOSKU (rozhodnutí majitele 2026-09-28). Řidič se na
        //    Androidu přihlašuje jménem a heslem RIQ ID ve vloženém WebView (mobile-app
        //    src/components/PrihlaseniWebView.tsx). Prohlížeč, který zavedení z QR
        //    odinstalovalo, se nevrací a do zámku nesmí — resolveActivity(https) při
        //    zavedení vrátil průvodce nastavením Samsungu a starší verze ho do zámku pustila.
        String kamera = fotoaparat(ctx);
        List<String> smi = new ArrayList<>();
        smi.add(ctx.getPackageName());
        smi.add(BuildConfig.KIOSK_PACKAGE);
        if (kamera != null) smi.add(kamera);
        final String[] povolene = smi.toArray(new String[0]);
        if (kamera == null) zprava.add("✗ fotoaparát: žádná aplikace neumí ACTION_IMAGE_CAPTURE — fotky v kiosku nepůjdou");
        krok(zprava, "kiosk smí: " + String.join(", ", povolene), () -> dpm.setLockTaskPackages(a, povolene));
        // Stavový řádek (baterie, signál), nabídka vypnutí (restart = cesta
        // k PINu technika) a zámek obrazovky, pokud ho tablet má.
        krok(zprava, "funkce kiosku", () -> dpm.setLockTaskFeatures(a,
            DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO
                | DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS
                | DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD));
        krok(zprava, "hlídač je domovská obrazovka", () -> {
            IntentFilter domov = new IntentFilter(Intent.ACTION_MAIN);
            domov.addCategory(Intent.CATEGORY_HOME);
            domov.addCategory(Intent.CATEGORY_DEFAULT);
            dpm.addPersistentPreferredActivity(a, domov, new ComponentName(ctx, DomovActivity.class));
        });
        krok(zprava, "čas ze sítě", () -> dpm.setAutoTimeEnabled(a, true));
        krok(zprava, "poloha zapnutá", () -> dpm.setLocationEnabled(a, true));
        NocniOkno okno = n.okno();
        krok(zprava, "aktualizace systému v okně " + okno, () -> dpm.setSystemUpdatePolicy(a,
            SystemUpdatePolicy.createWindowedInstallPolicy(okno.zacatekMinut(), okno.konecMinut())));
        return zprava;
    }

    /**
     * ⛔ BEZ GOOGLE PLAY (rozhodnutí majitele 2026-09-28): „nechceme google play,
     *    chceme naši aplikaci instalovat plně automaticky". Obchod Play je povinný
     *    ověřovatel instalací (Play Protect): každou tichou instalaci Kiosk Admina
     *    podržel na ťuknutí a bez něj zamítl (INSTALL_FAILED_VERIFICATION_FAILURE,
     *    naměřeno na SM-X115); „Povolit" si nepamatuje.
     *
     * Device owner cizí appku VYPNOUT nesmí (to je signature|privileged), umí ji jen
     * SKRÝT. Skrytý Obchod Play zůstane v seznamu povinných ověřovatelů, ale jeho
     * přijímač nikdo nenajde — po `verifier_timeout` (~17 s) platí výchozí POVOLIT
     * (AOSP 14 VerifyingSession). ⛔ Proto NIKDY `ENSURE_VERIFY_APPS`: výchozí
     * odpověď by se otočila na ZAMÍTNOUT a tichá instalace by umřela úplně.
     */
    static void skryjObchod(Context ctx, DevicePolicyManager dpm, ComponentName a, List<String> zprava) {
        try {
            if (dpm.setApplicationHidden(a, OBCHOD, true)) {
                zprava.add("✓ Obchod Play skrytý");
                return;
            }
            if (dpm.isApplicationHidden(a, OBCHOD)) {
                zprava.add("✓ Obchod Play je skrytý");
                return;
            }
        } catch (RuntimeException e) {
            zprava.add("✗ Obchod Play: " + e.getClass().getSimpleName() + " " + e.getMessage());
            return;
        }
        try {
            ctx.getPackageManager().getPackageInfo(OBCHOD, 0);
            zprava.add("✗ Obchod Play se nepodařilo skrýt — Play Protect bude tiché instalace zdržovat");
        } catch (PackageManager.NameNotFoundException e) {
            zprava.add("✓ Obchod Play na tabletu není (zavedení ho odebralo)");
        }
    }

    /**
     * Poskytovatel WebView, ve kterém se Řidič přihlašuje (jménem a heslem RIQ ID,
     * rozhodnutí majitele 2026-09-28) — pro servis a hlášení; `null` = žádný.
     * Zavedení z QR ho neodebírá (SM-X115: com.google.android.webview v obrazu).
     */
    static String webView() {
        android.content.pm.PackageInfo p = android.webkit.WebView.getCurrentWebViewPackage();
        return p == null ? null : p.packageName + " " + p.versionName;
    }

    /** Balíček, který obslouží ACTION_IMAGE_CAPTURE; při více kandidátech systémový. */
    static String fotoaparat(Context ctx) {
        PackageManager pm = ctx.getPackageManager();
        Intent zamer = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        ResolveInfo vychozi = pm.resolveActivity(zamer, PackageManager.MATCH_DEFAULT_ONLY);
        // Víc kandidátů bez výchozího = vrátí se výběrový dialog systému („android“).
        if (vychozi != null && vychozi.activityInfo != null && !"android".equals(vychozi.activityInfo.packageName)) {
            return vychozi.activityInfo.packageName;
        }
        for (ResolveInfo ri : pm.queryIntentActivities(zamer, PackageManager.MATCH_SYSTEM_ONLY)) {
            if (ri.activityInfo != null) return ri.activityInfo.packageName;
        }
        return null;
    }

    /** Kiosk: základ + omezení + oprávnění kioskové aplikace. */
    static List<String> zamkni(Context ctx) {
        List<String> zprava = zaklad(ctx);
        DevicePolicyManager dpm = dpm(ctx);
        ComponentName a = admin(ctx);
        for (String o : OMEZENI) krok(zprava, o, () -> dpm.addUserRestriction(a, o));
        // Tovární reset se zakáže JEN s platným PINem technika. Bez PINu by tablet
        // neměl žádnou cestu ven — ani přes servis, ani přes reset.
        if (new Nastaveni(ctx).maPlatnyPin()) {
            krok(zprava, UserManager.DISALLOW_FACTORY_RESET,
                () -> dpm.addUserRestriction(a, UserManager.DISALLOW_FACTORY_RESET));
        } else {
            zprava.add("✗ " + UserManager.DISALLOW_FACTORY_RESET + ": chybí PIN technika, reset zůstává povolený");
        }
        zprava.addAll(Kiosk.pripravAplikaci(ctx));
        return zprava;
    }

    /** Servis: omezení se zvednou, aby technik mohl do nastavení, ladění i k resetu. */
    static List<String> uvolniProServis(Context ctx) {
        List<String> zprava = new ArrayList<>();
        DevicePolicyManager dpm = dpm(ctx);
        ComponentName a = admin(ctx);
        for (String o : OMEZENI) krok(zprava, "zrušeno " + o, () -> dpm.clearUserRestriction(a, o));
        krok(zprava, "zrušeno " + UserManager.DISALLOW_FACTORY_RESET,
            () -> dpm.clearUserRestriction(a, UserManager.DISALLOW_FACTORY_RESET));
        return zprava;
    }

    /** Vrátí tablet do běžného stavu a hlídač se vzdá role správce. Nevratné bez nového QR. */
    static List<String> uvolniTablet(Context ctx) {
        List<String> zprava = uvolniProServis(ctx);
        DevicePolicyManager dpm = dpm(ctx);
        ComponentName a = admin(ctx);
        krok(zprava, "kiosk vypnut", () -> dpm.setLockTaskPackages(a, new String[0]));
        krok(zprava, "domovská obrazovka vrácena", () -> dpm.clearPackagePersistentPreferredActivities(a, ctx.getPackageName()));
        krok(zprava, "odinstalace aplikace povolena", () -> dpm.setUninstallBlocked(a, BuildConfig.KIOSK_PACKAGE, false));
        krok(zprava, "aktualizace systému bez okna", () -> dpm.setSystemUpdatePolicy(a, null));
        // Běžné zařízení má Obchod Play zpátky (v kiosku je skrytý kvůli Play Protect).
        krok(zprava, "Obchod Play vrácen", () -> {
            dpm.setApplicationHidden(a, OBCHOD, false);
            dpm.enableSystemApp(a, OBCHOD);
        });
        krok(zprava, "správce zařízení zrušen", () -> dpm.clearDeviceOwnerApp(ctx.getPackageName()));
        return zprava;
    }

    interface Akce {
        void proved();
    }

    static void krok(List<String> zprava, String co, Akce akce) {
        try {
            akce.proved();
            zprava.add("✓ " + co);
        } catch (RuntimeException e) {
            zprava.add("✗ " + co + ": " + e.getClass().getSimpleName() + " " + e.getMessage());
        }
    }
}
