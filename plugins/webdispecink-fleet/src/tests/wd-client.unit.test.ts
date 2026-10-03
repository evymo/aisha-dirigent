import { describe, it, expect } from 'vitest';
import {
  buildEnvelope,
  parseSoapResponse,
  createWdClient,
  WdSoapFault,
  WD_NAMESPACE,
} from '../wd-client.js';

const NS = 'urn://api.webdispecink.cz/webdisser_02';

function soapWrap(inner: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `xmlns:ns1="${NS}"><SOAP-ENV:Body>${inner}</SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}

describe('buildEnvelope', () => {
  it('builds rpc/literal envelope with ordered params', () => {
    const xml = buildEnvelope('_getCarsList2', [
      ['kodf', 'FIRMA1'],
      ['username', 'api-user'],
      ['pass', 'secret'],
      ['activeOnly', 0],
    ]);
    expect(xml).toContain(`xmlns:wd="${WD_NAMESPACE}"`);
    expect(xml).toContain(
      '<wd:_getCarsList2><kodf>FIRMA1</kodf><username>api-user</username><pass>secret</pass><activeOnly>0</activeOnly></wd:_getCarsList2>',
    );
  });

  it('escapes XML special characters in values', () => {
    const xml = buildEnvelope('_login', [['pass', 'a<b>&"\'']]);
    expect(xml).toContain('<pass>a&lt;b&gt;&amp;&quot;&apos;</pass>');
    expect(xml).not.toContain('a<b>');
  });
});

describe('parseSoapResponse', () => {
  it('parses multiple items into records', () => {
    const xml = soapWrap(
      `<ns1:_getCarsList2Response><return>` +
        `<item><carid>101</carid><identifikator>3T2 1234</identifikator><disabled>0</disabled></item>` +
        `<item><carid>102</carid><identifikator>3T2 5678</identifikator><disabled>1</disabled></item>` +
        `</return></ns1:_getCarsList2Response>`,
    );
    const items = parseSoapResponse(xml, '_getCarsList2');
    expect(items).toHaveLength(2);
    expect(items[0].carid).toBe('101');
    expect(items[0].identifikator).toBe('3T2 1234');
    expect(items[1].disabled).toBe('1');
  });

  it('normalizes a single item into a one-element array', () => {
    const xml = soapWrap(
      `<ns1:_getDriversList2Response><return>` +
        `<item><iddriver>7</iddriver><jmeno>Jan</jmeno><prijmeni>Novák</prijmeni></item>` +
        `</return></ns1:_getDriversList2Response>`,
    );
    const items = parseSoapResponse(xml, '_getDriversList2');
    expect(items).toHaveLength(1);
    expect(items[0].prijmeni).toBe('Novák');
  });

  it('returns empty array for empty return element', () => {
    const xml = soapWrap('<ns1:_getCarsList2Response><return></return></ns1:_getCarsList2Response>');
    expect(parseSoapResponse(xml, '_getCarsList2')).toEqual([]);
  });

  it('throws WdSoapFault on SOAP fault without leaking fault detail in message', () => {
    const xml = soapWrap(
      '<SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode>' +
        '<faultstring>Invalid login for user xyz</faultstring></SOAP-ENV:Fault>',
    );
    let caught: unknown;
    try {
      parseSoapResponse(xml, '_getCarsList2');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WdSoapFault);
    const fault = caught as WdSoapFault;
    expect(fault.faultString).toBe('Invalid login for user xyz');
    expect(fault.message).not.toContain('xyz');
  });

  it('throws on non-SOAP payload', () => {
    expect(() => parseSoapResponse('<html>gateway error</html>', '_getCarsList2')).toThrow(
      /WD_INVALID_RESPONSE/,
    );
  });
});

describe('createWdClient', () => {
  function fakeFetch(responseXml: string, capture: { url?: string; init?: RequestInit }) {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      capture.url = url;
      capture.init = init;
      return new Response(responseXml, { status: 200 });
    };
  }

  it('sends SOAPAction header and parses car list', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const xml = soapWrap(
      '<ns1:_getCarsList2Response><return><item><carid>5</carid></item></return></ns1:_getCarsList2Response>',
    );
    const client = createWdClient({
      url: 'https://api.webdispecink.cz/code/WebDispecinkServiceNet.php',
      timeoutMs: 1000,
      fetchImpl: fakeFetch(xml, capture),
    });

    const items = await client.getCarsList({ kodf: 'F', username: 'u', pass: 'p' });

    expect(items).toEqual([{ carid: '5' }]);
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers.SOAPAction).toBe(`${WD_NAMESPACE}#_getCarsList2`);
    expect(headers['Content-Type']).toContain('text/xml');
    expect(String(capture.init?.body)).toContain('<activeOnly>0</activeOnly>');
  });

  it('sends driver list params in WSDL order', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const xml = soapWrap('<ns1:_getDriversList2Response><return></return></ns1:_getDriversList2Response>');
    const client = createWdClient({ url: 'https://example.invalid', timeoutMs: 1000, fetchImpl: fakeFetch(xml, capture) });

    await client.getDriversList({ kodf: 'F', username: 'u', pass: 'p' }, 1);

    expect(String(capture.init?.body)).toContain(
      '<kodf>F</kodf><username>u</username><pass>p</pass><iddriver>0</iddriver><oskod></oskod><disabled>1</disabled>',
    );
  });

  it('passes disabled through as a filter value, not a widening switch', async () => {
    // The vendor returns ONE group per call: disabled=0 the active drivers,
    // disabled=1 the inactive ones (15 and 32 respectively on the live tenant,
    // 2026-07-26). A caller that wants the whole roster has to ask twice — the
    // service this plugin replaces did not, and shipped only the inactive half.
    for (const flag of [0, 1] as const) {
      const capture: { url?: string; init?: RequestInit } = {};
      const xml = soapWrap('<ns1:_getDriversList2Response><return></return></ns1:_getDriversList2Response>');
      const client = createWdClient({ url: 'https://example.invalid', timeoutMs: 1000, fetchImpl: fakeFetch(xml, capture) });

      await client.getDriversList({ kodf: 'F', username: 'u', pass: 'p' }, flag);

      expect(String(capture.init?.body)).toContain(`<disabled>${flag}</disabled>`);
    }
  });

  it('sends geocode flag for positions and carid+window for logbook', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const positionsXml = soapWrap(
      '<ns1:_getAllCarsPositionResponse><return><item><carid>5</carid></item></return></ns1:_getAllCarsPositionResponse>',
    );
    const client = createWdClient({ url: 'https://example.invalid', timeoutMs: 1000, fetchImpl: fakeFetch(positionsXml, capture) });

    await client.getAllCarsPositions({ kodf: 'F', username: 'u', pass: 'p' });
    expect(String(capture.init?.body)).toContain('<geocode>0</geocode>');

    const logbookXml = soapWrap('<ns1:_getCarLogBook4Response><return></return></ns1:_getCarLogBook4Response>');
    const client2 = createWdClient({ url: 'https://example.invalid', timeoutMs: 1000, fetchImpl: fakeFetch(logbookXml, capture) });
    await client2.getCarLogBook({ kodf: 'F', username: 'u', pass: 'p' }, 101, '2026-07-03 00:00:00', '2026-07-03 12:00:00');
    expect(String(capture.init?.body)).toContain(
      '<carid>101</carid><casod>2026-07-03 00:00:00</casod><casdo>2026-07-03 12:00:00</casdo>',
    );
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers.SOAPAction).toBe(`${WD_NAMESPACE}#_getCarLogBook4`);
  });

  it('throws WD_HTTP_ERROR on non-2xx without fault body', async () => {
    const client = createWdClient({
      url: 'https://example.invalid',
      timeoutMs: 1000,
      fetchImpl: async () => new Response('bad gateway', { status: 502 }),
    });
    await expect(client.getCarsList({ kodf: 'F', username: 'u', pass: 'p' })).rejects.toThrow(
      /WD_HTTP_ERROR/,
    );
  });
});
