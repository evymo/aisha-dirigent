package platforma.hlidac;

import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * PIN technika — jediná cesta z kiosku ven.
 *
 * Na tablet přichází v QR jen OTISK, nikdy PIN: záznam
 * `pbkdf2_sha256$<iterace>$<sůl base64>$<otisk base64>` vyrobí skript
 * `scripts/qr.mjs` (nebo administrace). Kdo QR vyfotí, PIN tím nezná.
 *
 * Čistá Java bez Androidu — testuje se na JVM proti záznamu z Node.
 */
final class Pin {
    static final String DRUH = "pbkdf2_sha256";
    static final int MIN_DELKA = 6;
    /** Méně iterací by u šestimístného PINu byla jen formalita. */
    static final int MIN_ITERACI = 100_000;

    private final int iterace;
    private final byte[] sul;
    private final byte[] otisk;

    private Pin(int iterace, byte[] sul, byte[] otisk) {
        this.iterace = iterace;
        this.sul = sul;
        this.otisk = otisk;
    }

    /** Rozloží záznam; vadný záznam je výjimka — hlídač bez platného PINu kiosk nezamkne. */
    static Pin zeZaznamu(String zaznam) {
        if (zaznam == null) throw new IllegalArgumentException("chybí záznam PINu");
        String[] casti = zaznam.split("\\$");
        if (casti.length != 4 || !DRUH.equals(casti[0])) {
            throw new IllegalArgumentException("neznámý tvar záznamu PINu");
        }
        int iterace = Integer.parseInt(casti[1]);
        if (iterace < MIN_ITERACI) throw new IllegalArgumentException("málo iterací: " + iterace);
        byte[] sul = Base64.getDecoder().decode(casti[2]);
        byte[] otisk = Base64.getDecoder().decode(casti[3]);
        if (sul.length < 16 || otisk.length != 32) throw new IllegalArgumentException("vadná sůl nebo otisk");
        return new Pin(iterace, sul, otisk);
    }

    /** Porovnání v konstantním čase — délka shody se nesmí dát změřit. */
    boolean over(String pin) {
        if (pin == null || pin.length() < MIN_DELKA) return false;
        return MessageDigest.isEqual(otisk, odvod(pin, sul, iterace));
    }

    static byte[] odvod(String pin, byte[] sul, int iterace) {
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), sul, iterace, 256);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (GeneralSecurityException e) {
            // Bez PBKDF2 nejde PIN ověřit vůbec; tvářit se „špatný PIN“ by technika
            // zamklo venku bez vysvětlení.
            throw new IllegalStateException("PBKDF2WithHmacSHA256 není dostupné", e);
        } finally {
            spec.clearPassword();
        }
    }

    /** Pro testy a pro kontrolu tvaru: vyrobí záznam stejně jako skript. */
    static String zaznam(String pin, byte[] sul, int iterace) {
        Base64.Encoder b = Base64.getEncoder();
        return DRUH + "$" + iterace + "$" + b.encodeToString(sul) + "$" + b.encodeToString(odvod(pin, sul, iterace));
    }
}
