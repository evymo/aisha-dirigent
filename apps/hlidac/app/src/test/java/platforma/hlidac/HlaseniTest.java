package platforma.hlidac;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.Test;

/**
 * Tělo hlášení musí server přijmout: přesný tvar, stropy délek, žádné řídicí
 * znaky (server by jinak odmítl celé hlášení a přehled by tablet neviděl).
 */
public class HlaseniTest {

    @Test
    public void teloMaPresneTvarKteryServerCte() {
        Map<String, Long> appky = new LinkedHashMap<>();
        appky.put("cz.example.ridic", 15L);
        appky.put("cz.example.jina", -1L);
        String t = Hlaseni.telo("0f8fad5b-d9cb-469f-a165-70867728950e", "samsung SM-X110", "14 (34)",
                "1.5.0", 7, appky, "com.google.android.webview 126.0.6478.110", "kiosk", "28.9. 02:14:03 · hotovo");
        assertEquals("{\"zarizeni\":\"0f8fad5b-d9cb-469f-a165-70867728950e\",\"model\":\"samsung SM-X110\","
                + "\"android\":\"14 (34)\",\"kioskAdmin\":{\"versionName\":\"1.5.0\",\"versionCode\":7},"
                + "\"appky\":[{\"balicek\":\"cz.example.ridic\",\"versionCode\":15},"
                + "{\"balicek\":\"cz.example.jina\",\"versionCode\":-1}],"
                + "\"webview\":\"com.google.android.webview 126.0.6478.110\",\"rezim\":\"kiosk\",\"stav\":\"28.9. 02:14:03 · hotovo\"}", t);
    }

    @Test
    public void chybejiciWebViewAStavJsouNullAPrazdno() {
        String t = Hlaseni.telo("id", "m", "a", "1", 1, new LinkedHashMap<>(), null, "servis", null);
        assertTrue(t.contains("\"webview\":null"));
        assertTrue(t.contains("\"appky\":[]"));
        assertTrue(t.contains("\"stav\":\"\""));
    }

    @Test
    public void textSeEscapujeZkratiAZbaviRidicichZnaku() {
        assertEquals("\"a\\\"b\\\\c\"", Hlaseni.text("a\"b\\c", 100));
        assertEquals("\"ab\"", Hlaseni.text("abcdef", 2));
        String s = Hlaseni.text("řádek\nřádek\tkonec", 100);
        assertFalse(s.contains("\n"));
        assertFalse(s.contains("\t"));
        // Strop stavu je týž jako na serveru.
        assertEquals(Hlaseni.MAX_STAV + 2, Hlaseni.text("x".repeat(1000), Hlaseni.MAX_STAV).length());
    }

    @Test
    public void verzePodMinusJednaSeHlasiJakoChybi() {
        Map<String, Long> appky = new LinkedHashMap<>();
        appky.put("cz.example.ridic", -5L);
        assertTrue(Hlaseni.telo("id", "m", "a", "1", 1, appky, null, "kiosk", "").contains("\"versionCode\":-1}"));
    }
}
