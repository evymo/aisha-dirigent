/**
 * CO SE PŘEDÁVÁ — jedno místo, které z kroku vyčte popis dodávky.
 *
 * Vzniklo vytažením uzávěry z `app/kroky.tsx`: tatáž sada údajů se kreslí na
 * TŘECH místech (hlavička kroku, karta „Náklad a doklad", podpisový modál)
 * a jako uzávěra nešla změřit. Vrací POPISKOVÉ KLÍČE, ne přeložený text —
 * překlad patří obrazovce, tenhle modul má být testovatelný bez i18n.
 *
 * ⛔ NAMĚŘENO NA PRODUKCI 2026-09-01 (24 708 kroků předání): `counterparty`
 *    nese 24 706, `delivery_address` 24 702, `vehicle_registration` 22 736 —
 *    a řidičova obrazovka z toho nekreslila ANI JEDNO. Číst ty hodnoty uměl
 *    jen podpisový modál, takže zákazníka a adresu viděl PŘEBÍRAJÍCÍ, ale ne
 *    řidič, který tam jede. Pravidlo `expedice-dodaciho-listu` je přitom do
 *    subjektu dává výslovně proto, aby vidět byly: „bez nich páska ukazuje
 *    ‚kam‘ a ‚co‘, ale ne ‚čím a s kým‘".
 */

/** Minimální tvar kroku, který tenhle modul potřebuje. */
export interface ZdrojUdaju {
  batch_code: string | null;
  input_data: Record<string, unknown> | null;
}

/** Jeden řádek popisu — popisek je KLÍČ, hodnota už je text z dokladu. */
export interface UdajDokladu {
  labelKey: string;
  value: string | null;
}

/** Neprázdný osekaný text, jinak `null`. Prázdné se nekreslí (JAZYK-03). */
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * ČÍSLO DOKLADU, jak ho člověk zná z papíru.
 *
 * ⛔ IDENTITA BĚHU NENÍ ČÍSLO DOKLADU. `batch_code` je `run_code`, u dodáků
 *    `expedice:<Money ID>` — u 12 496 z 24 708 kroků tedy tvaru
 *    `expedice:95f866a9-d8fd-4930-…`. To UUID je tam SPRÁVNĚ: pravidlo klíčuje
 *    běh Money ID vědomě, protože číslo dokladu není jedinečné (změřeno na
 *    20 592 dokladech: 354 sdílí číslo s jiným, `DLK220016` nese 15 dokladů,
 *    u 303 se liší vyřízenost — klíčovat číslem znamená slít dvě dodávky do
 *    jedné a jednu z fronty ztratit). Money ID má 0 kolizí.
 *
 * ⭐ Jsou to tedy DVĚ RŮZNÉ VĚCI a obojí je správně; obrazovka jen ukazovala
 *    tu strojovou. Řidič u rampy potřebuje `dl_number` — to, co má na papíře.
 *    `batch_code` zůstává pro kroky, které dokladem nevznikly (odečet
 *    měřidla), ne jako výplň za chybějící hodnotu.
 */
export function cisloDokladu(step: ZdrojUdaju): string | null {
  return text(step.input_data?.dl_number) ?? text(step.batch_code);
}

/**
 * Popis dodávky pro člověka — doklad, komu, kam, čím.
 *
 * ⛔ „CO" TU NENÍ, A JE TO ZÁMĚR. Bývalo plněné `product_name`, tedy
 *    `subject_label` pravidla (`{counterparty} — {dn_number}`). Ta hodnota je
 *    správná a užitečná jako POPIS BĚHU, ale pod popiskem „Co" tvrdila, že je
 *    to předmět dodávky — přebírající tak nad podpisem četl jako CO přebírá
 *    jméno své vlastní firmy, vedle řádku „Odběratel" s toutéž firmou.
 *
 * ⛔ MATERIÁL A MNOŽSTVÍ V APPCE ZATÍM NEJSOU. Jsou to `line_items` dokladu
 *    a do kroku se dostanou UKAZATELEM `doc_slug`, ne opsáním — kopie by
 *    zestárla a registr zná `superseded_by`, kopie ne. Do té doby to pole
 *    nemá co ukazovat; prázdné je poctivější než nepravda.
 */
export function coSePredava(step: ZdrojUdaju): UdajDokladu[] {
  const d = step.input_data;
  return [
    { labelKey: "workflow.step.doc", value: cisloDokladu(step) },
    { labelKey: "handover.moment.komu", value: text(d?.counterparty) },
    { labelKey: "handover.moment.kam", value: text(d?.delivery_address) },
    { labelKey: "handover.moment.vozidlo", value: text(d?.vehicle_registration) },
  ];
}

/** Jen vyplněné řádky — volající nemá filtrovat, aby to nedělal každý jinak. */
export function coSePredavaVyplnene(step: ZdrojUdaju): UdajDokladu[] {
  return coSePredava(step).filter((u) => u.value !== null);
}

/**
 * PODTITUL KROKU v seznamu a na pásce — číslo dokladu a komu, jedním řádkem.
 *
 * ⛔ Stálo tam `batch_code · product_name`, tedy `expedice:95f866a9-… · Doprastav,
 *    a.s. — DLP2602167`: strojový klíč běhu napřed a číslo dokladu podruhé
 *    (`product_name` je `subject_label` pravidla, `{counterparty} — {dn_number}`).
 *    Detail kroku to opravil 2026-09-01; seznam, hotové a páska zůstaly.
 *
 * ⭐ Komu = `counterparty` z předmětu běhu. Bez něj se vezme `product_name`, a když
 *    už číslo dokladu obsahuje, stojí sám — jinak by se číslo četlo dvakrát.
 */
export function podtitulKroku(step: ZdrojUdaju & { product_name?: string | null }): string {
  const doklad = cisloDokladu(step);
  const komu = text(step.input_data?.counterparty);
  if (komu) return [doklad, komu].filter(Boolean).join(" · ");
  const popis = text(step.product_name);
  if (popis && doklad && popis.includes(doklad)) return popis;
  return [doklad, popis].filter(Boolean).join(" · ");
}
