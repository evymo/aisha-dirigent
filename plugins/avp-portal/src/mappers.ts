/**
 * AVP záznamy → řádky OBECNÉ SUROVÉ DRÁHY (`source_catalog_rows` přes
 * `audience_sync_source_catalog`), 1:1 s tím, co portál tvrdí.
 *
 * ⭐ PROČ OBECNÁ DRÁHA (majitel 2026-09-26: „vše jako plugin, ať to funguje samo
 * v rámci stacku"). Jádro stacku o AVP nic neví — žádné `avp_*` tabulky ani
 * funkce. Řádek katalogu je (zdroj, druh, externí id, čas, skalární pole);
 * typované pohledy a prezentaci dělá INSTANCE. Instalace = data, ne DDL.
 *
 * ⛔ PROČ NE DVOJČATA (rozhodnutí majitele 2026-09-24): karta řidiče nebo čip
 * vozidla je identifikátor, který se na dvojče váže POTVRZENOU vazbou — ne nové
 * dvojče. Dřívější verze pluginu zakládala dvojče pro každou kartu a nádrž.
 *
 * Nic se tu neodvozuje ani nefiltruje: skryté, odstraněné i nahrazené výdeje se
 * ukládají se svými příznaky (`hidden`, `removed`, `parent_id`) — co je „platné
 * tankování", rozhoduje čtenář. Pravda o řetězu oprav (naměřeno naživo): platí
 * poslední verze z řetězu `parent_id` ∧ ¬hidden ∧ ¬removed.
 *
 * Co mapper nepozná (chybí id nebo čas), vrací null — žádné vymyšlené řádky.
 * Pole jsou jen skaláry (katalog vnořené hodnoty odmítne celou dávku).
 *
 * @module
 */

/** Druhy záznamů v katalogu zdroje (`kind`, ^[a-z][a-z0-9_]{1,39}$). */
export const KIND = {
  card: 'card',
  tank: 'tank',
  fueling: 'fueling',
  tankRefill: 'tank_refill',
  tankRegister: 'tank_register',
  chip: 'chip',
} as const;

/** Řádek pro audience_sync_source_catalog (camelCase kontrakt SourceCatalogRow). */
export interface KatalogovyRadek {
  externalId: string;
  occurredAt: string | null;
  fields: Record<string, string | number | boolean | null>;
}

/** Karta z /cards (řidič nebo vozidlo/stroj — liší je `cardType`). */
export interface AvpCard {
  id: number;
  itemNumber?: number | null;
  name?: string | null;
  cardType?: string | null;
  inventoryNumber?: string | null;
  /** SPZ nebo VIN (vyplněné u menšiny karet) — signál pro návrh vazby. */
  vehicleType?: string | null;
}

/**
 * RFID čip z /chips: kód čipu → karta. Karta jich může mít víc; API dává jen
 * AKTUÁLNÍ přiřazení, historii přesunů ne. U výdeje bez karty vozidla je čip
 * jedinou cestou k vozidlu.
 */
export interface AvpChip {
  chipCode?: string | null;
  cardId?: number | null;
}

/** Nádrž z /tanks. */
export interface AvpTank {
  id: number;
  name?: string | null;
  itemNumber?: number | null;
  productId?: number | null;
  maximumVolume?: number | null;
}

/** Výdej z /fuelings. */
export interface AvpFueling {
  id: number;
  uid?: string | null;
  time?: string | null;
  liters?: number | null;
  compensatedLiters?: number | null;
  duration?: number | null;
  unitPrice?: number | null;
  exciseTax?: number | null;
  vat?: number | null;
  parentId?: number | null;
  hidden?: boolean | null;
  removed?: boolean | null;
  tankId?: number | null;
  avpId?: number | null;
  nozzleId?: number | null;
  driverId?: number | null;
  vehicleId?: number | null;
  vehicleChip?: string | null;
  driverChip?: string | null;
  serverSyncTime?: string | null;
}

/** Návoz z /tank-refills. */
export interface AvpTankRefill {
  id: number;
  uid?: string | null;
  time?: string | null;
  amount?: number | null;
  type?: string | null;
  tankId?: number | null;
}

