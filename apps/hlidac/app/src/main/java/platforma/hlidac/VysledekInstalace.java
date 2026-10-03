package platforma.hlidac;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

/**
 * Výsledek tiché instalace. Hlídač na něj nečeká — ale MLČET NESMÍ: instalace,
 * která se nepovedla a nikde to neřekla, vypadá jako appka, co se „neaktualizovala
 * sama", a hledá se pak úplně jinde.
 *
 * ⛔ NESTAČÍ LOG (2026-09-22): hlídač sám zakazuje ladění, takže log na tabletu
 *    nikdo nepřečte. Výsledek jde do servisního panelu i s hláškou Androidu
 *    (např. `INSTALL_FAILED_NO_MATCHING_ABIS`) — podle ní se dá jednat.
 */
public final class VysledekInstalace extends BroadcastReceiver {
    private static final String TAG = "hlidac.instalace";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        int stav = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String zprava = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        String balicek = intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME);
        if (balicek == null) balicek = "?";
        Nastaveni n = new Nastaveni(ctx);
        if (stav == PackageInstaller.STATUS_SUCCESS) {
            Log.i(TAG, "balíček nainstalován");
            n.ulozStavRozdavani(ctx.getString(R.string.roz_nainstalovano, balicek));
            // ⭐ Teprve TEĎ appka existuje — výbava se jí předá až sem. Předání hned
            //    po odeslání balíčku by mohlo přijít dřív, než instalace doběhne.
            Rozdavani.predejVybavu(ctx);
            Hlaseni.odesliNaPozadi(this, ctx);
            return;
        }
        if (stav == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Device owner instaluje tiše; kdyby si Android přesto řekl o potvrzení,
            // technik je u tabletu (servis) — ukážeme mu ho, místo abychom mlčeli.
            n.ulozStavRozdavani(ctx.getString(R.string.roz_ceka_potvrzeni, balicek));
            // Typová varianta je až od Androidu 13; hlídač běží od 11.
            @SuppressWarnings("deprecation")
            Intent potvrzeni = android.os.Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                : (Intent) intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (potvrzeni != null) {
                potvrzeni.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    ctx.startActivity(potvrzeni);
                } catch (RuntimeException e) {
                    Log.w(TAG, "potvrzení instalace nejde ukázat: " + e.getMessage());
                }
            }
            return;
        }
        Log.e(TAG, "instalace NEPROŠLA (stav " + stav + "): " + zprava);
        n.ulozStavRozdavani(ctx.getString(R.string.roz_instalace_chyba, balicek, stav, String.valueOf(zprava)));
        // Neprošlá instalace je přesně to, co má přehled v administraci ukázat.
        Hlaseni.odesliNaPozadi(this, ctx);
    }
}
