package platforma.hlidac;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import java.time.ZonedDateTime;

/**
 * Budíky nočního okna. Nepřesné (`setAndAllowWhileIdle`): přesné budíky
 * potřebují zvláštní oprávnění a na pár minutách tu nezáleží.
 */
final class Planovac {
    static final String ZACATEK = "platforma.hlidac.OKNO_ZACATEK";
    static final String KONEC = "platforma.hlidac.OKNO_KONEC";

    private Planovac() {}

    static void naplanuj(Context ctx) {
        NocniOkno okno = new Nastaveni(ctx).okno();
        ZonedDateTime ted = ZonedDateTime.now();
        budik(ctx, ZACATEK, NocniOkno.pristi(ted, okno.zacatek), 1);
        budik(ctx, KONEC, NocniOkno.pristi(ted, okno.konec), 2);
    }

    private static void budik(Context ctx, String akce, ZonedDateTime kdy, int kod) {
        Intent i = new Intent(ctx, OknoReceiver.class).setAction(akce);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, kod, i,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        ctx.getSystemService(AlarmManager.class)
            .setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, kdy.toInstant().toEpochMilli(), pi);
    }
}
