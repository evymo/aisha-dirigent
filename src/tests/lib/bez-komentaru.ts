/**
 * Zabělení komentářů v JS/TS zdroji — POSUNY A ŘÁDKY ZŮSTÁVAJÍ PLATNÉ.
 *
 * ⛔ PROČ VZNIKLO (naměřeno 2026-09-02): brána `xss-client-storage` ohlásila
 * `PageRenderer.tsx:334` jako nesanitizované `dangerouslySetInnerHTML`.
 * Na tom řádku ale žádné volání není — je tam KOMENTÁŘ, který vysvětluje,
 * proč jsou portály nad takto vytvořenými uzly bezpečné. Brána tedy četla
 * prózu jako kód.
 *
 * Svůdná „oprava" je přepsat komentář, aby v něm to slovo nebylo. Tím se ale
 * vada neodstraní, jen schová: příští autor, který napíše poctivé vysvětlení,
 * dostane týž falešný nález. Proto se opravuje PARSER.
 *
 * Existující `stripCommentsAndStrings` (owasp-discovery) se nehodí — text
 * MAŽE, takže čísla řádků v hlášení přestanou sedět. Zdejší varianta nahrazuje
 * obsah komentářů mezerami: délka i rozložení řádků jsou zachovány, takže
 * `substring(0, index).split("\n").length` dál ukazuje na správný řádek.
 *
 * ROZSAH: řetězce (', ", `) a regulární literály se přeskakují, aby
 * `"https://…"` ani `/^https?:\/\//` nezačaly vypadat jako řádkový komentář.
 * Komentář uvnitř `${…}` v šablonovém řetězci se nerozpozná — je to
 * patologický případ, který se v tomto zdrojovém stromu nevyskytuje.
 */
