/**
 * Nahrání těla souboru s PRŮBĚHEM — XMLHttpRequest, protože `fetch` průběh
 * odesílání neumí (upload stream je v prohlížečích za experimentálním
 * `duplex` a Safari ho nemá). Jedno místo pro všechny nahrávací cesty
 * (obrázky do úložiště, APK hlídače), aby průběh, zrušení a strop platily
 * všude stejně.
 *
 * Tvar volání je záměrně blízký `fetch(url, { method, headers, body })`,
 * aby brány, které čtou z klienta „PUT na podepsanou adresu", měly co číst.
 */
export interface VolbyNahrani {
  method: 'PUT' | 'POST';
  body: Blob | File;
  headers?: Record<string, string>;
  /** Podíl 0..1 a bajty — volá se při každé události průběhu odesílání. */
  onProgress?: (podil: number, nahrano: number, celkem: number) => void;
  signal?: AbortSignal;
  /** Strop celého požadavku; po něm se odmítne chybou `timeout`. */
  timeoutMs?: number;
}

export interface OdpovedNahrani {
  ok: boolean;
  status: number;
  text: string;
  /** Tělo jako JSON, nebo null, když to JSON není. */
  json<T = unknown>(): T | null;
}

export class ChybaNahrani extends Error {
  constructor(public duvod: 'sit' | 'timeout' | 'zruseno') {
    super(duvod === 'sit' ? 'Upload failed (network)' : duvod === 'timeout' ? 'Upload timed out' : 'Upload aborted');
    this.name = 'ChybaNahrani';
  }
}

export function nahraniSPrubehem(url: string, volby: VolbyNahrani): Promise<OdpovedNahrani> {
  return new Promise((resolve, reject) => {
    if (volby.signal?.aborted) {
      reject(new ChybaNahrani('zruseno'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(volby.method, url, true);
    for (const [jmeno, hodnota] of Object.entries(volby.headers ?? {})) {
      xhr.setRequestHeader(jmeno, hodnota);
    }
    if (volby.timeoutMs) xhr.timeout = volby.timeoutMs;

    xhr.upload.onprogress = (ev: ProgressEvent) => {
      if (!volby.onProgress) return;
      const celkem = ev.lengthComputable ? ev.total : volby.body.size;
      const nahrano = Math.min(ev.loaded, celkem);
      volby.onProgress(celkem > 0 ? nahrano / celkem : 0, nahrano, celkem);
    };

    const zrus = () => xhr.abort();
    volby.signal?.addEventListener('abort', zrus, { once: true });
    const uklid = () => volby.signal?.removeEventListener('abort', zrus);

    xhr.onload = () => {
      uklid();
      const text = xhr.responseText ?? '';
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text,
        json<T>(): T | null {
          try {
            return text ? (JSON.parse(text) as T) : null;
          } catch {
            return null;
          }
        },
      });
    };
    xhr.onerror = () => {
      uklid();
      reject(new ChybaNahrani('sit'));
    };
    xhr.ontimeout = () => {
      uklid();
      reject(new ChybaNahrani('timeout'));
    };
    xhr.onabort = () => {
      uklid();
      reject(new ChybaNahrani('zruseno'));
    };
    xhr.send(volby.body);
  });
}
