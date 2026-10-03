/**
 * Eurowag záznamy → řádky OBECNÉ SUROVÉ DRÁHY (`source_catalog_rows` přes
 * `audience_sync_source_catalog`, zdroj `eurowag-telematics`).
 *
 * ⭐ PROČ OBECNÁ DRÁHA (0.2.0, 2026-09-27). Verze 0.1.0 zakládala dvojčata
 * (`twin_upsert_entity_audited`) a psala události přímo — proti rozhodnutí
 * majitele (24. 9.: identifikátor se na dvojče váže POTVRZENOU vazbou, zdroj
 * dvojčata nezakládá) a s prázdnou sandbox politikou, která by jí stejně nic
 * nepustila. Teď plugin jen uloží, co Eurowag tvrdí; na dvojčata to přenáší
 * jádro (`ew_project_catalog`) a jen přes potvrzené vazby.
 *
 * ⛔ ŽÁDNÉ POLOHY. Stav vozidla nese GPS (lat/lon, rychlost) a jízda místa
 * začátku a konce — nic z toho se neukládá (majitel: polohy ne). Zůstává, co
 * měří katalog: tachometr, hladina, zapalování; u jízdy km, spotřeba, doba.
 *
 * Korekce „lží dodavatele" (metry, sentinel −1, nesmyslné l/100 km) dělají
 * helpery v `ew-client.ts` — to je znalost dodavatele, patří do pluginu.
 * Co mapper nepozná (chybí id nebo čas), vrací null — žádné vymyšlené řádky.
 * Pole jsou jen skaláry (katalog vnořené hodnoty odmítne celou dávku).
 *
 * @module
 */
import { odometerKm, consumptionLiters, consumptionPer100km, utcIso } from './ew-client.js';

/** Druhy záznamů v katalogu zdroje (`kind`, ^[a-z][a-z0-9_]{1,39}$). */
export const KIND = {
  vehicle: 'vehicle',
  driver: 'driver',
  trip: 'trip',
  vehicleState: 'vehicle_state',
} as const;

/** Řádek pro audience_sync_source_catalog (camelCase kontrakt SourceCatalogRow). */
export interface KatalogovyRadek {
  externalId: string;
  occurredAt: string | null;
  fields: Record<string, string | number | boolean | null>;
}

/**
 * Řidič u jízdy (`TripDriver`). ⛔ Klíč je `id`, ne `driver_id` — ověřeno na
 * 608 řidičích v 1 031 stažených jízdách; 0.2.0 četla `driver_id`, a tak každou
 * jízdu uložila bez řidiče. `isMain` označí hlavního, když jich je víc.
 */
export interface EwTripDriver {
  id?: number | null;
  isMain?: boolean | null;
  name?: string | null;
  surname?: string | null;
}

/** Řidič u stavu vozidla (`VehicleDriver`; id je tu řetězec). Stav ho neukládá. */
export interface EwVehicleDriver {
  id?: string | null;
  name?: string | null;
  source?: string | null;
}

/** Vozidlo z /vehicles-states (podmnožina, jen co se čte). */
export interface EwVehicleState {
  monitoredObjectId: number;
  rn?: string | null;
  odometer?: number | null;
  gpsData?: { time?: string | null; lat?: number | null; lon?: number | null; speed?: number | null } | null;
  stateData?: { time?: string | null; ignition?: number | null } | null;
  fuelTanks?: Array<{ id?: number | null; level?: number | null }> | null;
  driver?: EwVehicleDriver | null;
}

/** Řidič z /drivers (číselník). */
export interface EwDriver {
  id: number;
  client_id?: string | null;
  name?: string | null;
  surname?: string | null;
}

/** Jízda z /trips (podmnožina — místa se nečtou). */
export interface EwTrip {
  id: string;
  monitoredObjectId: string | number;
  startTime?: string | null;
  endTime?: string | null;
  distance?: number | null; // METRY
  duration?: number | null; // sekundy
  totalConsumption?: number | null; // litry; −1 = neznámo
  consumption_liters_100km?: number | null;
  co2_emission?: number | null;
  fuel_type?: string | null;
  cargoWeightKilograms?: number | null;
  drivers?: EwTripDriver[] | null;
}

const cislo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const cas = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const kladneId = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
};

/** SPZ v `rn` chodí s dvojitými mezerami („6Z7  5139") — srovnat bílé znaky. */
export function normalizePlate(rn: string | null | undefined): string | null {
  const t = (rn ?? '').replace(/\s+/g, ' ').trim();
  return t || null;
}

/** Vozidlo (číselník): monitoredObjectId + SPZ. Poloha ani stav se sem nepíšou. */
export function mapVehicle(v: EwVehicleState): KatalogovyRadek | null {
  const id = kladneId(v?.monitoredObjectId);
  if (id === null) return null;
  return { externalId: String(id), occurredAt: null, fields: { rn: normalizePlate(v.rn) } };
}

/** Řidič (číselník): id + jméno. */
export function mapDriver(d: EwDriver): KatalogovyRadek | null {
  const id = kladneId(d?.id);
  if (id === null) return null;
  return {
    externalId: String(id),
    occurredAt: null,
    fields: { name: text(d.name), surname: text(d.surname), client_id: text(d.client_id) },
  };
}

/**
 * Stav vozidla → řádek řady. Klíč = „objekt + čas pozorování", takže opakovaný
 * poll téhož vzorku je jeden řádek. Čas pozorování bere z GPS i ze stavové
 * části (jen ČAS — souřadnice ani rychlost se neukládají). Bez času nevznikne.
 */
export function mapVehicleState(v: EwVehicleState): KatalogovyRadek | null {
  const id = kladneId(v?.monitoredObjectId);
  const kdy = cas(v?.gpsData?.time) ?? cas(v?.stateData?.time);
  if (id === null || kdy === null) return null;
  const hladina = Array.isArray(v.fuelTanks) && v.fuelTanks.length ? cislo(v.fuelTanks[0]?.level) : null;
  const zapalovani = cislo(v.stateData?.ignition);
  return {
    externalId: `${id}:${kdy}`,
    occurredAt: kdy,
    fields: {
      monitored_object_id: id,
      odometer_km: odometerKm(v.odometer),
      fuel_level_l: hladina,
      ignition: zapalovani === null ? null : zapalovani === 1,
    },
  };
}

/**
 * Jízda → řádek řady. Km z metrů, spotřeba bez sentinelu, l/100 km jen
 * v uvěřitelném pásmu, časy jako UTC (API je posílá bez zóny). Řidič = hlavní
 * (`isMain`), jinak první. Místa se nečtou ani neukládají.
 */
export function mapTrip(t: EwTrip, maxPer100km: number): KatalogovyRadek | null {
  const id = text(t?.id);
  const vozidlo = kladneId(t?.monitoredObjectId);
  const zacatek = utcIso(t?.startTime);
  if (id === null || vozidlo === null || zacatek === null) return null;
  const ridic = t.drivers?.find((d) => d?.isMain === true) ?? t.drivers?.[0];
  return {
    externalId: id,
    occurredAt: zacatek,
    fields: {
      monitored_object_id: vozidlo,
      end_time: utcIso(t.endTime),
      distance_km: odometerKm(t.distance),
      duration_s: cislo(t.duration),
      consumption_l: consumptionLiters(t.totalConsumption),
      consumption_l_100km: consumptionPer100km(t.consumption_liters_100km, maxPer100km),
      co2_emission: cislo(t.co2_emission),
      fuel_type: text(t.fuel_type),
      cargo_weight_kg: cislo(t.cargoWeightKilograms),
      driver_id: kladneId(ridic?.id),
    },
  };
}
