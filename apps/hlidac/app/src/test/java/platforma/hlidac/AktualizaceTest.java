package platforma.hlidac;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.fail;

import java.io.IOException;
import org.junit.Test;

/**
 * Měří dvě místa, na kterých stahování po částech stojí: čí je rozpracovaný
 * soubor, a kolik toho vlastně je.
 */
public class AktualizaceTest {

    @Test
    public void rozpracovanySouborPatriJEDNOMUotisku() {
        String ridic = "0b64b3e2d7fa39e5d9ea4cee68b9ea4a6b5f57a3fe213783d0820a998bb9b1e4";
        String hlidac = "4a16ee5fad68ab509c7983e86198f30872c2767d46cdce480c1dfc8103811aa7";
        // Hlídač stahuje sebe i Řidiče toutéž cestou a navazuje podle délky
        // souboru. Společné jméno = zbytek jednoho balíčku přilepený k druhému.
        assertNotEquals(
                Aktualizace.jmenoRozpracovaneho(ridic), Aktualizace.jmenoRozpracovaneho(hlidac));
    }

    @Test
    public void jmenoJeStejneProTYZotisk() {
        // Navazování stojí na tom, že druhý pokus najde soubor prvního.
        String s = "4a16ee5fad68ab509c7983e86198f30872c2767d46cdce480c1dfc8103811aa7";
        assertEquals(Aktualizace.jmenoRozpracovaneho(s), Aktualizace.jmenoRozpracovaneho(s.toUpperCase()));
    }

    @Test
    public void celkovaVelikostSeCteZContentRange() throws IOException {
        assertEquals(52114578L, Aktualizace.celkemZHlavicky("bytes 0-1048575/52114578"));
        assertEquals(58144L, Aktualizace.celkemZHlavicky("bytes 8388608-16777215/58144"));
    }

    @Test
    public void meridloUmiRictNE() {
        // Bez Content-Range nevíme, kolik toho je — a „nevíme" není nula.
        for (String vadne : new String[] {null, "bytes 0-1023", "bytes 0-1023/*"}) {
            try {
                Aktualizace.celkemZHlavicky(vadne);
                fail("mělo selhat pro: " + vadne);
            } catch (IOException ocekavane) {
                // správně
            }
        }
    }

    @Test
    public void kusRosteNaRychleLinceAKlesaNaPomale() {
        // LTE: 1 MB za půl sekundy → zdvojovat až ke stropu; 52 MB pak ~10 požadavků.
        int kus = Aktualizace.KUS;
        for (int i = 0; i < 10; i++) kus = Aktualizace.dalsiKus(kus, 500);
        assertEquals(Aktualizace.KUS_MAX, kus);
        // Slabý signál: kus se zmenšuje, ale nikdy pod minimum.
        for (int i = 0; i < 10; i++) kus = Aktualizace.dalsiKus(kus, 30_000);
        assertEquals(Aktualizace.KUS_MIN, kus);
        // Uprostřed pásma se nemění.
        assertEquals(Aktualizace.KUS, Aktualizace.dalsiKus(Aktualizace.KUS, 10_000));
    }

    @Test
    public void nejvetsiKusSeVejdeDoStropuCestyIPriHranicniRychlosti() {
        // Kus se zdvojí jen po kusu kratším než RYCHLY_KUS_MS. Dvojnásobek pak
        // trvá nejvýš 2× tolik — hluboko pod stropem cesty ~60 s.
        assertEquals(true, 2 * Aktualizace.RYCHLY_KUS_MS < 60_000);
        assertEquals(true, Aktualizace.POMALY_KUS_MS < 60_000);
    }

    @Test
    public void cekaniNaPretizenyServerJeZRetryAfterAVzdyPodStropem() {
        assertEquals(60_000L, Aktualizace.cekaniMs("60"));
        assertEquals(Aktualizace.CEKANI_STROP_MS, Aktualizace.cekaniMs("3600"));
        assertEquals(1_000L, Aktualizace.cekaniMs("0"));
        // Bez hlavičky nebo s datem (hodiny tabletu nemusí sedět) = výchozí.
        assertEquals(Aktualizace.CEKANI_VYCHOZI_MS, Aktualizace.cekaniMs(null));
        assertEquals(Aktualizace.CEKANI_VYCHOZI_MS, Aktualizace.cekaniMs("Wed, 21 Oct 2026 07:28:00 GMT"));
    }

    @Test
    public void uklidPoznaJenRozpracovaneSoubory() {
        String s = "4a16ee5fad68ab509c7983e86198f30872c2767d46cdce480c1dfc8103811aa7";
        assertEquals(true, Aktualizace.jeRozpracovany(Aktualizace.jmenoRozpracovaneho(s)));
        assertEquals(false, Aktualizace.jeRozpracovany("nastaveni.xml"));
        assertEquals(false, Aktualizace.jeRozpracovany("aktualizace-poznamka.txt"));
    }

    @Test
    public void velikostSeCteIZOdpovedi416() throws IOException {
        // 416 = požadavek za koncem souboru; celek je na disku a rozhodne otisk.
        assertEquals(52114514L, Aktualizace.celkemZHlavicky("bytes */52114514"));
    }
}