/** Denní uzávěrka z /tank-registers (`dispendedAmount` je překlep API, ne náš). */
export interface AvpTankRegister {
  id: number;
  uid?: string | null;
  time?: string | null;
  tankId?: number | null;
  calculatedTankAmount?: number | null;
  dispendedAmount?: number | null;
  refillAmount?: number | null;
  correctedAmount?: number | null;
}

const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const cislo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const cas = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const priznak = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

export function mapCard(c: AvpCard): KatalogovyRadek | null {
  const avpId = id(c?.id);
  if (avpId === null) return null;
  return {
    externalId: String(avpId),
    occurredAt: null,
    fields: {
      item_number: cislo(c.itemNumber),
      name: text(c.name),
      card_type: text(c.cardType),
      inventory_number: text(c.inventoryNumber),
      vehicle_type: text(c.vehicleType),
    },
  };
}

/** Čip: externí id = kód čipu (jedinečný); bez kódu nebo karty řádek nevznikne. */
export function mapChip(c: AvpChip): KatalogovyRadek | null {
  const kod = text(c?.chipCode);
  const karta = id(c?.cardId);
  if (kod === null || karta === null) return null;
  return {
    externalId: kod.toUpperCase(),
    occurredAt: null,
    fields: { chip_code: kod.toUpperCase(), card_id: karta },
  };
}

export function mapTank(t: AvpTank): KatalogovyRadek | null {
  const avpId = id(t?.id);
  if (avpId === null) return null;
  return {
    externalId: String(avpId),
    occurredAt: null,
    fields: {
      name: text(t.name),
      item_number: cislo(t.itemNumber),
      product_id: id(t.productId),
      maximum_volume: cislo(t.maximumVolume),
    },
  };
}

export function mapFueling(f: AvpFueling): KatalogovyRadek | null {
  const avpId = id(f?.id);
  const kdy = cas(f?.time);
  if (avpId === null || kdy === null) return null;
  return {
    externalId: String(avpId),
    occurredAt: kdy,
    fields: {
      uid: text(f.uid),
      liters: cislo(f.liters),
      compensated_liters: cislo(f.compensatedLiters),
      duration_s: cislo(f.duration),
      unit_price: cislo(f.unitPrice),
      excise_tax: cislo(f.exciseTax),
      vat: cislo(f.vat),
      parent_id: id(f.parentId),
      hidden: priznak(f.hidden),
      removed: priznak(f.removed),
      tank_id: id(f.tankId),
      avp_id: id(f.avpId),
      nozzle_id: id(f.nozzleId),
      driver_id: id(f.driverId),
      vehicle_id: id(f.vehicleId),
      vehicle_chip: text(f.vehicleChip),
      driver_chip: text(f.driverChip),
      server_sync_time: cas(f.serverSyncTime),
    },
  };
}

export function mapRefill(r: AvpTankRefill): KatalogovyRadek | null {
  const avpId = id(r?.id);
  const kdy = cas(r?.time);
  if (avpId === null || kdy === null) return null;
  return {
    externalId: String(avpId),
    occurredAt: kdy,
    fields: { uid: text(r.uid), tank_id: id(r.tankId), amount: cislo(r.amount), refill_type: text(r.type) },
  };
}

export function mapRegister(r: AvpTankRegister): KatalogovyRadek | null {
  const avpId = id(r?.id);
  const kdy = cas(r?.time);
  if (avpId === null || kdy === null) return null;
  return {
    externalId: String(avpId),
    occurredAt: kdy,
    fields: {
      uid: text(r.uid),
      tank_id: id(r.tankId),
      calculated_tank_amount: cislo(r.calculatedTankAmount),
      dispensed_amount: cislo(r.dispendedAmount),
      refill_amount: cislo(r.refillAmount),
      corrected_amount: cislo(r.correctedAmount),
    },
  };
}

/** Nejpozdější čas z řádků (ISO), nebo `fallback` — pro kurzor, který nepřeskočí pozdní zápis. */
export function nejpozdeji(casy: Array<string | null | undefined>, fallback: string): string {
  let max = fallback;
  let maxMs = Date.parse(fallback);
  for (const c of casy) {
    if (!c) continue;
    const ms = Date.parse(c);
    if (!Number.isNaN(ms) && (Number.isNaN(maxMs) || ms > maxMs)) {
      max = c;
      maxMs = ms;
    }
  }
  return max;
}
