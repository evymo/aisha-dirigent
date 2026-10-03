package platforma.hlidac;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.BatteryManager;

/**
 * Začátek okna: když se tablet nabíjí, hlídač se postaví do popředí a kiosková
 * aplikace jde do pozadí — teprve tam ji Obchod Play smí aktualizovat.
 * Konec okna: hlídač aplikaci zase spustí.
 *
 * Bez nabíjení se okno přeskočí: tablet, který se nenabíjí, je nejspíš ve voze
 * a řidič ho může potřebovat.
 */
public class OknoReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Nastaveni n = new Nastaveni(ctx);
        Planovac.naplanuj(ctx);
        if (!Politika.jsemSpravce(ctx) || n.servis()) return;

        if (Planovac.ZACATEK.equals(intent.getAction())) {
            if (!ctx.getSystemService(BatteryManager.class).isCharging()) return;
            n.nastavVOkne(true);
            // Řízená konfigurace se obnovuje s každým oknem: appka mohla být
            // mezitím přeinstalovaná a restrikce by po ní nezůstaly.
            Rozdavani.predejVybavu(ctx);
            // ⛔ Stahování NESMÍ na hlavní vlákno receiveru — ANR. Okno trvá
            //    hodiny, takže na dokončení nikdo nečeká; výsledek jde do logu.
            final android.content.Context app = ctx.getApplicationContext();
            new Thread(() -> Rozdavani.zkusAktualizovat(app), "hlidac-aktualizace").start();
        } else if (Planovac.KONEC.equals(intent.getAction())) {
            if (!n.vOkne()) return;
            n.nastavVOkne(false);
        } else {
            return;
        }
        // Device owner smí spustit aktivitu z pozadí.
        ctx.startActivity(new Intent(ctx, DomovActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
    }
}
