/**
 * Normalizace položek z T-cars SOAP odpovědí (tVozidlo, tOsoba, tSkupina,
 * tJizda) na záznamy pro tc_upsert_*_audited RPC.
 *
 * Parser vrací všechny hodnoty jako string — typování se dělá tady. Kompletní
 * surová položka se posílá v `raw` (uloží se do raw_data jsonb), takže ztráta
 * polí nehrozí ani při změně API. Vnořené typované struktury (vozidloSkupina,
 * vozidloOdpovedny, jizdaRidic …) se plochují na potřebné id/název sloupce.
 */

export interface TcVehicleRecord {
  tc_vehicle_id: number;
  model: string | null;
  plate: string | null;
  evidence_no: string | null;
  unit_no: string | null;
  group_id: number | null;
  group_name: string | null;
  responsible_id: number | null;
  responsible_name: string | null;
  responsible_since: string | null;
  cost_center_id: number | null;
  cost_center_name: string | null;
  kind: string | null;
  category: string | null;
  emission_norm: string | null;
  fuel_primary: string | null;
  fuel_alt: string | null;
  purchase_price: number | null;
  first_registration: string | null;
  active: boolean;
  raw: Record<string, unknown>;
}

export interface TcDriverRecord {
  tc_driver_id: number;
  name: string | null;
  personal_number: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  group_id: number | null;
  group_name: string | null;
  cost_center_id: number | null;
  position: string | null;
  active: boolean;
  raw: Record<string, unknown>;
}

export interface TcGroupRecord {
  tc_group_id: number;
  name: string | null;
  number: string | null;
  parent_id: number | null;
  leader_id: number | null;
  leader_name: string | null;
  cost_center_id: number | null;
  cost_center_name: string | null;
  active: boolean;
  raw: Record<string, unknown>;
}

