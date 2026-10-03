/**
 * Životní cyklus VPN tunelu k Money.
 *
 * ⭐ TAJEMSTVÍ NIKDY NA DISK OBRAZU
 * Profil (včetně klientského certifikátu), přihlašovací údaje i heslo ke klíči
 * přicházejí v proměnných a zapisují se JEN do `/run/money` — tmpfs, tedy paměť.
 * Restartem kontejneru zmizí; v obrazu ani ve svazku po nich nezůstane stopa.
 *
 * ⛔ NEOPAKOVAT DONEKONEČNA
 * Naměřeno 2026-08-06: při odmítnutém účtu openvpn zkouší spojení znovu a znovu
 * (9 pokusů za 20 s). Protistrana to vidí jako útok a fail2ban pak zavře dveře
 * i pro správné údaje. Proto `--connect-retry-max` a strop pokusů v supervizi:
 * po vyčerpání se tunel vzdá a řekne proč, místo aby mlátil do zdi.
 *
 * ⛔ CRLF
 * `.ovpn` profil i hesla se čistí od `\r`. Táž past už jednou stála hodinu:
 * port se z profilu přečetl jako `443\r` a pravidlo se tiše nenainstalovalo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface TunnelOptions {
  profileB64: string;
  authUser: string;
  authPass: string;
  keyPassphrase: string;
  /** Adresář na tmpfs; testy si podstrčí vlastní. */
  runDir?: string;
  /** Kolikrát smí openvpn zkusit spojení, než to vzdá. */
  connectRetryMax?: number;
  /**
   * Po jaké nečinnosti cestu zavřít. Nula = nezavírat (starý trvalý režim).
   *
   * ⛔ NE příliš krátké: `--connect-retry-max` výš existuje proto, že opakované
   * pokusy vypadají protistraně jako útok a fail2ban pak zavře dveře i pro
   * správné údaje. Časté cykly připoj–odpoj mají tentýž tvar. Řádově minuty.
   */
  idleMs?: number;
  /** Jak dlouho čekat, než openvpn dohlásí hotovo. */
  connectTimeoutMs?: number;
}

/**
 * Stav cesty. `idle` NENÍ porucha — je to návrh: spojení do cizí sítě se
 * nedrží otevřené, když ho nikdo nepotřebuje.
 */
export type TunnelState = 'idle' | 'starting' | 'up' | 'error';

export interface TunnelHandle {
  /** Vypůjčí si cestu; otevře ji, pokud ještě neběží. Vrací funkci pro vrácení. */
  lease(): Promise<() => void>;
  /** Kolik výpůjček právě běží. */
  leases(): number;
  stop(): void;
  isUp(): boolean;
  state(): TunnelState;
  lastError(): string | null;
  logPath: string;
}

/** Bez `\r` — CRLF v profilu i v hesle je doložená past. */
export function stripCr(s: string): string {
  return s.replace(/\r/g, '');
}

/**
 * Rozbalí profil z base64. Prázdný nebo nedekódovatelný vstup je CHYBA, ne
 * prázdný profil — openvpn by jinak spadl na nesrozumitelné hlášce o syntaxi.
 */
export function decodeProfile(b64: string): string {
  const raw = Buffer.from(b64, 'base64').toString('utf8');
  if (!raw.trim()) throw new Error('MONEY_VPN_PROFILE_B64 je prázdný nebo není base64');
  // `remote` je jediná část, bez které profil nemá smysl — a zároveň levná
  // kontrola, že jsme dekódovali profil a ne kus jiného souboru.
  if (!/^\s*remote\s+\S+/m.test(raw)) {
    throw new Error('MONEY_VPN_PROFILE_B64 nevypadá jako .ovpn profil (chybí `remote`)');
  }
  return stripCr(raw);
}

/**
 * Vyjednávací sada šifer, když ji profil nenese.
 *
 * ⛔ NAMĚŘENO 2026-08-26: připojení selhávalo, protože profil deklaroval JEN
 * `cipher AES-256-CBC`. Od OpenVPN 2.5 se datová šifra vyjednává direktivou
 * `data-ciphers`; `cipher` je zastaralá a slouží už jen jako poslední záchrana
 * pro protistranu, která vyjednávat neumí. Profil bez `data-ciphers` tedy
 * moderní protistraně nenabídne NIC, co by přijala.
 *
 * Pořadí je od nejsilnějšího: AEAD sady napřed, zastaralé CBC až na konci —
 * aby se použilo jen tam, kde nic lepšího není.
 */
const VYCHOZI_DATA_CIPHERS = 'AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-256-CBC';

