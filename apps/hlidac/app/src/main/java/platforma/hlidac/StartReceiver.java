package platforma.hlidac;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Po startu tabletu a po aktualizaci hlídače: znovu uplatnit politiku
 * (idempotentní) a naplánovat noční okno. Domovskou obrazovku (a s ní
 * kiosk) spustí systém sám.
 */
public class StartReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Politika.jsemSpravce(ctx)) return;
        Nastaveni n = new Nastaveni(ctx);
        n.nastavVOkne(false);
        if (n.servis()) Politika.zaklad(ctx);
        else Politika.zamkni(ctx);
        Planovac.naplanuj(ctx);
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            // Hlídač se právě aktualizoval sám — proces předtím skončil uprostřed
            // rozdávání, takže výsledek zapíše až nová verze.
            n.ulozStavRozdavani(ctx.getString(R.string.roz_hlidac_aktualizovan, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE));
            Rozdavani.predejVybavu(ctx);
        }
        // Po startu i po vlastní aktualizaci: přehled v administraci uvidí novou verzi.
        Hlaseni.odesliNaPozadi(this, ctx);
    }
}
