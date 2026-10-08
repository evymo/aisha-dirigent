// Fixture brány testy-uklidi-docasne-adresare: soubor, jehož VŠECHNY testy jsou
// přeskočené. Vitest mu spustí setupFiles (vznikne adresář souboru), ale ne hooky —
// `afterAll` úklidu po souborech tu neproběhne a adresář musí smazat kořen běhu.
import { test } from "vitest";

test.skip("nikdy neběží", () => {});
