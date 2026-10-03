/**
 * Webdispečink SOAP klient (API 2.0, rpc/literal).
 *
 * WSDL: https://api.webdispecink.cz/code/WebDispecinkServiceNet.php?wsdl
 * Namespace: urn://api.webdispecink.cz/webdisser_02
 *
 * Pořadí parametrů odpovídá <message> definicím ve WSDL — rpc styl je na
 * pořadí citlivý. Odpovědi se parsují tolerantně: všechny hodnoty jako
 * string (parseTagValue: false), typování řeší mappers.ts.
 */

import { XMLParser } from 'fast-xml-parser';

export const WD_NAMESPACE = 'urn://api.webdispecink.cz/webdisser_02';

export interface WdCredentials {
  kodf: string;
  username: string;
  pass: string;
}

export type WdParam = readonly [name: string, value: string | number];

export class WdSoapFault extends Error {
  constructor(
    public faultCode: string,
    public faultString: string,
  ) {
    // UPPERCASE code prefix → toPublicError vrátí 4xx bez leaknutí detailů
    super(`WD_SOAP_FAULT: ${faultCode}`);
    this.name = 'WdSoapFault';
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildEnvelope(operation: string, params: readonly WdParam[]): string {
  const body = params
    .map(([name, value]) => `<${name}>${escapeXml(String(value))}</${name}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `xmlns:wd="${WD_NAMESPACE}">` +
    `<soap:Body><wd:${operation}>${body}</wd:${operation}></soap:Body>` +
    '</soap:Envelope>'
  );
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Vytáhne pole položek z SOAP odpovědi `<{op}Response><return><item>…`.
 * Jedna položka → jednoprvkové pole, prázdný return → [].
 * SOAP Fault → WdSoapFault.
 */
export function parseSoapResponse(xml: string, operation: string): Array<Record<string, unknown>> {
  const doc = asRecord(parser.parse(xml));
  const envelope = asRecord(doc?.Envelope);
  const soapBody = asRecord(envelope?.Body);
  if (!soapBody) {
    throw new Error('WD_INVALID_RESPONSE: missing SOAP body');
  }

  const fault = asRecord(soapBody.Fault);
  if (fault) {
    throw new WdSoapFault(
      String(fault.faultcode ?? 'unknown'),
      String(fault.faultstring ?? 'unknown'),
    );
  }

  const response = asRecord(soapBody[`${operation}Response`]);
  if (!response) {
    throw new Error(`WD_INVALID_RESPONSE: missing ${operation}Response`);
  }

  const returnValue = response.return;
  if (returnValue == null || returnValue === '') return [];

  const items = asRecord(returnValue)?.item ?? returnValue;
  const list = Array.isArray(items) ? items : [items];
  return list.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface WdClientOptions {
  url: string;
  timeoutMs: number;
  /** SSRF-guarded fetch (guard.safeFetch) — plain fetch jen v testech. */
  fetchImpl: FetchLike;
}

export interface WdClient {
  call(operation: string, params: readonly WdParam[]): Promise<Array<Record<string, unknown>>>;
  /** _getCarsList2 — seznam vozidel vč. techniky (odometr, jednotka, servis). */
  getCarsList(creds: WdCredentials, activeOnly?: boolean): Promise<Array<Record<string, unknown>>>;
  /**
   * _getDriversList2 — řidiči vč. osobního čísla a Dallas čipu.
   *
   * `disabled` je FILTR na hodnotu příznaku, ne přepínač „zahrnout i neaktivní":
   * ověřeno naživo 2026-07-26 — disabled=0 vrátí 15 aktivních, disabled=1 vrátí
   * 32 neaktivních, dohromady 47. Jedno volání tedy NIKDY nevrátí všechny;
   * volající, který chce úplný seznam, musí zavolat obě větve (viz index.ts).
   */
  getDriversList(creds: WdCredentials, disabled: 0 | 1): Promise<Array<Record<string, unknown>>>;
  /** _getAllCarsPosition — aktuální polohy všech vozidel; geocode je drahé, default vypnuto. */
  getAllCarsPositions(creds: WdCredentials, geocode?: boolean): Promise<Array<Record<string, unknown>>>;
  /** _getCarLogBook4 — kniha jízd jednoho vozidla v okně casod–casdo ('YYYY-MM-DD HH:mm:ss'). */
  getCarLogBook(creds: WdCredentials, carId: number, from: string, to: string): Promise<Array<Record<string, unknown>>>;

  /**
   * _getDriverWorkTacho — „Výkony řidičů podle tachografu" JEDNOHO řidiče v okně
   * ('YYYY-MM-DD HH:mm:ss'). Per den × vozidlo: TotalDrive/Work/Rest v SEKUNDÁCH.
   * IdDriver je povinné — bez něj vrací prázdno.
   */
  getDriverWorkTacho(creds: WdCredentials, driverId: number, from: string, to: string): Promise<Array<Record<string, unknown>>>;

  /** _getCarOverSpeed — překročení rychlosti JEDNOHO vozidla v okně (úseky s max. rychlostí a polohou). */
  getCarOverSpeed(creds: WdCredentials, carId: number, from: string, to: string): Promise<Array<Record<string, unknown>>>;

  /** _getStaDrivers — statistika VŠECH řidičů za okno (fleet-wide, jedno volání): služební/soukromé km, doba den/noc. */
  getDriverStats(creds: WdCredentials, from: string, to: string): Promise<Array<Record<string, unknown>>>;
}

export function createWdClient(opts: WdClientOptions): WdClient {
  async function call(
    operation: string,
    params: readonly WdParam[],
  ): Promise<Array<Record<string, unknown>>> {
    const res = await opts.fetchImpl(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `${WD_NAMESPACE}#${operation}`,
      },
      body: buildEnvelope(operation, params),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

    const text = await res.text();
    if (!res.ok && !text.includes('Fault')) {
      throw new Error(`WD_HTTP_ERROR: Webdispecink API returned ${res.status}`);
    }
    return parseSoapResponse(text, operation);
  }

  return {
    call,

    getCarsList(creds, activeOnly = false) {
      return call('_getCarsList2', [
        ['kodf', creds.kodf],
        ['username', creds.username],
        ['pass', creds.pass],
        ['activeOnly', activeOnly ? 1 : 0],
      ]);
    },

    getDriversList(creds, disabled) {
      // iddriver=0 + oskod='' → bez filtru na konkrétního řidiče; `disabled`
      // pak vybírá JEDNU z obou skupin (viz komentář u rozhraní).
      return call('_getDriversList2', [
        ['kodf', creds.kodf],
        ['username', creds.username],
        ['pass', creds.pass],
        ['iddriver', 0],
        ['oskod', ''],
        ['disabled', disabled],
      ]);
    },

    getAllCarsPositions(creds, geocode = false) {
      return call('_getAllCarsPosition', [
        ['kodf', creds.kodf],
        ['username', creds.username],
        ['pass', creds.pass],
        ['geocode', geocode ? 1 : 0],
      ]);
    },

    getCarLogBook(creds, carId, from, to) {
      return call('_getCarLogBook4', [
        ['kodf', creds.kodf],
        ['username', creds.username],
        ['pass', creds.pass],
        ['carid', carId],
        ['casod', from],
        ['casdo', to],
      ]);
    },

    getDriverWorkTacho(creds, driverId, from, to) {
      return call('_getDriverWorkTacho', [
        ['kodf', creds.kodf],
        ['username', creds.username],
        ['pass', creds.pass],
        ['IdDriver', driverId],
        ['DateFrom', from],
        ['DateTo', to],
      ]);
    },

    getCarOverSpeed(creds, carId, from, to) {
      return call('_getCarOverSpeed', [
        ['kodf', creds.kodf],
        ['username', creds.username],
        ['pass', creds.pass],
        ['IdCar', carId],
        ['DateFrom', from],
        ['DateTo', to],
      ]);
    },

    getDriverStats(creds, from, to) {
      return call('_getStaDrivers', [
        ['kodf', creds.kodf],
        ['username', creds.username],
        ['pass', creds.pass],
        ['DateFrom', from],
        ['DateTo', to],
      ]);
    },
  };
}
