/**
 * Návrat do appky = čerstvá data. Proč to nefunguje samo.
 *
 * ⛔ NAMĚŘENO 2026-08-20: React Query má `refetchOnWindowFocus` ZAPNUTÉ, ale
 * v React Native NENÍ ŽÁDNÉ OKNO, které by ohnisko hlásilo — `focusManager`
 * proto nikdy nedostane zprávu a to nastavení je celou dobu naprázdno.
 * V repu se `focusManager` nevyskytoval ani jednou.
 *
 * ⛔ CO TO DĚLÁ ŘIDIČI. Ráno si na dvoře otevře seznam, zamkne telefon, jede
 * čtyřicet minut. U odběratele odemkne — a vidí, co bylo ráno. `staleTime` je
 * pět minut, takže data STARÁ JSOU; jen je nikdo nešel obnovit. Řidič odbaví
 * dodávku podle zrušeného zadání a pozná to až telefonátem.
 *
 * ⚠️ NENÍ TO POLLING. Nic se neptá na pozadí a baterie tím netrpí: jen se
 * v okamžiku návratu řekne „ohnisko je zpátky" a React Query dotáhne to, co je
 * podle svých vlastních pravidel staré. Co je čerstvé, se nesahá.
 *
 * @module
 */
import { useEffect } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { focusManager } from "@tanstack/react-query";

/**
 * Je appka doopravdy v popředí?
 *
 * ⛔ JEN `active`. iOS hlásí `inactive` při přepínači úloh, při příchozím hovoru
 * a při staženém oznamovacím panelu — tam člověk na appku nekouká a obnova by
 * jen pálila data. Android navíc přidává `background`. Vlastní funkce proto, že
 * je to tvrzení o cizí platformě, a to se má dát změřit.
 */
export function jeVPopredi(status: AppStateStatus): boolean {
  return status === "active";
}

/**
 * Napojit ohnisko na životní cyklus appky. Volá se JEDNOU, v kořenu.
 *
 * ⚠️ Na webu se nezapojuje: tam okno existuje a React Query si ohnisko hlídá
 * sám — dvě strany téhož tvrzení by se jen přebíjely.
 */
export function useObnovaPriNavratu(): void {
  useEffect(() => {
    if (Platform.OS === "web") return;
    const odber = AppState.addEventListener("change", (status) => {
      focusManager.setFocused(jeVPopredi(status));
    });
    return () => odber.remove();
  }, []);
}
