# Vzorový overlay pro brány

Smyšlená instance — žádná skutečná data, jména ani adresy. Slouží jako **kladná kotva**
bran, které měří instanční overlay: brána, která nad overlayem „nic nenašla", musí umět
ukázat, že nad overlayem s modulem něco najde.

- `s-money/` — overlay, který nese modul Money: roster agend a zdroj, který na agendu odkazuje.
- `bez-modulu/` — overlay bez modulu Money (má jen zdroj, který agendy nepoužívá).

Čte je `money-agendy-odpovidaji-rosteru.gate.test.ts`. Mutace (rozbitý roster, odkaz na
neznámou agendu, pověření bez rosteru) se dělají v paměti nad těmito vzory, ne dalšími soubory.