/**
 * Doplní `data-ciphers`, pokud je profil nemá. Idempotentní: profil, který si
 * sadu nese sám, se NEPŘEPISUJE — operátorova deklarace má přednost.
 *
 * Zastaralý `cipher` se ponechává: je to legitimní fallback pro starou
 * protistranu a jeho odstranění by rozbilo, co dnes funguje.
 */
export function doplnDataCiphers(profil: string, sada = VYCHOZI_DATA_CIPHERS): string {
  if (/^\s*data-ciphers\s+\S/m.test(profil)) return profil;

  // Šifra z profilu patří do sady taky — jinak by se doplněním ZTRATILA
  // možnost, kterou tam operátor vědomě má.
  const vlastni = profil.match(/^\s*cipher\s+(\S+)/m)?.[1];
  const seznam = sada.split(':');
  if (vlastni && !seznam.includes(vlastni)) seznam.push(vlastni);

  // Vkládá se NAD `cipher`, ať je vidět, co platí; jinak na začátek.
  const radek = `data-ciphers ${seznam.join(':')}`;
  const radky = profil.split('\n');
  const kam = radky.findIndex((r) => /^\s*cipher\s+\S/.test(r));
  if (kam >= 0) radky.splice(kam, 0, radek);
  else radky.unshift(radek);
  return radky.join('\n');
}

/** Zapíše tajemství na tmpfs s právy 0600 a vrátí cesty. */
export function writeSecrets(opts: TunnelOptions, runDir: string): {
  profile: string; auth: string; askpass: string | null;
} {
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const profile = path.join(runDir, 'money.ovpn');
  writeFileSync(profile, doplnDataCiphers(decodeProfile(opts.profileB64)), { mode: 0o600 });

  // Pořadí řádků je kontrakt openvpn: uživatel, pak heslo.
  const auth = path.join(runDir, 'auth.txt');
  writeFileSync(auth, `${stripCr(opts.authUser)}\n${stripCr(opts.authPass)}\n`, { mode: 0o600 });

  let askpass: string | null = null;
  if (opts.keyPassphrase) {
    askpass = path.join(runDir, 'askpass.txt');
    writeFileSync(askpass, `${stripCr(opts.keyPassphrase)}\n`, { mode: 0o600 });
  }
  return { profile, auth, askpass };
}

/**
 * Přečte z logu, v jaké fázi to skončilo.
 *
 * Rozlišení má praktický dopad: `AUTH_FAILED` znamená špatné heslo, kdežto
 * `Connection reset` po ověření SERVEROVÉHO certifikátu vypadá jako problém
 * s naším certifikátem — ale doloženě to bývá ODMÍTNUTÝ ÚČET (2026-07-25:
 * týž certifikát, jiný uživatel, tunel naskočil okamžitě). Kdo to čte poprvé,
 * jde jinak ladit certifikát a ztratí den.
 */
export function diagnose(log: string): string | null {
  if (/Initialization Sequence Completed/.test(log)) return null;
  if (/AUTH_FAILED/.test(log)) return 'VPN odmítla přihlašovací údaje (AUTH_FAILED)';
  if (/Connection reset/.test(log)) {
    return 'VPN spojení resetováno po ověření serverového certifikátu — '
      + 'doloženě to bývá ODMÍTNUTÝ ÚČET, ne vadný klientský certifikát '
      + '(2026-07-25: týž certifikát + jiný uživatel = tunel naskočil). '
      + 'Ověřit MONEY_VPN_AUTH_USER/PASS dřív než certifikát.';
  }
  if (/VERIFY ERROR/.test(log)) return 'VPN: ověření certifikátu protistrany selhalo';
  if (/private key password verification failed/i.test(log)) {
    return 'VPN: špatné heslo ke klíči (MONEY_VPN_KEY_PASSPHRASE)';
  }
  return null;
}

