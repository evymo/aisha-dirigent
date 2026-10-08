# docker-compose.coolify-accel-embed-2.yml — embedder 2 společné lane (operátor GPU uzlu)

> Prose k [docker-compose.coolify-accel-embed-2.yml](../../docker-compose.coolify-accel-embed-2.yml).
> Compose soubor se posílá na server jako argument příkazové řádky a soupeří
> s ARG_MAX — vysvětlení proto žijí tady.

## Proč tahle aplikace existuje

Druhý embedder, protože každý nájemce má vlastní engine (O-4, rozhodnutí majitele 2026-10-05). `gpu_ms` se
počítá podle obsazení enginu, a to jde přičíst nájemci jen tehdy, když engine nesdílí s nikým jiným. Který
nájemce čte který engine, určuje deklarace uzlu (data operátora). Dva enginy se stejnými váhami a receptem
dávají vektory, které se dají porovnat. Deklarace (`overUzel`) i VB (`postavTabulku`) odmítnou dva nájemce
na jednom enginu. Sdílet smí jen nájemce s `diagnostika: true` (sonda operátora).

## Recept a proměnné

Totožné s [embed-1](docker-compose.coolify-accel-embed-1.yml.md), jen s proměnnými `ACCEL_EMBED_2_*`, aliasem
`<vlastník>-accel-embed-2` na síti jádra a `--served-model-name embed-2`. Svazek vah je společný a jen pro čtení.
Adresář `<repo>@<revize>` je neměnný a `accel-vahy` ho změří jednou pro oba enginy (deklarace uzlu nesmí
týž adresář deklarovat s jinou identitou). Engine váhy před startem přeměří sám.

Warmup startuje enginy postupně a čeká na zdraví každého zvlášť. Podíl paměti vLLM (`PODIL_GPU`) se počítá
z VRAM enginu vůči celé kartě, takže dva enginy po 6 000 MiB se na kartu vejdou i se rezervou.
