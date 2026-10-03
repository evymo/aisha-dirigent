package platforma.hlidac;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** PIN technika: záznam z Node (scripts/qr.mjs) musí Java ověřit — jinak technik z kiosku neodejde. */
public class PinTest {
    /** Vyrobeno `crypto.pbkdf2Sync("482915", 00112233…eeff, 100000, 32, "sha256")` v Node. */
    private static final String Z_NODE =
        "pbkdf2_sha256$100000$ABEiM0RVZneImaq7zN3u/w==$lXicz2eTouSl5ISTomYpPagp2SGheK85nUeMCJ3hxrc=";

    @Test
    public void zaznamZNodeSeOveri() {
        assertTrue(Pin.zeZaznamu(Z_NODE).over("482915"));
    }

    @Test
    public void spatnyPinNeprojde() {
        Pin p = Pin.zeZaznamu(Z_NODE);
        assertFalse(p.over("482914"));
        assertFalse(p.over(""));
        assertFalse(p.over(null));
    }

    @Test
    public void javaVyrobiTentyzZaznamJakoNode() {
        byte[] sul = new byte[16];
        for (int i = 0; i < 16; i++) sul[i] = (byte) (i * 0x11);
        assertEquals(Z_NODE, Pin.zaznam("482915", sul, 100_000));
    }

    @Test
    public void slabyNeboCiziZaznamSeOdmitne() {
        assertThrows(IllegalArgumentException.class, () -> Pin.zeZaznamu(null));
        assertThrows(IllegalArgumentException.class, () -> Pin.zeZaznamu("sha1$1$a$b"));
        assertThrows(IllegalArgumentException.class,
            () -> Pin.zeZaznamu(Z_NODE.replace("$100000$", "$1000$")));
    }
}
