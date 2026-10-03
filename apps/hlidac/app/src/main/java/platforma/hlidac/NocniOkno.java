package platforma.hlidac;

import java.time.LocalTime;
import java.time.ZonedDateTime;

/**
 * Noční okno pro aktualizace z Obchodu Play.
 *
 * ⭐ PROČ: aplikace v kiosku je pořád v popředí, a Obchod Play aplikaci
 * v popředí neaktualizuje (bez EMM okna, které Play dává jen registrovaným
 * EMM). Bez tohohle okna by na tabletu zůstala první nainstalovaná verze
 * navždy. Hlídač proto v noci, když se tablet nabíjí, odsune aplikaci do
 * pozadí a po okně ji zase spustí.
 *
 * Zápis `HH:MM-HH:MM`; okno smí přecházet přes půlnoc. Čistá Java.
 */
final class NocniOkno {
    static final String VYCHOZI = "02:00-04:00";

    final LocalTime zacatek;
    final LocalTime konec;

    private NocniOkno(LocalTime zacatek, LocalTime konec) {
        this.zacatek = zacatek;
        this.konec = konec;
    }

    static NocniOkno parse(String zapis) {
        String[] casti = zapis == null ? new String[0] : zapis.trim().split("-");
        if (casti.length != 2) throw new IllegalArgumentException("okno musí být HH:MM-HH:MM, bylo: " + zapis);
        LocalTime z = LocalTime.parse(casti[0].trim());
        LocalTime k = LocalTime.parse(casti[1].trim());
        if (z.equals(k)) throw new IllegalArgumentException("okno má nulovou délku");
        return new NocniOkno(z, k);
    }

    boolean obsahuje(LocalTime cas) {
        if (zacatek.isBefore(konec)) return !cas.isBefore(zacatek) && cas.isBefore(konec);
        return !cas.isBefore(zacatek) || cas.isBefore(konec); // přes půlnoc
    }

    /** Nejbližší budoucí výskyt času `t` (dnes, nebo zítra). */
    static ZonedDateTime pristi(ZonedDateTime ted, LocalTime t) {
        ZonedDateTime dnes = ted.with(t).withSecond(0).withNano(0);
        return dnes.isAfter(ted) ? dnes : dnes.plusDays(1);
    }

    /** Minuty od půlnoci — tvar, který chce SystemUpdatePolicy. */
    int zacatekMinut() {
        return zacatek.getHour() * 60 + zacatek.getMinute();
    }

    int konecMinut() {
        return konec.getHour() * 60 + konec.getMinute();
    }

    @Override
    public String toString() {
        return zacatek + "-" + konec;
    }
}