export function startTunnel(opts: TunnelOptions): TunnelHandle {
  const runDir = opts.runDir ?? '/run/money';
  const { profile, auth, askpass } = writeSecrets(opts, runDir);
  const logPath = path.join(runDir, 'vpn.log');
  const retryMax = opts.connectRetryMax ?? 3;
  const idleMs = opts.idleMs ?? 0;

  const args = [
    '--config', profile,
    '--auth-user-pass', auth,
    // Vestavěné skripty ano, uživatelské ne. `0` by zakázalo i `/sbin/ip`
    // a tunel by NIKDY nenaběhl — doložená past z 07-25.
    '--script-security', '1',
    // Strop pokusů: bez něj openvpn mlátí do zdi a vypadá to jako útok.
    '--connect-retry-max', String(retryMax),
    '--log', logPath,
  ];
  if (askpass) args.push('--askpass', askpass);

  let proc: ChildProcess | null = null;
  let stopped = false;
  let pocetVypujcek = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const cti = (): string => {
    try { return existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''; } catch { return ''; }
  };
  const nabehl = (): boolean => /Initialization Sequence Completed/.test(cti());

  const zavri = (): void => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    proc?.kill('SIGTERM');
    proc = null;
  };

  const otevri = (): void => {
    if (proc) return;
    // ⛔ LOG SE PŘED KAŽDÝM POKUSEM VYPRÁZDNÍ.
    //
    // NAMĚŘENO 2026-08-27: dřív tu stálo, že se log nemaže a `diagnose` čte
    // celý obsah. Jenže log je KUMULATIVNÍ: jakmile v něm jednou byla chyba,
    // každá další výpůjčka na ni spadla OKAMŽITĚ a bez pokusu o spojení —
    // tunel byl po jediném selhání neopravitelný až do restartu kontejneru.
    // Doloženo: druhá výpůjčka vrátila touž chybu a v logu zůstal JEDEN pokus
    // s původním časem.
    //
    // Diagnostika musí popisovat POKUS, KTERÝ PRÁVĚ BĚŽÍ. Historie patří do
    // logu služby, ne do rozhodování o stavu cesty.
    try { writeFileSync(logPath, '', { mode: 0o600 }); } catch { /* poprvé log není */ }
    proc = spawn('openvpn', args, { stdio: 'ignore' });
    proc.on('exit', () => { proc = null; });
  };

  /** Počká, až openvpn dohlásí hotovo — nebo až se ukáže, že to nedopadne. */
  const pockejNaCestu = async (): Promise<void> => {
    const strop = Date.now() + (opts.connectTimeoutMs ?? 45_000);
    for (;;) {
      if (nabehl()) return;
      // ⛔ DOKUD OPENVPN ŽIJE, NESAHAT MU DO POKUSŮ.
      //
      // NAMĚŘENO 2026-08-27: tady se volalo `diagnose(cti())` a při jakémkoli
      // nálezu se házela chyba — volající pak tunel ZAVŘEL. Jenže `Connection
      // reset` je u téhle protistrany PŘECHODNÝ a openvpn se z něj sám
      // zotavuje; `--connect-retry-max` je právě na to. V logu pak stálo:
      //     Connection reset, restarting [0]
      //     Restart pause, 2 second(s)
      //     SIGTERM[hard,init_instance] received, process exiting
      // Ten SIGTERM poslal NÁŠ kód uprostřed pauzy před druhým pokusem.
      // Ruční pokus s týmž profilem a `--connect-retry-max 3` naskočil.
      //
      // Verdikt patří openvpn: buď cestu otevře, nebo sám skončí (vyčerpá
      // pokusy). Teprve pak se čte diagnostika — a jako popis TOHO, co se
      // stalo, ne jako důvod zásahu do běžícího pokusu.
      if (!proc) throw new Error(diagnose(cti()) ?? 'VPN: openvpn skončil, aniž by cesta naběhla');
      if (Date.now() > strop) throw new Error(diagnose(cti()) ?? 'VPN: cesta nenaběhla do stropu');
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  return {
    async lease() {
      if (stopped) throw new Error('VPN: tunel je zastavený');
      // Výpujčka ruší naplánované zavření — série dotazů jede po JEDNOM spojení.
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      pocetVypujcek += 1;
      try {
        otevri();
        await pockejNaCestu();
      } catch (e) {
        pocetVypujcek -= 1;
        if (pocetVypujcek === 0) zavri();
        throw e;
      }
      let vraceno = false;
      return () => {
        if (vraceno) return; // dvojí vrácení nesmí spustit zavření předčasně
        vraceno = true;
        pocetVypujcek -= 1;
        if (pocetVypujcek > 0 || stopped) return;
        if (idleMs <= 0) return; // nula = starý trvalý režim
        idleTimer = setTimeout(() => { idleTimer = null; if (pocetVypujcek === 0) zavri(); }, idleMs);
        // Časovač nesmí držet proces naživu při vypínání.
        (idleTimer as unknown as { unref?: () => void }).unref?.();
      };
    },
    leases() { return pocetVypujcek; },
    stop() {
      stopped = true;
      zavri();
    },
    isUp() {
      return !stopped && proc !== null && nabehl();
    },
    state() {
      if (stopped) return 'idle';
      if (!proc) return diagnose(cti()) ? 'error' : 'idle';
      return nabehl() ? 'up' : 'starting';
    },
    lastError() {
      return diagnose(cti());
    },
    logPath,
  };
}
