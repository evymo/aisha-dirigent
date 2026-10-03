/**
 * T-cars SOAP klient (WebService v2, rpc/ENCODED).
 *
 * WSDL: https://webservice.t-cars.cz/v2/index.php?wsdl
 * Namespace: http://webservice.t-cars.cz/soap/TCarsWebService
 *
 * Síť jde výhradně přes `fetchImpl`, které plugin dostává jako `ctx.fetch` —
 * skutečnou hranicí je tedy network_allowlist v manifestu a tento modul ji
 * nemůže rozšířit. (Ve službě to zajišťoval guard.safeFetch; sandbox dělá
 * totéž o úroveň výš a fail-closed.)
 *
 * ⚠️ Rozdíl proti historickému wd-clientu (rpc/literal): T-cars je rpc/ENCODED —
 * envelope nese `soapenv:encodingStyle`, každý prvek `xsi:type`, přihlášení je
 * vnořená typovaná struktura `loginData xsi:type="tcar:tLoginData"` a odpověď
 * je `SOAP-ENC:arrayType` s vnořenými typovanými strukturami. buildEnvelope i
 * parser proto nelze převzít z wd-client 1:1.
 *
 * TODO(ověřit proti živému WSDL + demo účtu demo/demo/demo): přesný tvar
 * odpovědi (názvy wrapper/array elementů: vozidla>vozidlo, osoby>osoba,
 * skupiny>skupina, knihaJizd: vozidlo + jizdy>jizda) a SOAPAction. Níže je
 * best-effort dle ukázkového requestu ve `Webservices_Tcars.docx`.
 */

import { XMLParser } from 'fast-xml-parser';

export const TCARS_NAMESPACE = 'http://webservice.t-cars.cz/soap/TCarsWebService';
export const SOAP_ENC = 'http://schemas.xmlsoap.org/soap/encoding/';

export interface TcarsCredentials {
  cisloSmlouvy: string;
  jmeno: string;
  heslo: string;
}

/** Skalární parametr operace (mimo loginData) i s jeho XSD typem. */
export type TcarsParam = readonly [name: string, xsdType: string, value: string | number | boolean];