export function zdrojBezKomentaru(zdroj: string): string {
  const znaky = [...zdroj];
  let i = 0;

  /** Poslední významný znak před `i` — rozhoduje `/` = dělení, nebo regulární literál. */
  const predchoziVyznamny = (od: number): string => {
    for (let j = od - 1; j >= 0; j--) {
      if (!/\s/.test(znaky[j])) return znaky[j];
    }
    return "";
  };

  const zabel = (od: number, do_: number) => {
    for (let j = od; j < do_ && j < znaky.length; j++) {
      if (znaky[j] !== "\n") znaky[j] = " ";
    }
  };

  while (i < znaky.length) {
    const z = znaky[i];

    // Řetězcový literál — přeskočit vcelku.
    if (z === '"' || z === "'" || z === "`") {
      let j = i + 1;
      while (j < znaky.length && znaky[j] !== z) {
        if (znaky[j] === "\\") j++;
        j++;
      }
      i = j + 1;
      continue;
    }

    if (z === "/") {
      const dalsi = znaky[i + 1];

      if (dalsi === "/") {
        let konec = i;
        while (konec < znaky.length && znaky[konec] !== "\n") konec++;
        zabel(i, konec);
        i = konec;
        continue;
      }

      if (dalsi === "*") {
        let konec = i + 2;
        while (konec < znaky.length && !(znaky[konec] === "*" && znaky[konec + 1] === "/")) konec++;
        zabel(i, Math.min(konec + 2, znaky.length));
        i = konec + 2;
        continue;
      }

      // Regulární literál: `/…/`. Pozná se podle toho, co mu předchází —
      // po hodnotě je `/` dělení, po operátoru nebo otevírací závorce literál.
      // Bez tohoto rozlišení by `/^https?:\/\//` skončil dvěma lomítky za
      // sebou a zbytek řádku by se zabělil jako komentář.
      if (/^[([{=,:;!&|?+\-*%~^<>]$/.test(predchoziVyznamny(i)) || predchoziVyznamny(i) === "") {
        let j = i + 1;
        let vTride = false;
        while (j < znaky.length && znaky[j] !== "\n") {
          if (znaky[j] === "\\") j += 2;
          else if (znaky[j] === "[") {
            vTride = true;
            j++;
          } else if (znaky[j] === "]") {
            vTride = false;
            j++;
          }
          else if (znaky[j] === "/" && !vTride) break;
          else j++;
        }
        i = j + 1;
        continue;
      }
    }

    i++;
  }

  return znaky.join("");
}

// Zabělení komentářů v SQL — POSUNY A ŘÁDKY ZŮSTÁVAJÍ PLATNÉ.
//
// ⛔ TŘETÍ VÝSKYT TÉŽE TŘÍDY (naměřeno 2026-09-03). Brána `owasp-discovery`
// označila `get_block_data.sql` jako „SECURITY DEFINER bez SET search_path",
// ačkoli ta funkce je `security invoker`. Spustil to KOMENTÁŘ, který
// vysvětluje, proč restricted blok nesmí brát parametry od klienta:
// „…nad SECURITY DEFINER zdrojem by `columns` znamenaly čtení napříč RLS."
//
// Předtím padly ze stejného důvodu `xss-client-storage` a `auth-security` —
// ty ale četly JS/TS a stačilo jim `zdrojBezKomentaru`. SQL má komentáře
// jiné: `--` do konce řádku a `/* */`. K tomu apostrofové řetězce (kde se
// apostrof zdvojuje) a dolarové uvozování `$tag$ … $tag$`.
//
// POZN.: popis je v ŘÁDKOVÝCH komentářích schválně — v blokovém by musel
// obsahovat `*/`, což by ho ukončilo uprostřed věty, a obejít to neviditelnou
// mezerou znamená chybu `no-irregular-whitespace`. Dnes potřetí.
export function sqlBezKomentaru(zdroj: string): string {
  const znaky = [...zdroj];
  let i = 0;

  const zabel = (od: number, do_: number) => {
    for (let j = od; j < do_ && j < znaky.length; j++) {
      if (znaky[j] !== "\n") znaky[j] = " ";
    }
  };

  while (i < znaky.length) {
    const z = znaky[i];

    // ⛔ TĚLO V DOLAROVÝCH UVOZOVKÁCH JE KÓD, NE ŘETĚZEC (naměřeno 2026-09-03).
    //
    // Podle SQL je `$tag$ … $tag$` řetězcový literál, takže první verze ho
    // přeskakovala celý. Jenže právě v něm žije tělo PL/pgSQL funkce — a s ním
    // komentáře, kvůli kterým tahle pomůcka vznikla: `get_block_data.sql` má
    // vysvětlení „…nad SECURITY DEFINER zdrojem…" UVNITŘ těla, takže přeskočení
    // vadu nechalo být. Do těla se proto vstupuje a komentáře se v něm zabělí
    // stejně jako venku; ohraničení zůstává.
    if (z === "$") {
      const zbytek = zdroj.slice(i);
      const znacka = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(zbytek);
      if (znacka) {
        const zacatekTela = i + znacka[0].length;
        const konec = zdroj.indexOf(znacka[0], zacatekTela);
        if (konec === -1) {
          i = znaky.length;
        } else {
          const telo = sqlBezKomentaru(zdroj.slice(zacatekTela, konec));
          for (let j = 0; j < telo.length; j++) znaky[zacatekTela + j] = telo[j];
          i = konec + znacka[0].length;
        }
        continue;
      }
    }

    // Apostrofový řetězec; '' uvnitř je escapovaný apostrof, ne konec.
    if (z === "'") {
      let j = i + 1;
      while (j < znaky.length) {
        if (znaky[j] === "'" && znaky[j + 1] === "'") j += 2;
        else if (znaky[j] === "'") break;
        else j++;
      }
      i = j + 1;
      continue;
    }

    if (z === "-" && znaky[i + 1] === "-") {
      let konec = i;
      while (konec < znaky.length && znaky[konec] !== "\n") konec++;
      zabel(i, konec);
      i = konec;
      continue;
    }

    if (z === "/" && znaky[i + 1] === "*") {
      let konec = i + 2;
      while (konec < znaky.length && !(znaky[konec] === "*" && znaky[konec + 1] === "/")) konec++;
      zabel(i, Math.min(konec + 2, znaky.length));
      i = konec + 2;
      continue;
    }

    i++;
  }

  return znaky.join("");
}