export interface TcRideRecord {
  tc_ride_id: number;
  tc_vehicle_id: number;
  tc_driver_id: number | null;
  driver_name: string | null;
  responsible_name: string | null;
  start_time: string | null;
  end_time: string | null;
  start_place: string | null;
  end_place: string | null;
  country: string | null;
  odometer_start_km: number | null;
  odometer_end_km: number | null;
  distance_km: number | null;
  city_ratio: number | null;
  fuel_end: number | null;
  fuel_end_alt: number | null;
  private: boolean | null;
  purpose: string | null;
  cost_center_id: number | null;
  cost_center_name: string | null;
  raw: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function toNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** T-cars vrací datumy jako ISO string; prázdné jako '' nebo '0000-00-00…'. */
function toDate(value: unknown): string | null {
  const s = toText(value);
  if (!s || s.startsWith('0000-00-00')) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null;
}

/** SOAP boolean je 'true'/'false'/'1'/'0'. */
function toBool(value: unknown): boolean | null {
  const s = toText(value);
  if (s == null) return null;
  return s === 'true' || s === '1';
}

/** `*Vyrazeno=true` → deaktivováno → active=false (prázdné = aktivní). */
function activeFromVyrazeno(value: unknown): boolean {
  return toBool(value) !== true;
}

export function mapVozidlo(item: Record<string, unknown>): TcVehicleRecord | null {
  const id = toInt(item.vozidloId);
  if (id == null || id <= 0) return null;

  const skupina = asRecord(item.vozidloSkupina);
  const odpovedny = asRecord(item.vozidloOdpovedny);
  const stredisko = asRecord(item.vozidloStredisko);

  return {
    tc_vehicle_id: id,
    model: toText(item.vozidloModel),
    plate: toText(item.vozidloRz),
    evidence_no: toText(item.vozidloEvidCis),
    unit_no: toText(item.vozidloCisloPalubniJednotky),
    group_id: toInt(skupina?.skupinaId),
    group_name: toText(skupina?.skupinaNazev),
    responsible_id: toInt(odpovedny?.osobaId),
    responsible_name: toText(odpovedny?.osobaJmeno),
    responsible_since: toDate(item.vozidloOdpovednyOd),
    cost_center_id: toInt(stredisko?.id),
    cost_center_name: toText(stredisko?.nazev),
    kind: toText(asRecord(item.vozidloDruh)?.nazev),
    category: toText(asRecord(item.vozidloKategorie)?.nazev),
    emission_norm: toText(asRecord(item.vozidloEmisniNorma)?.nazev),
    fuel_primary: toText(asRecord(item.vozidloPalivo1)?.nazev),
    fuel_alt: toText(asRecord(item.vozidloPalivo2)?.nazev),
    purchase_price: toNum(item.vozidloPorizovaciCena),
    first_registration: toDate(item.vozidloDatumRegistrace),
    active: activeFromVyrazeno(item.vozidloVyrazeno),
    raw: item,
  };
}

export function mapOsoba(item: Record<string, unknown>): TcDriverRecord | null {
  const id = toInt(item.osobaId);
  if (id == null || id <= 0) return null;

  const skupina = asRecord(item.osobaSkupina);
  const stredisko = asRecord(item.osobaStredisko);

  return {
    tc_driver_id: id,
    name: toText(item.osobaJmeno),
    personal_number: toText(item.osobaCislo),
    phone: toText(item.osobaTelefon),
    mobile: toText(item.osobaMobil),
    email: toText(item.osobaEmail),
    group_id: toInt(skupina?.skupinaId),
    group_name: toText(skupina?.skupinaNazev),
    cost_center_id: toInt(stredisko?.id),
    position: toText(asRecord(item.osobaPozice)?.nazev),
    active: activeFromVyrazeno(item.osobaVyrazeno),
    raw: item,
  };
}

export function mapSkupina(item: Record<string, unknown>): TcGroupRecord | null {
  const id = toInt(item.skupinaId);
  if (id == null || id <= 0) return null;

  const nadrizena = asRecord(item.skupinaNadrizena);
  const vedouci = asRecord(item.skupinaVedouci);
  const stredisko = asRecord(item.skupinaStredisko);

  return {
    tc_group_id: id,
    name: toText(item.skupinaNazev),
    number: toText(item.skupinaCislo),
    parent_id: toInt(nadrizena?.skupinaId),
    leader_id: toInt(vedouci?.osobaId),
    leader_name: toText(vedouci?.osobaJmeno),
    cost_center_id: toInt(stredisko?.id),
    cost_center_name: toText(stredisko?.nazev),
    active: activeFromVyrazeno(item.skupinaVyrazeno),
    raw: item,
  };
}

/** tJizda nenese vozidloId — bere se z hlavičky tKnihaJizd.vozidlo. */
export function mapJizda(item: Record<string, unknown>, vehicleId: number): TcRideRecord | null {
  const rideId = toInt(item.jizdaId);
  if (rideId == null || rideId <= 0 || vehicleId <= 0) return null;

  const ridic = asRecord(item.jizdaRidic);
  const odpovedny = asRecord(item.jizdaOdpovedny);
  const stredisko = asRecord(item.jizdaStredisko);

  return {
    tc_ride_id: rideId,
    tc_vehicle_id: vehicleId,
    tc_driver_id: toInt(ridic?.osobaId),
    driver_name: toText(ridic?.osobaJmeno),
    responsible_name: toText(odpovedny?.osobaJmeno),
    start_time: toDate(item.jizdaOd),
    end_time: toDate(item.jizdaDo),
    start_place: toText(item.jizdaOdkud),
    end_place: toText(item.jizdaKam),
    country: toText(item.jizdaStat),
    odometer_start_km: toNum(item.jizdaStavKmPocatek),
    odometer_end_km: toNum(item.jizdaStavKmKonec),
    distance_km: toNum(item.jizdaDelkaKm),
    city_ratio: toNum(item.jizdaPomerMestoMimomesto),
    fuel_end: toNum(item.jizdaStavPhm),
    fuel_end_alt: toNum(item.jizdaStavPhm2),
    private: toBool(item.jizdaSoukroma),
    purpose: toText(item.jizdaUcel),
    cost_center_id: toInt(stredisko?.id),
    cost_center_name: toText(stredisko?.nazev),
    raw: item,
  };
}

/** Dedup podle externího ID — poslední výskyt vyhrává (novější stav v odpovědi). */
export function dedupeById<T>(records: T[], idOf: (record: T) => number): T[] {
  const byId = new Map<number, T>();
  for (const record of records) {
    byId.set(idOf(record), record);
  }
  return [...byId.values()];
}
