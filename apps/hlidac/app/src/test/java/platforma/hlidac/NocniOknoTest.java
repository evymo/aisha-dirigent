package platforma.hlidac;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import org.junit.Test;

public class NocniOknoTest {
    private static final ZoneId PRAHA = ZoneId.of("Europe/Prague");

    @Test
    public void vychoziOknoJeVNoci() {
        NocniOkno o = NocniOkno.parse(NocniOkno.VYCHOZI);
        assertTrue(o.obsahuje(LocalTime.of(2, 0)));
        assertTrue(o.obsahuje(LocalTime.of(3, 59)));
        assertFalse(o.obsahuje(LocalTime.of(4, 0)));
        assertFalse(o.obsahuje(LocalTime.of(14, 0)));
        assertEquals(120, o.zacatekMinut());
        assertEquals(240, o.konecMinut());
    }

    @Test
    public void oknoPresPulnoc() {
        NocniOkno o = NocniOkno.parse("23:30-01:00");
        assertTrue(o.obsahuje(LocalTime.of(23, 45)));
        assertTrue(o.obsahuje(LocalTime.of(0, 30)));
        assertFalse(o.obsahuje(LocalTime.of(1, 0)));
        assertFalse(o.obsahuje(LocalTime.of(12, 0)));
    }

    @Test
    public void pristiVyskytJeVzdyVBudoucnu() {
        ZonedDateTime vecer = ZonedDateTime.of(2026, 9, 18, 21, 0, 0, 0, PRAHA);
        assertEquals(ZonedDateTime.of(2026, 9, 19, 2, 0, 0, 0, PRAHA), NocniOkno.pristi(vecer, LocalTime.of(2, 0)));
        ZonedDateTime rano = ZonedDateTime.of(2026, 9, 18, 1, 0, 0, 0, PRAHA);
        assertEquals(ZonedDateTime.of(2026, 9, 18, 2, 0, 0, 0, PRAHA), NocniOkno.pristi(rano, LocalTime.of(2, 0)));
        // Přesně v okamžiku začátku se plánuje až další den — jinak by budík zvonil pořád dokola.
        ZonedDateTime presne = ZonedDateTime.of(2026, 9, 18, 2, 0, 0, 0, PRAHA);
        assertEquals(presne.plusDays(1), NocniOkno.pristi(presne, LocalTime.of(2, 0)));
    }

    @Test
    public void vadnyZapisSeOdmitne() {
        assertThrows(IllegalArgumentException.class, () -> NocniOkno.parse("02:00"));
        assertThrows(IllegalArgumentException.class, () -> NocniOkno.parse("02:00-02:00"));
        assertThrows(RuntimeException.class, () -> NocniOkno.parse("25:00-26:00"));
    }
}
