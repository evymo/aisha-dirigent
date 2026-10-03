package platforma.hlidac;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.After;
import org.junit.Test;

/** Jedno rozdávání naráz a hlídač vždy poslední. */
public class RozdavaniTest {

    @After
    public void uklid() {
        Rozdavani.uvolni();
    }

    @Test
    public void druheRozdavaniSeNespustiDokudPrvniBezi() {
        // Zavedení volají dvě místa (PolicyCompliance i PROVISIONING_COMPLETE):
        // dvě vlákna by stahovala do téhož souboru a otisk by nesedl.
        assertTrue(Rozdavani.zaber());
        assertFalse(Rozdavani.zaber());
        assertTrue(Rozdavani.bezi());
        Rozdavani.uvolni();
        assertTrue(Rozdavani.zaber());
    }

    @Test
    public void hlidacJdeVzdyPosledni() {
        // Instalace sebe sama ukončí proces — appky musí být hotové předtím.
        assertEquals(Arrays.asList(1, 2, 0),
                Rozdavani.poradi(Arrays.asList("cz.riq.hlidac", "cz.riq.ridic", "cz.riq.jina"), "cz.riq.hlidac"));
        assertEquals(Arrays.asList(0, 1),
                Rozdavani.poradi(Arrays.asList("cz.riq.ridic", "cz.riq.hlidac"), "cz.riq.hlidac"));
        assertEquals(Arrays.asList(0),
                Rozdavani.poradi(Arrays.asList("cz.riq.ridic"), "cz.riq.hlidac"));
    }

    @Test
    public void vlastniAktualizacePockaNaDokonceniOdeslanychInstalaci() {
        // Instalace je asynchronní; hlídač se smí nahradit až po ní (2026-09-28:
        // jinak Android ukončí proces a Řidič se nenainstaluje).
        int[] dotazu = {0};
        java.util.List<Long> spanky = new java.util.ArrayList<>();
        assertTrue(Rozdavani.pockej(() -> ++dotazu[0] >= 3, 10, 2_000, spanky::add));
        assertEquals(3, dotazu[0]);
        assertEquals(Arrays.asList(2_000L, 2_000L), spanky);
    }

    @Test
    public void kdyzInstalaceNedobehneVlastniAktualizaceSeOdlozi() {
        java.util.List<Long> spanky = new java.util.ArrayList<>();
        assertFalse(Rozdavani.pockej(() -> false, 5, 2_000, spanky::add));
        assertEquals(5, spanky.size());
        // Přerušení = nehotovo, ne výjimka.
        assertFalse(Rozdavani.pockej(() -> false, 5, 2_000, ms -> { throw new InterruptedException(); }));
        Thread.interrupted(); // uklidit příznak pro další testy
    }
}