export class TcarsSoapFault extends Error {
  constructor(
    public faultCode: string,
    public faultString: string,
  ) {
    // UPPERCASE code prefix → toPublicError vrátí 4xx bez leaknutí detailů
    super(`TCARS_SOAP_FAULT: ${faultCode}`);
    this.name = 'TcarsSoapFault';
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

/** rpc/encoded envelope: loginData struct + typované skalární parametry. */
export function buildEnvelope(
  operation: string,
  creds: TcarsCredentials,
  params: readonly TcarsParam[],
): string {
  const login =
    '<loginData xsi:type="tcar:tLoginData">' +
    `<cisloSmlouvy xsi:type="xsd:string">${escapeXml(creds.cisloSmlouvy)}</cisloSmlouvy>` +
    `<jmeno xsi:type="xsd:string">${escapeXml(creds.jmeno)}</jmeno>` +
    `<heslo xsi:type="xsd:string">${escapeXml(creds.heslo)}</heslo>` +
    '</loginData>';
  const rest = params
    .map(([name, type, value]) => `<${name} xsi:type="${type}">${escapeXml(String(value))}</${name}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `xmlns:tcar="${TCARS_NAMESPACE}">` +
    '<soapenv:Header/>' +
    '<soapenv:Body>' +
    `<tcar:${operation} soapenv:encodingStyle="${SOAP_ENC}">${login}${rest}</tcar:${operation}>` +
    '</soapenv:Body>' +
    '</soapenv:Envelope>'
  );
}

const parser = new XMLParser({
  ignoreAttributes: true, // xsi:type nás nezajímá při čtení — typování v mappers.ts
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Normalizuje 0/1/N výskytů elementu na pole objektů. */
export function toArray(value: unknown): Array<Record<string, unknown>> {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
}

/** Vytáhne `${op}Response` z SOAP obálky; SOAP Fault → TcarsSoapFault. */
export function parseResponse(xml: string, operation: string): Record<string, unknown> {
  const doc = asRecord(parser.parse(xml));
  const envelope = asRecord(doc?.Envelope);
  const body = asRecord(envelope?.Body);
  if (!body) throw new Error('TCARS_INVALID_RESPONSE: missing SOAP body');

  const fault = asRecord(body.Fault);
  if (fault) {
    throw new TcarsSoapFault(
      String(fault.faultcode ?? 'unknown'),
      String(fault.faultstring ?? 'unknown'),
    );
  }

  const response = asRecord(body[`${operation}Response`]);
  if (!response) throw new Error(`TCARS_INVALID_RESPONSE: missing ${operation}Response`);
  return response;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface TcarsClientOptions {
  url: string;
  timeoutMs: number;
  /** SSRF-guarded fetch (guard.safeFetch) — plain fetch jen v testech. */
  fetchImpl: FetchLike;
}

/** Kniha jízd jednoho vozidla — hlavička vozidla + pole jízd. */
export interface TcarsLogBook {
  vozidlo: Record<string, unknown> | null;
  jizdy: Array<Record<string, unknown>>;
}

export interface TcarsClient {
  call(operation: string, creds: TcarsCredentials, params: readonly TcarsParam[]): Promise<Record<string, unknown>>;
  /** vozidlaSeznam → pole tVozidlo. */
  vozidlaSeznam(creds: TcarsCredentials, opts?: { activeOnly?: boolean; changedFrom?: string }): Promise<Array<Record<string, unknown>>>;
  /** osobySeznam → pole tOsoba. */
  osobySeznam(creds: TcarsCredentials, opts?: { activeOnly?: boolean; changedFrom?: string }): Promise<Array<Record<string, unknown>>>;
  /** skupinySeznam → pole tSkupina. */
  skupinySeznam(creds: TcarsCredentials, opts?: { activeOnly?: boolean }): Promise<Array<Record<string, unknown>>>;
  /** knihaJizdVozidlo → tKnihaJizd (vozidlo + jizdy) v okně datumOd–datumDo. */
  knihaJizdVozidlo(creds: TcarsCredentials, vozidloId: number, datumOd: string, datumDo: string): Promise<TcarsLogBook>;
}

export function createTcarsClient(opts: TcarsClientOptions): TcarsClient {
  async function call(
    operation: string,
    creds: TcarsCredentials,
    params: readonly TcarsParam[],
  ): Promise<Record<string, unknown>> {
    const res = await opts.fetchImpl(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `${TCARS_NAMESPACE}#${operation}`,
      },
      body: buildEnvelope(operation, creds, params),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

    const text = await res.text();
    if (!res.ok && !text.includes('Fault')) {
      throw new Error(`TCARS_HTTP_ERROR: T-cars API returned ${res.status}`);
    }
    return parseResponse(text, operation);
  }

  /** Z `${op}Response` vytáhne pole položek — wrapper (`vozidla`) → item (`vozidlo`). */
  function extractList(response: Record<string, unknown>, wrapper: string, item: string): Array<Record<string, unknown>> {
    // Tolerantně: response.<wrapper>.<item> | response.<wrapper> (přímé pole) | response.<item>
    const w = asRecord(response[wrapper]);
    if (w && item in w) return toArray(w[item]);
    if (response[wrapper] != null) return toArray(response[wrapper]);
    return toArray(response[item]);
  }

  return {
    call,

    async vozidlaSeznam(creds, o = {}) {
      const params: TcarsParam[] = [];
      if (o.activeOnly != null) params.push(['pouzeAktivni', 'xsd:boolean', o.activeOnly]);
      if (o.changedFrom) params.push(['zmenyOd', 'xsd:dateTime', o.changedFrom]);
      return extractList(await call('vozidlaSeznam', creds, params), 'vozidla', 'vozidlo');
    },

    async osobySeznam(creds, o = {}) {
      const params: TcarsParam[] = [];
      if (o.activeOnly != null) params.push(['pouzeAktivni', 'xsd:boolean', o.activeOnly]);
      if (o.changedFrom) params.push(['zmenyOd', 'xsd:dateTime', o.changedFrom]);
      return extractList(await call('osobySeznam', creds, params), 'osoby', 'osoba');
    },

    async skupinySeznam(creds, o = {}) {
      const params: TcarsParam[] = [];
      if (o.activeOnly != null) params.push(['pouzeAktivni', 'xsd:boolean', o.activeOnly]);
      return extractList(await call('skupinySeznam', creds, params), 'skupiny', 'skupina');
    },

    async knihaJizdVozidlo(creds, vozidloId, datumOd, datumDo) {
      const response = await call('knihaJizdVozidlo', creds, [
        ['vozidloId', 'xsd:int', vozidloId],
        ['datumOd', 'xsd:dateTime', datumOd],
        ['datumDo', 'xsd:dateTime', datumDo],
      ]);
      // tKnihaJizd { vozidlo, jizdy(aJizdy) } — může být zabalené ve wrapperu.
      const book = asRecord(response.knihaJizd) ?? asRecord(response.return) ?? response;
      const jizdyNode = asRecord(book.jizdy);
      return {
        vozidlo: asRecord(book.vozidlo),
        jizdy: jizdyNode && 'jizda' in jizdyNode ? toArray(jizdyNode.jizda) : toArray(book.jizdy),
      };
    },
  };
}
