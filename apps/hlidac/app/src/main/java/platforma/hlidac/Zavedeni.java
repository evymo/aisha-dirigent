package platforma.hlidac;

import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PersistableBundle;
import android.util.Log;

/**
 * Konec nastavení z QR. Z QR (`PROVISIONING_ADMIN_EXTRAS_BUNDLE`) si hlídač
 * vezme otisk PINu technika a noční okno. Tablet zůstane v SERVISU — technik
 * je u něj, přidá účet Google a nainstaluje aplikaci; kiosk zapne on.
 */
final class Zavedeni {
    static final String KLIC_PIN = "pin";
    static final String KLIC_OKNO = "okno";
    private static final String TAG = "hlidac";

    private Zavedeni() {}

    @SuppressWarnings("deprecation")
    private static PersistableBundle extra(Intent intent) {
        if (intent == null) return null;
        String klic = DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE;
        // Typová varianta je až od Androidu 13; hlídač běží od 11.
        return Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableExtra(klic, PersistableBundle.class)
            : (PersistableBundle) intent.getParcelableExtra(klic);
    }

    static void dokonci(Context ctx, Intent intent) {
        Nastaveni n = new Nastaveni(ctx);
        PersistableBundle extra = extra(intent);
        if (extra != null) {
            String pin = extra.getString(KLIC_PIN);
            if (pin != null) {
                try {
                    Pin.zeZaznamu(pin);
                    n.ulozPin(pin);
                } catch (IllegalArgumentException e) {
                    // Neuloží se; servisní panel pak řekne „chybí PIN“ a kiosk nezamkne.
                    Log.w(TAG, "PIN z QR odmítnut: " + e.getMessage());
                }
            }
            String okno = extra.getString(KLIC_OKNO);
            if (okno != null) {
                try {
                    n.ulozOkno(okno);
                } catch (RuntimeException e) {
                    Log.w(TAG, "okno z QR odmítnuto: " + e.getMessage());
                    n.ulozOdmitnuteOkno(okno);
                }
            }
            // ⛔ VÝBAVA PATŘÍ K ZAVEDENÍ, ne k sestavení appky: adresa a identita
            //    u dveří přicházejí z dat instance přes QR. Appka z Obchodu Play
            //    pak sama o sobě neví, KAM se připojit — a o to právě jde.
            Vybava v = Vybava.zBundlu(extra);
            if (v != null) v.uloz(n);
            else Log.w(TAG, "QR nenese úplnou výbavu — appka nedostane adresu ani dveře");
        }
        // Předání běží i bez výbavy z QR: po restartu se bere ta uložená.
        Rozdavani.predejVybavu(ctx);
        // ⭐ ONBOARDING JE JEDEN KROK. Bez tohohle by technik zavedl tablet,
        //    appka řidiče by na něm nebyla a čekalo by se na NOČNÍ OKNO —
        //    tedy na příští noc u nabíječky. Tablet by mezitím vypadal hotově.
        // ⛔ NA POZADÍ: stahuje z API, na hlavním vlákně by to byl ANR.
        // ⛔ Selhání NEBLOKUJE zavedení: síť technika nemusí na platformu
        //    dosáhnout a servisní režim má přednost před dokonalostí.
        final Context app = ctx.getApplicationContext();
        new Thread(() -> Rozdavani.zkusAktualizovat(app), "hlidac-zavedeni-appky").start();
        n.nastavServis(true);
        for (String r : Politika.zaklad(ctx)) Log.i(TAG, r);
        Planovac.naplanuj(ctx);
    }
}
