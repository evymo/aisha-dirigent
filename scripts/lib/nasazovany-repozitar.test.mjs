import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { envWithoutGitLocation } from "./git-worktree-health.mjs";
import {
  bezUdaju,
  forgejoDeklarace,
  forgejoZaklad,
  nasazovanyRepozitar,
  remoteNasazeni,
  remoteProRepozitar,
  rozeberRemotes,
  rozporyDeklarace,
  tvrzeniProstredi,
  zManifestu,
} from "./nasazovany-repozitar.mjs";

const LIB = dirname(fileURLToPath(import.meta.url));
const CLI = join(LIB, "nasazovany-repozitar.mjs");

describe("nasazovany-repozitar — deklarace", () => {
  it("manifest: repo i větev, komentáře pryč, výchozí větev main", () => {
    expect(zManifestu("story: x\nrepo: testfork/testfork-orchestrator  # fork\nbranch: nasazeni\n")).toEqual({
      repo: "testfork/testfork-orchestrator",
      vetev: "nasazeni",
    });
    expect(zManifestu("repo: a/b\n").vetev).toBe("main");
  });

  it("jeden výklad: ořez, párové uvozovky, odsazení, komentář za hodnotou, CRLF", () => {
    expect(zManifestu('repo: "org/fork"\nbranch: \'nasazeni\'\n')).toEqual({ repo: "org/fork", vetev: "nasazeni" });
    expect(zManifestu("  repo:   org/fork  \n\tbranch: x   # komentář\n")).toEqual({ repo: "org/fork", vetev: "x" });
    expect(zManifestu("repo: org/fork\r\nbranch: nasazeni/x\r\n")).toEqual({ repo: "org/fork", vetev: "nasazeni/x" });
    // Klíč, jehož jméno obsahuje jméno jiného klíče, mu řádek nebere (`upstream_repo:` není
    // `repo:`), a zakomentovaný řádek deklarace není.
    expect(zManifestu("repo: org/fork\nupstream_repo: jiny/zdroj\nupstream_pr: PR 1\n# branch: zakomentovana\n")).toEqual({
      repo: "org/fork",
      vetev: "main",
      upstreamRepo: "jiny/zdroj",
      upstreamPr: "PR 1",
    });
    // Řádky aplikací a příběhu výklad nezajímají.
    expect(zManifestu("story: x\nrepo: org/fork\napp: a:frontend:docker-compose.x.yml\n")).toEqual({ repo: "org/fork", vetev: "main" });
  });

  it("neplatná deklarace je CHYBA s vysvětlením — nikdy odhad", () => {
    // Prázdná hodnota větve není `main` (dřív: story-init poslal do Coolify prázdnou větev, pomocník řekl main).
    expect(() => zManifestu("repo: org/fork\nbranch:\n")).toThrow(/`branch:` s PRÁZDNOU hodnotou/);
    expect(() => zManifestu('repo: org/fork\nbranch: ""\n')).toThrow(/`branch:` s PRÁZDNOU hodnotou/);
    expect(() => zManifestu("repo: org/fork\nbranch:   # jen komentář\n")).toThrow(/`branch:` s PRÁZDNOU hodnotou/);
    // Dva řádky téhož klíče: dřív jeden čtenář bral první, druhý poslední.
    expect(() => zManifestu("repo: org/fork\nbranch: a\nbranch: b\n")).toThrow(/2 řádky `branch:`.*nejednoznačná/);
    expect(() => zManifestu("repo: org/fork\nbranch: a\n  branch: a\n"), "i dva STEJNÉ řádky").toThrow(/2 řádky `branch:`/);
    expect(() => zManifestu("repo: org/a\nrepo: org/b\n")).toThrow(/2 řádky `repo:`.*nejednoznačná/);
    // Mezera uvnitř hodnoty (i v uvozovkách).
    expect(() => zManifestu("repo: org/fork\nbranch: a b\n")).toThrow(/`branch:` s mezerou uvnitř/);
    expect(() => zManifestu('repo: "org /fork"\n')).toThrow(/`repo:` s mezerou uvnitř/);
    // repo: povinné a neprázdné.
    expect(() => zManifestu("branch: main\n")).toThrow(/nemá `repo:`/);
    expect(() => zManifestu("repo:\nbranch: main\n")).toThrow(/`repo:` s PRÁZDNOU hodnotou/);
  });

  it("nepárová uvozovka a jiný neznámý tvar s uvozovkou je CHYBA — párové uvozovky projdou (kotva)", () => {
    // Kotva: pár kolem celé hodnoty je platný tvar, oběma druhy uvozovek, i s komentářem za ním.
    expect(zManifestu('repo: "org/fork"   # odkud\nbranch: \'nasazeni/x\'\n')).toEqual({ repo: "org/fork", vetev: "nasazeni/x" });
    // Neznámý tvar se odmítá, neopravuje (dřív: `"x` zůstalo jménem větve).
    expect(() => zManifestu('repo: org/fork\nbranch: "x\n')).toThrow(/`branch:` s NEPÁROVOU uvozovkou/);
    expect(() => zManifestu("repo: org/fork\nbranch: x'\n")).toThrow(/`branch:` s NEPÁROVOU uvozovkou/);
    expect(() => zManifestu('repo: org/fork\nbranch: na"sazeni\n')).toThrow(/`branch:` s NEPÁROVOU uvozovkou/);
    expect(() => zManifestu('repo: "org/fork\nbranch: main\n')).toThrow(/`repo:` s NEPÁROVOU uvozovkou/);
    expect(() => zManifestu('repo: org/fork\nbranch: "x" y\n')).toThrow(/`branch:` s textem za uzavírací uvozovkou/);
    expect(() => zManifestu('repo: org/fork\nbranch: "a\'b"\n')).toThrow(/`branch:` s uvozovkou uvnitř hodnoty/);
    // Komentář začínající uvnitř nezavřené uvozovky hodnotu nezachrání.
    expect(() => zManifestu('repo: org/fork\nbranch: "x # y\n')).toThrow(/NEPÁROVOU uvozovkou/);
  });

  it("`#` přilepený k holé hodnotě je CHYBA, ne zkrácení; v uvozovkách se hodnota čte celá (rada d8)", () => {
    // Dřív `branch: fix#12` tiše znamenalo větev `fix`.
    expect(() => zManifestu("repo: org/fork\nbranch: fix#12\n")).toThrow(/`branch:` s `#` přilepeným k hodnotě \(fix#12\).*v párových uvozovkách/);
    expect(() => zManifestu("repo: org/fork#x\n")).toThrow(/`repo:` s `#` přilepeným/);
    expect(() => zManifestu("repo: org/fork\nupstream_pr: PR#12\n")).toThrow(/`upstream_pr:` s `#` přilepeným/);
    expect(() => zManifestu("repo: org/fork\nbranch: fix#12 # komentář\n"), "první `#` rozhoduje").toThrow(/přilepeným/);
    // Kotvy: v uvozovkách celá hodnota; `#` po mezeře nebo na začátku je komentář.
    expect(zManifestu('repo: org/fork\nbranch: "fix#12"\n').vetev).toBe("fix#12");
    expect(zManifestu("repo: org/fork\nbranch: fix #12\n").vetev).toBe("fix");
    expect(zManifestu("repo: org/fork\nbranch: fix\t# komentář\n").vetev).toBe("fix");
    // Za uzavírací uvozovkou totéž: komentář jen po mezeře.
    expect(() => zManifestu('repo: org/fork\nbranch: "x"#c\n')).toThrow(/`branch:` s textem za uzavírací uvozovkou \('#c'\)/);
    expect(zManifestu('repo: org/fork\nbranch: "x" # c\n').vetev).toBe("x");
  });

  it("tvar hodnoty: `branch:` jen jméno větve gitu, `repo:` jen org/jméno — jinak CHYBA s důvodem (rada d8)", () => {
    const vetev = (v) => () => zManifestu(`repo: org/fork\nbranch: ${v}\n`);
    // Hodnota začínající `-` by volajícím doputovala jako přepínač gitu — i v uvozovkách.
    expect(vetev("--upload-pack=x")).toThrow(/`branch:` s hodnotou '--upload-pack=x', kterou nevykládám: začíná `-`/);
    expect(vetev('"-x"')).toThrow(/začíná `-`/);
    // Podmnožina `git check-ref-format --branch`.
    for (const [hodnota, vzor] of [
      ["a..b", /nese `\.\.`/],
      ["a~1", /~ \^ :/],
      ["a^", /~ \^ :/],
      ["a:b", /~ \^ :/],
      ["a?", /~ \^ :/],
      ["a*", /~ \^ :/],
      ["a[b", /~ \^ :/],
      ["a\\b", /~ \^ :/],
      ["a\u0001b", /řídicí znak/],
      ["@", /je `@`/],
      ["a@{1}", /nese `@\{`/],
      ["/a", /začíná nebo končí `\/`/],
      ["a/", /začíná nebo končí `\/`/],
      ["a//b", /nese `\/\/`/],
      [".a", /začíná tečkou/],
      ["a/.b", /začíná tečkou/],
      ["a.", /končí tečkou/],
      ["a.lock", /`\.lock`/],
      ["a.lock/b", /`\.lock`/],
    ]) {
      expect(vetev(hodnota), hodnota).toThrow(vzor);
    }
    // Kotvy: běžná jména větví projdou (i znaky, které git dovoluje).
    for (const ok of ["main", "nasazeni/cleenack", "release-1.2", "feat/a_b", "x@y", "a+b", "a.lock-ne"]) {
      expect(zManifestu(`repo: org/fork\nbranch: ${ok}\n`).vetev, ok).toBe(ok);
    }
    // repo: org/jméno z povolených znaků, bez `..`, schématu a hostitele.
    for (const spatne of ["../../jiny/x", "https://jinde.example.test/org/x", "jinde.example.test:org/x", "org/x/y", "org", "org/..", "./x", "org/a..b", "~/x", "org/x?y", "-x/y z"]) {
      expect(() => zManifestu(`repo: ${spatne}\n`), spatne).toThrow(/`repo:`/);
    }
    expect(() => zManifestu("repo: ../../jiny/x\n")).toThrow(/`repo:` s hodnotou '\.\.\/\.\.\/jiny\/x', kterou nevykládám: čekám `org\/jméno`/);
    expect(() => zManifestu("repo: org/a..b\n")).toThrow(/nese `\.\.` nebo část `\.`/);
    for (const ok of ["org/fork", "Org.Name/repo_1-x", "aisha/evymo-ai-orchestrator", "org/.profile"]) {
      expect(zManifestu(`repo: ${ok}\n`).repo, ok).toBe(ok);
    }
  });

  it("`branch: ~`, typografické uvozovky a blokový text jsou CHYBA — ne jméno větve (rada d8)", () => {
    expect(() => zManifestu("repo: org/fork\nbranch: ~\n")).toThrow(/`branch:` s hodnotou '~', kterou nevykládám/);
    expect(() => zManifestu("repo: org/fork\nbranch: “nasazeni”\n")).toThrow(/`branch:` s typografickou uvozovkou/);
    expect(() => zManifestu("repo: „org/fork“\n")).toThrow(/`repo:` s typografickou uvozovkou/);
    expect(() => zManifestu("repo: org/fork\nbranch: ‘x’\n")).toThrow(/typografickou uvozovkou/);
    expect(() => zManifestu("repo: org/fork\nbranch: |\n  main\n")).toThrow(/`branch:` s blokovým textem \(\|\)/);
    expect(() => zManifestu("repo: org/fork\nbranch: >-\n  main\n")).toThrow(/blokovým textem/);
    // Kotva: volný text odkazu na PR typografické uvozovky nést smí (není to identifikátor).
    expect(zManifestu('repo: org/fork\nupstream_pr: "PR 12 „oprava“"\n').upstreamPr).toBe("PR 12 „oprava“");
  });

  it("deklarace jsou klíče NEJVYŠŠÍ úrovně: klíč pod jiným mapováním ani text bloku deklarace nejsou (rada d8)", () => {
    // Dřív se odsazený klíč četl vždy — i když patřil jinému objektu.
    expect(zManifestu("repo: org/fork\npovrch:\n  branch: jina\n")).toEqual({ repo: "org/fork", vetev: "main" });
    expect(() => zManifestu("povrch:\n  repo: jiny/x\nbranch: main\n"), "jen vnořený repo:").toThrow(/nemá `repo:`/);
    expect(zManifestu("repo: org/fork\npopis: |\n  branch: z-textu\n  repo: jiny/x\n")).toEqual({ repo: "org/fork", vetev: "main" });
    expect(zManifestu("repo: org/fork\npopis: >-   # text\n  branch: z-textu\n\n  branch: po-prazdnem-radku\n").vetev).toBe("main");
    expect(zManifestu("repo: org/fork\na:\n  b:\n    branch: hluboko\n").vetev).toBe("main");
    expect(zManifestu("seznam:\n  - repo: jiny/x\nrepo: org/fork\n").repo).toBe("org/fork");
    expect(zManifestu("repo: org/fork\npovrch:   # poznámka\n\tbranch: jina\n").vetev).toBe("main");
    // Kontejner končí řádkem s odsazením nejvýš jako on — klíč za ním deklarace JE.
    expect(zManifestu("popis: |\n  text\nbranch: po-bloku\nrepo: org/fork\n").vetev).toBe("po-bloku");
    expect(zManifestu("povrch:\nbranch: hned\nrepo: org/fork\n").vetev).toBe("hned");
    expect(zManifestu("repo: org/fork\n  popis: |\n    branch: v-bloku\n  branch: za-blokem\n").vetev).toBe("za-blokem");
    // …a zavřený kontejner už nic nepohltí: odsazený klíč za řádkem nejvyšší úrovně je zase deklarace.
    expect(zManifestu("popis: |\n  text\nrepo: org/fork\n  branch: odsazena\n").vetev).toBe("odsazena");
    // Kotva: odsazení BEZ nadřazeného kontejneru úroveň nemění (story-init ho vždy četl).
    expect(zManifestu("repo: org/fork\n  branch: odsazena\n").vetev).toBe("odsazena");
    expect(zManifestu("  branch: odsazena\nrepo: org/fork\n").vetev).toBe("odsazena");
    // Dva klíče téhož jména: jeden vnořený a jeden nahoře nejednoznačnost nejsou.
    expect(zManifestu("repo: org/fork\nbranch: nahore\npovrch:\n  branch: vnorena\n").vetev).toBe("nahore");
  });

  it("klíč deklarace s mezerou nebo tabulátorem před dvojtečkou je CHYBA — ne tichý návrat k `main`", () => {
    // Dřív `branch : x` klíčem nebylo, výklad mlčky dosadil výchozí `main`.
    expect(() => zManifestu("repo: org/fork\nbranch : nasazeni\n")).toThrow(/klíč deklarace `branch` s mezerou před dvojtečkou \(branch : nasazeni\)/);
    expect(() => zManifestu("repo\t: org/fork\n")).toThrow(/klíč deklarace `repo` s mezerou před dvojtečkou/);
    expect(() => zManifestu("repo: org/fork\nupstream_repo  : org/zdroj\n")).toThrow(/`upstream_repo` s mezerou před dvojtečkou/);
    expect(() => zManifestu("repo: org/fork\nupstream_pr : PR 1\n")).toThrow(/`upstream_pr` s mezerou před dvojtečkou/);
    expect(() => zManifestu("repo: org/fork\n  branch : odsazena\n"), "osiřelé odsazení = nejvyšší úroveň").toThrow(/mezerou před dvojtečkou/);
    // Kontejnerové pravidlo platí stejně: vnořený řádek deklarace není, tedy ani chyba deklarace.
    expect(zManifestu("repo: org/fork\npovrch:\n  branch : jina\n").vetev).toBe("main");
    // Kotvy: jiný klíč s mezerou vykladače nezajímá; klíč, který jméno deklarace jen začíná, taky ne.
    expect(zManifestu("repo: org/fork\nstory : x\nbranches : y\n")).toEqual({ repo: "org/fork", vetev: "main" });
  });

  it("klíče upstreamu čte týž výklad: nepovinné, stejná pravidla, odkaz na PR smí nést mezery", () => {
    // Chybějící klíč není chyba — pole zůstane nevyplněné.
    const bez = zManifestu("repo: org/fork\n");
    expect([bez.upstreamRepo, bez.upstreamPr]).toEqual([undefined, undefined]);
    const s = zManifestu('repo: org/fork\n  upstream_repo: "host.example.test/Org/Zdroj"  # rodič\nupstream_pr: PR 1234   # ruší odchylku\n');
    expect([s.upstreamRepo, s.upstreamPr]).toEqual(["host.example.test/Org/Zdroj", "PR 1234"]);
    // `#` uvnitř párových uvozovek je součást hodnoty; mimo ně komentář.
    expect(zManifestu('repo: org/fork\nupstream_pr: "PR #12 (oprava)"\n').upstreamPr).toBe("PR #12 (oprava)");
    expect(zManifestu("repo: org/fork\nupstream_pr: PR 12 # poznámka\n").upstreamPr).toBe("PR 12");
    // `repo:` a `upstream_repo:` jsou dva klíče — jeden druhému řádek nebere.
    expect(zManifestu("upstream_repo: org/zdroj\nrepo: org/fork\n")).toMatchObject({ repo: "org/fork", upstreamRepo: "org/zdroj" });
    // Stejná pravidla: duplicita, prázdná hodnota, mezera v identifikátoru, nepárová uvozovka.
    expect(() => zManifestu("repo: org/fork\nupstream_repo: a/b\nupstream_repo: a/b\n")).toThrow(/2 řádky `upstream_repo:`.*nejednoznačná/);
    expect(() => zManifestu("repo: org/fork\nupstream_pr: PR 1\nupstream_pr: PR 2\n")).toThrow(/2 řádky `upstream_pr:`/);
    expect(() => zManifestu("repo: org/fork\nupstream_repo:\n")).toThrow(/`upstream_repo:` s PRÁZDNOU hodnotou/);
    expect(() => zManifestu("repo: org/fork\nupstream_pr: #12\n"), "holé `#12` je komentář → prázdná hodnota, nahlas").toThrow(/`upstream_pr:` s PRÁZDNOU hodnotou/);
    expect(() => zManifestu("repo: org/fork\nupstream_repo: org /zdroj\n")).toThrow(/`upstream_repo:` s mezerou uvnitř/);
    expect(() => zManifestu('repo: org/fork\nupstream_pr: "PR 12\n')).toThrow(/`upstream_pr:` s NEPÁROVOU uvozovkou/);
  });

  it("hodnota tvrzená jiným kanálem: shoda projde, rozpor je chyba, mlčící kanál nic netvrdí", () => {
    const vyklad = { repo: "org/fork", vetev: "main" };
    expect(rozporyDeklarace(vyklad, ["branch:GIT_BRANCH v prostředí=", "branch:--branch=", "repo:--repo="])).toEqual([]);
    expect(
      rozporyDeklarace({ repo: "org/fork", vetev: "nasazeni" }, ["branch:GIT_BRANCH v prostředí=nasazeni", "branch:--branch=nasazeni", "repo:--repo=org/fork"]),
    ).toEqual([]);
    const r = rozporyDeklarace(vyklad, ["branch:GIT_BRANCH v prostředí=nasazeni", "branch:--branch=jina", "repo:--repo=jiny/repo"]);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatch(/GIT_BRANCH v prostředí tvrdí větev 'nasazeni', manifest deklaruje 'main'.*větev se deklaruje v manifestu/);
    expect(r[1]).toMatch(/--branch tvrdí větev 'jina'/);
    expect(r[2]).toMatch(/--repo tvrdí repozitář 'jiny\/repo', manifest deklaruje 'org\/fork'.*repozitář se deklaruje v manifestu/);
    // Co tvrdí PROSTŘEDÍ, ví jen vykladač: GIT_BRANCH, neprázdný.
    expect(tvrzeniProstredi({ GIT_BRANCH: "nasazeni" })).toEqual(["branch:GIT_BRANCH v prostředí=nasazeni"]);
    expect(tvrzeniProstredi({ GIT_BRANCH: "" })).toEqual([]);
    expect(tvrzeniProstredi({})).toEqual([]);
    // Velikost písmen je rozdíl — nehádá se, že „to bude totéž“.
    expect(rozporyDeklarace(vyklad, ["repo:--repo=Org/Fork"])).toHaveLength(1);
    // Neznámý klíč nebo tvar tvrzení se odmítá.
    expect(() => rozporyDeklarace(vyklad, ["GIT_BRANCH v prostředí=x"])).toThrow(/čekám <klíč>:<kanál>=<hodnota>/);
    expect(() => rozporyDeklarace(vyklad, ["story:--story=x"])).toThrow(/klíčem branch \| repo/);
  });

  it("základ Forgeja: FORGEJO_URL má přednost, jinak https://FORGEJO_DOMAIN, jinak prázdno", () => {
    expect(forgejoZaklad({ FORGEJO_URL: "https://f.example.test/", FORGEJO_DOMAIN: "g.example.test" })).toBe("https://f.example.test");
    expect(forgejoZaklad({ FORGEJO_DOMAIN: "g.example.test" })).toBe("https://g.example.test");
    expect(forgejoZaklad({})).toBe("");
    // Odkud deklarace je — doktor to vypisuje a obě čtení (story-init, doktor) mají jedno pravidlo.
    expect(forgejoDeklarace({ FORGEJO_URL: "https://f.example.test/", FORGEJO_DOMAIN: "g.example.test" })).toEqual({ url: "https://f.example.test", zdroj: "FORGEJO_URL" });
    expect(forgejoDeklarace({ FORGEJO_URL: "  ", FORGEJO_DOMAIN: "g.example.test" })).toEqual({ url: "https://g.example.test", zdroj: "FORGEJO_DOMAIN" });
    expect(forgejoDeklarace({})).toBeNull();
  });

  it("URL do logu nenese přihlašovací údaje", () => {
    expect(bezUdaju("https://aisha:tajne@f.example.test/a/b.git")).toBe("https://f.example.test/a/b.git");
    expect(nasazovanyRepozitar("repo: a/b", { FORGEJO_URL: "https://u:t@f.example.test" }).url).toBe("https://f.example.test/a/b.git");
  });

  it("údaje jsou všechno po POSLEDNÍ `@` před hostitelem — heslo s neescapovaným `@` nezůstane ani zčásti (rada d8)", () => {
    // Dřív `[^/@]*@` skončil PRVNÍM zavináčem: z `u:ta@jne@host` zůstalo `jne@host`.
    expect(bezUdaju("https://uzivatel:ta@jne@f.example.test/a/b.git")).toBe("https://f.example.test/a/b.git");
    expect(bezUdaju("https://u:a@b@c@f.example.test")).toBe("https://f.example.test");
    expect(nasazovanyRepozitar("repo: a/b", { FORGEJO_URL: "https://u:t@x@f.example.test" }).url).toBe("https://f.example.test/a/b.git");
    // Hranicí je konec autority: `@` v cestě ani v dotazu údaj není a adresa zůstane použitelná.
    expect(bezUdaju("https://f.example.test/org/a@b.git")).toBe("https://f.example.test/org/a@b.git");
    expect(bezUdaju("https://f.example.test/a.git?x=a@b")).toBe("https://f.example.test/a.git?x=a@b");
    expect(bezUdaju("https://u:p@s@f.example.test/org/a@b.git")).toBe("https://f.example.test/org/a@b.git");
    // scp tvar údaje nenese — beze změny.
    expect(bezUdaju("git@f.example.test:org/repo.git")).toBe("git@f.example.test:org/repo.git");
  });

  it("instance-overlay (druhý domov maskování): hláška o nezískaném overlayi nenese zbytek hesla s `@`", () => {
    // Totéž pravidlo posledního `@` nad volným textem hlášky. Měří se veřejnou cestou:
    // `ziskejDeklarovanyOverlay` s adresou, na kterou git nedosáhne (místní port 1).
    const d = mkdtempSync(join(tmpdir(), "bez-udaju-overlay-"));
    try {
      const skript =
        `import { ziskejDeklarovanyOverlay } from ${JSON.stringify(pathToFileURL(join(LIB, "instance-overlay.mjs")).href)};\n` +
        'try { ziskejDeklarovanyOverlay("zkouška"); process.stdout.write("BEZ CHYBY"); } catch (e) { process.stdout.write(e.message); }';
      const r = spawnSync("node", ["--input-type=module", "-e", skript], {
        encoding: "utf8",
        timeout: 60_000,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: d,
          TMPDIR: d,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: join(d, "gitconfig"),
          GIT_TERMINAL_PROMPT: "0",
          AISHA_INSTANCE_DATA_GIT_URL: "https://uzivatel:ta@jne@127.0.0.1:1/x.git",
        },
      });
      // Kotva: hláška adresu NESE (jinak by „nic tam není“ znamenalo „nic jsem neměřil“).
      expect(r.stdout, r.stderr).toMatch(/<skryto>@127\.0\.0\.1:1\/x\.git/);
      expect(r.stdout, "zbytek hesla nebo uživatel v hlášce").not.toMatch(/jne|ta@|uzivatel/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("neúplná deklarace vyhodí — nehádá se", () => {
    expect(() => nasazovanyRepozitar("branch: main", { FORGEJO_URL: "https://f.example.test" })).toThrow(/repo:/);
    expect(() => nasazovanyRepozitar("repo: a/b", {})).toThrow(/FORGEJO/);
  });

  it("remote se vybírá podle IDENTITY URL, ne podle jména", () => {
    const remotes = rozeberRemotes(
      [
        "remote.origin.url https://f.example.test/aisha/upstream.git",
        "remote.moje.url git@f.example.test:TestFork/TestFork-Orchestrator",
      ].join("\n"),
    );
    expect(remoteProRepozitar(remotes, "https://f.example.test/testfork/testfork-orchestrator.git")).toBe("moje");
    expect(remoteProRepozitar(remotes, "https://f.example.test/jiny/repo.git")).toBeNull();
  });

  it("remote nasazení bez sítě: s adresou Forgeja celá identita, bez ní cesta — a nikdy podle jména", () => {
    const remotes = [
      { name: "origin", url: "https://f.example.test/org/upstream.git" },
      { name: "moje", url: "https://uzivatel:tajne@f.example.test/Org/Fork.git" },
    ];
    // S deklarovanou adresou: host/org/repo; výstup nenese přihlašovací údaje.
    expect(remoteNasazeni(remotes, "org/fork", "https://f.example.test")).toEqual({ remote: "moje", url: "https://f.example.test/Org/Fork.git" });
    // Táž cesta na JINÉM hostiteli není tentýž repozitář.
    expect(remoteNasazeni(remotes, "org/fork", "https://jiny.example.test").duvod).toMatch(/žádný remote checkoutu neukazuje na nasazovaný repozitář https:\/\/jiny\.example\.test\/org\/fork\.git/);
    // Bez adresy Forgeja: shoda na cestu org/repo.
    expect(remoteNasazeni(remotes, "org/fork", "")).toEqual({ remote: "moje", url: "https://f.example.test/Org/Fork.git" });
    expect(remoteNasazeni(remotes, "org/neni", "").duvod).toMatch(/žádný remote checkoutu neukazuje na nasazovaný repozitář 'org\/neni'.*remoty: origin, moje/);
    // Kratší cesta nesmí trefit delší jméno (org/fork ≠ jinaorg/fork).
    expect(remoteNasazeni([{ name: "x", url: "https://f.example.test/jinaorg/fork.git" }], "org/fork", "").duvod).toMatch(/žádný remote/);
    // Bez adresy a táž cesta na dvou hostitelích: nejednoznačné — první se nevybírá.
    const dvaHostitele = [...remotes, { name: "zrcadlo", url: "git@zrcadlo.example.test:org/fork.git" }];
    expect(remoteNasazeni(dvaHostitele, "org/fork", "").duvod).toMatch(/RŮZNÝCH hostitelích.*moje: f\.example\.test\/org\/fork.*zrcadlo: zrcadlo\.example\.test\/org\/fork.*nevybírám naslepo/);
    // S adresou se táž situace rozhodne identitou.
    expect(remoteNasazeni(dvaHostitele, "org/fork", "https://zrcadlo.example.test").remote).toBe("zrcadlo");
    // Dva remoty na TÝŽ repozitář nejednoznačnost nejsou.
    expect(remoteNasazeni([...remotes, { name: "taky", url: "git@f.example.test:org/fork.git" }], "org/fork", "").remote).toBe("moje");
    expect(remoteNasazeni([], "org/fork", "").duvod).toMatch(/remoty: žádné/);
  });
});

/**
 * Mutanti nových pojistek výkladu (vzor `mutant` z nasazeni-drzene.test.mjs): kopie
 * SKUTEČNÉHO modulu s jednou změnou se načte z dočasného adresáře a nad týmž vstupem
 * musí dát jiný výklad než skutečný vykladač. Přežije-li mutant, test pojistku neměří.
 */
describe("mutanti vykladače: každou novou pojistku test pozná (rada d8)", () => {
  let d;
  let poradi = 0;
  beforeAll(() => {
    d = mkdtempSync(join(tmpdir(), "mutant-vykladace-"));
  });
  afterAll(() => d && rmSync(d, { recursive: true, force: true }));

  async function mutant(z, na) {
    const zdroj = readFileSync(CLI, "utf8");
    expect(zdroj.split(z).length - 1, `mutace se nemá čeho chytit (nebo chytí víc míst): ${z}`).toBe(1);
    const cesta = join(d, `mutant-${++poradi}.mjs`);
    writeFileSync(cesta, zdroj.replace(z, na).replaceAll('from "./', `from "${pathToFileURL(LIB).href}/`));
    return import(pathToFileURL(cesta).href);
  }
  const vyklad = (modul, text) => {
    try {
      const { repo, vetev } = modul.zManifestu(text);
      return `ok ${repo} ${vetev}`;
    } catch (e) {
      return `chyba ${e.message}`;
    }
  };

  const MUTANTI = [
    {
      jmeno: "`#` přilepený k hodnotě se tiše uřízne",
      z: "if (krizek > 0 && !/\\s/.test(text[krizek - 1])) {",
      na: "if (false) {",
      text: "repo: org/fork\nbranch: fix#12\n",
      cekam: /^chyba .*přilepeným/,
    },
    {
      jmeno: "hodnota začínající `-` projde",
      z: '[(v) => v.startsWith("-"), ',
      na: "[(v) => false, ",
      text: "repo: org/fork\nbranch: --upload-pack=x\n",
      cekam: /^chyba .*začíná `-`/,
    },
    {
      jmeno: "`repo:` bez kontroly tvaru org/jméno",
      z: "if (!/^[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+$/.test(repo)) {",
      na: "if (false) {",
      text: "repo: https://jinde.example.test/org/x\n",
      cekam: /^chyba .*čekám `org\/jméno`/,
    },
    {
      jmeno: "klíč pod jiným mapováním se čte jako deklarace",
      z: "if (kontejner !== null && odsazeni > kontejner) continue;",
      na: "if (false) continue;",
      text: "repo: org/fork\npovrch:\n  branch: jina\n",
      cekam: /^ok org\/fork main$/,
    },
    {
      jmeno: "řádek otevírající kontejner se nepozná (blokový text se čte)",
      z: "else if (OTEVIRA_KONTEJNER.test(r)) kontejner = odsazeni;",
      na: "else if (false) kontejner = odsazeni;",
      text: "repo: org/fork\npopis: |\n  branch: z-textu\n",
      cekam: /^ok org\/fork main$/,
    },
    {
      jmeno: "kontejner se nezavře (odsazený klíč za ním se ztratí)",
      z: "    kontejner = null;\n",
      na: "",
      text: "popis: |\n  text\nrepo: org/fork\n  branch: odsazena\n",
      cekam: /^ok org\/fork odsazena$/,
    },
    {
      jmeno: "odsazení bez kontejneru se bere jako vnoření (story-init by stavěl odjinud)",
      z: "if (kontejner !== null && odsazeni > kontejner) continue;",
      na: "if (odsazeni > (kontejner ?? 0)) continue;",
      text: "repo: org/fork\n  branch: odsazena\n",
      cekam: /^ok org\/fork odsazena$/,
    },
    {
      jmeno: "klíč s mezerou před dvojtečkou se tiše přeskočí (→ main)",
      z: "    if (mezeraPred) {",
      na: "    if (false) {",
      text: "repo: org/fork\nbranch : nasazeni\n",
      cekam: /^chyba .*mezerou před dvojtečkou/,
    },
    {
      jmeno: "typografická uvozovka v jménu projde",
      z: "if (!mezera && TYPOGRAFICKE_UVOZOVKY.test(hodnota)) {",
      na: "if (false) {",
      text: "repo: org/fork\nbranch: “nasazeni”\n",
      cekam: /^chyba .*typografickou/,
    },
    {
      jmeno: "blokový text jako hodnota projde",
      z: "if (!uvozovka && /^[|>][-+0-9]*$/.test(hodnota)) {",
      na: "if (false) {",
      text: "repo: org/fork\nbranch: |\n  main\n",
      cekam: /^chyba .*blokovým textem/,
    },
  ];

  it.each(MUTANTI)("mutant: $jmeno — dá jiný výklad než skutečný vykladač", async ({ z, na, text, cekam }) => {
    const skutecny = vyklad({ zManifestu }, text);
    expect(skutecny, "kontrolní vzorek: skutečný vykladač").toMatch(cekam);
    const m = await mutant(z, na);
    expect(vyklad(m, text), "mutant přežil — test tu pojistku neměří").not.toBe(skutecny);
  });
});

describe("nasazovany-repozitar CLI — výklad a rozpor kanálů (bez sítě)", () => {
  let d;
  const spust = (argv, env = {}) =>
    spawnSync("node", [CLI, ...argv], {
      encoding: "utf8",
      env: { ...envWithoutGitLocation(process.env), FORGEJO_URL: "https://forge.example.test", FORGEJO_DOMAIN: "", GIT_BRANCH: "", ...env },
    });
  const manifest = (jmeno, text) => {
    const f = join(d, `${jmeno}.manifest`);
    writeFileSync(f, text);
    return f;
  };
  beforeAll(() => {
    d = mkdtempSync(join(tmpdir(), "nasazovany-vyklad-"));
  });
  afterAll(() => d && rmSync(d, { recursive: true, force: true }));

  it("--vyklad nepotřebuje adresu Forgeja; --deklarace ano a nese i cestu repozitáře", () => {
    const m = manifest("ok", 'repo: "org/fork"\nbranch: nasazeni\n');
    const v = spust(["--manifest", m, "--vyklad"], { FORGEJO_URL: "" });
    expect([v.status, v.stdout], v.stderr).toEqual([0, "nasazeni\torg/fork\n"]);
    const k = spust(["--manifest", m, "--deklarace"]);
    expect([k.status, k.stdout], k.stderr).toEqual([0, "nasazeni\thttps://forge.example.test/org/fork.git\torg/fork\n"]);
    expect(spust(["--manifest", m, "--deklarace"], { FORGEJO_URL: "" }).status).toBe(2);
  });

  it("neplatná deklarace → 2 s vysvětlením na stderr, stdout prázdný", () => {
    for (const [text, vzor] of [
      ["repo: org/fork\nbranch:\n", /PRÁZDNOU hodnotou/],
      ["repo: org/fork\nbranch: a\nbranch: b\n", /nejednoznačná/],
      ["repo: org/fork\nbranch: a b\n", /mezerou uvnitř/],
      ["branch: main\n", /nemá `repo:`/],
    ]) {
      const r = spust(["--manifest", manifest("vada", text), "--vyklad"]);
      expect([r.status, r.stdout], text).toEqual([2, ""]);
      expect(r.stderr, text).toMatch(vzor);
    }
    const neni = spust(["--manifest", join(d, "neni.manifest"), "--vyklad"]);
    expect(neni.status).toBe(2);
    expect(neni.stderr).toMatch(/neni\.manifest/);
  });

  it("GIT_BRANCH v prostředí: --deklarace ho porovná SAMA — shodný projde, odlišný je rozpor (2)", () => {
    // Recenze 2026-10-04: rozpor znal jen story-init (krok 3, PO odloženém wipu). Teď ho
    // vrací už --deklarace, tedy krok 2b2 — bez toho, aby jí ho volající musel předat.
    const m = manifest("bez-vetve", "repo: org/fork\n");
    const jina = spust(["--manifest", m, "--deklarace"], { GIT_BRANCH: "jina" });
    expect([jina.status, jina.stdout]).toEqual([2, ""]);
    expect(jina.stderr).toMatch(/GIT_BRANCH v prostředí tvrdí větev 'jina', manifest deklaruje 'main'.*větev se deklaruje v manifestu/);
    // Shodná větev i prázdná proměnná projdou — tři sloupce jako dřív (krok 2b2 je čte).
    for (const vetev of ["main", ""]) {
      const r = spust(["--manifest", m, "--deklarace"], { GIT_BRANCH: vetev });
      expect([r.status, r.stdout], `GIT_BRANCH=${vetev}: ${r.stderr}`).toEqual([0, "main\thttps://forge.example.test/org/fork.git\torg/fork\n"]);
    }
    // Rozpor je vlastnost deklarace, ne adresy: ohlásí se i bez adresy Forgeja.
    const bezAdresy = spust(["--manifest", m, "--deklarace"], { GIT_BRANCH: "jina", FORGEJO_URL: "" });
    expect(bezAdresy.status).toBe(2);
    expect(bezAdresy.stderr).toMatch(/GIT_BRANCH v prostředí tvrdí větev 'jina'/);
    // S větví v manifestu totéž.
    const s = manifest("s-vetvi", "repo: org/fork\nbranch: nasazeni\n");
    expect(spust(["--manifest", s, "--deklarace"], { GIT_BRANCH: "nasazeni" }).status).toBe(0);
    expect(spust(["--manifest", s, "--deklarace"], { GIT_BRANCH: "main" }).status).toBe(2);
  });

  it("--vyklad zůstává bez prostředí; --tvrdi-prostredi mu zapne totéž porovnání (doktor, bez adresy Forgeja)", () => {
    const m = manifest("bez-vetve-2", "repo: org/fork\n");
    expect(spust(["--manifest", m, "--vyklad"], { GIT_BRANCH: "jina" }).stdout).toBe("main\torg/fork\n");
    const rozpor = spust(["--manifest", m, "--vyklad", "--tvrdi-prostredi"], { GIT_BRANCH: "jina", FORGEJO_URL: "" });
    expect([rozpor.status, rozpor.stdout]).toEqual([2, ""]);
    expect(rozpor.stderr).toMatch(/GIT_BRANCH v prostředí tvrdí větev 'jina', manifest deklaruje 'main'/);
    // Táž hláška jako z --deklarace (krok 2b2, story-init) — jedno místo, jeden verdikt.
    expect(rozpor.stderr).toBe(spust(["--manifest", m, "--deklarace"], { GIT_BRANCH: "jina" }).stderr);
    expect(spust(["--manifest", m, "--vyklad", "--tvrdi-prostredi"], { GIT_BRANCH: "main", FORGEJO_URL: "" }).stdout).toBe("main\torg/fork\n");
  });

  it("story-init přidává jen tvrzení z příkazové řádky; prostředí k nim vykladač přičte sám", () => {
    const m = manifest("bez-vetve-3", "repo: org/fork\n");
    const volani = (env, vetevCli) => spust(["--manifest", m, "--deklarace", "--tvrdi", `branch:--branch=${vetevCli}`, "--tvrdi", "repo:--repo="], env);
    const cli = volani({}, "jina");
    expect(cli.status).toBe(2);
    expect(cli.stderr).toMatch(/--branch tvrdí větev 'jina'/);
    // Oba kanály naráz: obě věty, žádná se neztratí.
    const oba = volani({ GIT_BRANCH: "z-prostredi" }, "z-radky");
    expect(oba.status).toBe(2);
    expect(oba.stderr).toMatch(/GIT_BRANCH v prostředí tvrdí větev 'z-prostredi'/);
    expect(oba.stderr).toMatch(/--branch tvrdí větev 'z-radky'/);
    const shoda = volani({ GIT_BRANCH: "main" }, "main");
    expect([shoda.status, shoda.stdout], shoda.stderr).toEqual([0, "main\thttps://forge.example.test/org/fork.git\torg/fork\n"]);
  });

  it("--repo vedle manifestu: shodný projde, jiný je rozpor (2) — manifest tiše nevyhrává", () => {
    const m = manifest("repo-cli", "repo: org/fork\nbranch: nasazeni\n");
    const tvrdi = (repo) => spust(["--manifest", m, "--deklarace", "--tvrdi", "branch:--branch=", "--tvrdi", `repo:--repo=${repo}`]);
    const jiny = tvrdi("jiny/repo");
    expect([jiny.status, jiny.stdout]).toEqual([2, ""]);
    expect(jiny.stderr).toMatch(/--repo tvrdí repozitář 'jiny\/repo', manifest deklaruje 'org\/fork'.*repozitář se deklaruje v manifestu/);
    expect(tvrdi("org/fork").status).toBe(0);
    expect(tvrdi("").status).toBe(0);
    // Tvrzení v neznámém tvaru je chyba volání, ne tichý průchod.
    const spatne = spust(["--manifest", m, "--deklarace", "--tvrdi", "--repo=jiny/repo"]);
    expect([spatne.status, spatne.stdout]).toEqual([2, ""]);
    expect(spatne.stderr).toMatch(/čekám <klíč>:<kanál>=<hodnota>/);
  });

  it("--vyklad vydá klíče upstreamu na dalších řádcích, jen když je manifest nese", () => {
    const m = manifest("upstream", 'repo: org/fork\nbranch: nasazeni/x\nupstream_repo: org/zdroj\nupstream_pr: "PR #12"\n');
    const r = spust(["--manifest", m, "--vyklad"]);
    expect([r.status, r.stdout], r.stderr).toEqual([0, "nasazeni/x\torg/fork\nupstream_repo\torg/zdroj\nupstream_pr\tPR #12\n"]);
    const jen = spust(["--manifest", manifest("jen-pr", "repo: org/fork\nupstream_pr: PR 1\n"), "--vyklad"]);
    expect(jen.stdout).toBe("main\torg/fork\nupstream_pr\tPR 1\n");
    const vada = spust(["--manifest", manifest("upstream-dvakrat", "repo: org/fork\nupstream_repo: a/b\nupstream_repo: c/d\n"), "--vyklad"]);
    expect([vada.status, vada.stdout]).toEqual([2, ""]);
    expect(vada.stderr).toMatch(/2 řádky `upstream_repo:`/);
  });

  it("--zaklad: deklarovaná adresa Forgeja jedním pravidlem, bez údajů; nedeklarovaná = 2", () => {
    const url = spust(["--zaklad"], { FORGEJO_URL: "https://uzivatel:tajne@f.example.test/", FORGEJO_DOMAIN: "g.example.test" });
    expect([url.status, url.stdout], url.stderr).toEqual([0, "https://f.example.test\tFORGEJO_URL\n"]);
    const domena = spust(["--zaklad"], { FORGEJO_URL: "", FORGEJO_DOMAIN: "g.example.test" });
    expect([domena.status, domena.stdout], domena.stderr).toEqual([0, "https://g.example.test\tFORGEJO_DOMAIN\n"]);
    const nic = spust(["--zaklad"], { FORGEJO_URL: "", FORGEJO_DOMAIN: "" });
    expect([nic.status, nic.stdout]).toEqual([2, ""]);
  });
});

describe("nasazovany-repozitar --cti — fork checkout (origin = upstream)", () => {
  const ENV = envWithoutGitLocation(process.env);
  let d;
  let shaUpstream;
  let shaFork;
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: ENV, encoding: "utf8", stdio: "pipe" }).trim();
  const URL_UPSTREAM = "https://forge.example.test/aisha/upstream.git";
  const URL_FORK = "https://forge.example.test/testfork/testfork-orchestrator.git";
  const cti = (manifest, extra = {}) =>
    spawnSync("node", [CLI, "--manifest", manifest, "--repo-root", join(d, "checkout"), "--cti"], {
      encoding: "utf8",
      // GIT_BRANCH prázdný: --cti ho čte jako tvrzení prostředí — test nesmí záviset na shellu obsluhy.
      env: { ...ENV, FORGEJO_URL: "https://forge.example.test", GIT_BRANCH: "", ...extra },
    });

  beforeAll(() => {
    d = mkdtempSync(join(tmpdir(), "nasazovany-repozitar-"));
    const zalozHoleRepo = (jmeno, obsah) => {
      const prac = join(d, `${jmeno}-prac`);
      git(d, "init", "-q", "-b", "main", prac);
      git(prac, "config", "user.email", "t@example.test");
      git(prac, "config", "user.name", "t");
      writeFileSync(join(prac, "f.txt"), obsah);
      git(prac, "add", "f.txt");
      git(prac, "commit", "-q", "-m", jmeno);
      git(d, "clone", "-q", "--bare", prac, join(d, `${jmeno}.git`));
      return git(prac, "rev-parse", "HEAD");
    };
    shaUpstream = zalozHoleRepo("upstream", "u\n");
    shaFork = zalozHoleRepo("fork", "f\n");
    const co = join(d, "checkout");
    git(d, "init", "-q", co);
    // Adresy jako na Forgeji; transport přesměruje insteadOf na lokální holá repa.
    git(co, "config", `url.file://${join(d, "upstream.git")}.insteadOf`, URL_UPSTREAM);
    git(co, "config", `url.file://${join(d, "fork.git")}.insteadOf`, URL_FORK);
    git(co, "remote", "add", "origin", URL_UPSTREAM);
    writeFileSync(join(d, "fork.manifest"), "repo: testfork/testfork-orchestrator\nbranch: main\n");
    writeFileSync(join(d, "bez-vetve.manifest"), "repo: testfork/testfork-orchestrator\nbranch: neexistuje\n");
  });
  afterAll(() => d && rmSync(d, { recursive: true, force: true }));

  it("bez remote na fork čte přímo URL repozitáře nasazení — NE origin (upstream)", () => {
    const r = cti(join(d, "fork.manifest"));
    expect(r.status, r.stderr).toBe(0);
    const [sha, vetev, url, pres] = r.stdout.trim().split("\t");
    expect(sha, "četl upstream místo forku").toBe(shaFork);
    expect(sha).not.toBe(shaUpstream);
    expect([vetev, url, pres]).toEqual(["main", URL_FORK, "-"]);
  });

  const remote = (extra = {}) =>
    spawnSync("node", [CLI, "--manifest", join(d, "fork.manifest"), "--repo-root", join(d, "checkout"), "--remote"], {
      encoding: "utf8",
      env: { ...ENV, FORGEJO_URL: "https://forge.example.test", FORGEJO_DOMAIN: "", ...extra },
    });

  it("--remote bez remote na fork → 4 s důvodem: `origin` (upstream) se NEVYBERE", () => {
    for (const env of [{}, { FORGEJO_URL: "" }]) {
      const r = remote(env);
      expect([r.status, r.stdout], r.stderr).toEqual([4, ""]);
      expect(r.stderr).toMatch(/žádný remote checkoutu neukazuje na nasazovaný repozitář.*remoty: origin/);
    }
  });

  it("s remote na fork (jiné jméno) ho najde podle identity URL", () => {
    git(join(d, "checkout"), "remote", "add", "nasazeni", URL_FORK);
    const r = cti(join(d, "fork.manifest"));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split("\t")).toEqual([shaFork, "main", URL_FORK, "nasazeni"]);
  });

  it("--remote vypíše jméno remote nasazovaného repozitáře — s adresou Forgeja i bez ní, bez sítě", () => {
    for (const env of [{}, { FORGEJO_URL: "" }]) {
      const r = remote(env);
      expect([r.status, r.stdout], r.stderr).toEqual([0, `nasazeni\t${URL_FORK}\n`]);
    }
    // Jiný hostitel v deklaraci = jiný repozitář, i když cesta sedí.
    expect(remote({ FORGEJO_URL: "https://jinde.example.test" }).status).toBe(4);
  });

  it("--cti s GIT_BRANCH odlišným od deklarace → 2 (rozpor), dřív než se cokoli čte", () => {
    const r = cti(join(d, "fork.manifest"), { GIT_BRANCH: "jina" });
    expect([r.status, r.stdout]).toEqual([2, ""]);
    expect(r.stderr).toMatch(/GIT_BRANCH v prostředí tvrdí větev 'jina', manifest deklaruje 'main'/);
    expect(cti(join(d, "fork.manifest"), { GIT_BRANCH: "main" }).status).toBe(0);
  });

  it("větev, která neexistuje → 3 (prázdno není shoda)", () => {
    const r = cti(join(d, "bez-vetve.manifest"));
    expect(r.status).toBe(3);
    expect(r.stdout).toBe("");
  });

  it("bez FORGEJO_URL i FORGEJO_DOMAIN → 2 (deklarace neúplná)", () => {
    const r = spawnSync("node", [CLI, "--manifest", join(d, "fork.manifest"), "--deklarace"], {
      encoding: "utf8",
      env: { ...ENV, FORGEJO_URL: "", FORGEJO_DOMAIN: "" },
    });
    expect(r.status).toBe(2);
  });
});

/**
 * Čtečky pomocníka CHOVÁNÍM, ne textem: skutečné úseky doktora a skutečný skript
 * povrchů nad dočasným fork checkoutem (zvykové jméno remote ukazuje na upstream,
 * repozitář nasazení je pod jiným jménem a na jiném hostiteli). Bez sítě: úsek
 * doktora končí před dotazem na Forgejo, skript povrchů před prvním voláním API.
 */
describe("čtečky ve fork checkoutu: doktor (fáze G) a povrchy vybírají remote podle identity", () => {
  const ENV = envWithoutGitLocation(process.env);
  const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const URL_UPSTREAM = "https://forge-upstream.example.test/org/upstream.git";
  const URL_FORK = "https://uzivatel:tajne@forge.example.test/org/fork.git";
  let d;
  let co;
  const git = (...a) => execFileSync("git", ["-C", co, ...a], { env: ENV, encoding: "utf8", stdio: "pipe" }).trim();
  // Jen to, co čtečka potřebuje — žádné zděděné proměnné stanoviště (COOLIFY_*, FORGEJO_*).
  const cisteEnv = (extra = {}) => ({ PATH: ENV.PATH ?? "", HOME: ENV.HOME ?? "", ...extra });

  beforeAll(() => {
    d = mkdtempSync(join(tmpdir(), "nasazovany-ctecky-"));
    co = join(d, "checkout");
    execFileSync("git", ["init", "-q", co], { env: ENV, stdio: "pipe" });
    git("remote", "add", "origin", URL_UPSTREAM);
    git("remote", "add", "nasazeni", URL_FORK);
    // Skripty hledají knihovny pod kořenem checkoutu — ten dostane odkaz na skutečné.
    mkdirSync(join(co, "scripts"));
    symlinkSync(join(KOREN, "scripts/lib"), join(co, "scripts/lib"));
    copyFileSync(join(KOREN, "scripts/provision-surfaces.sh"), join(co, "scripts/provision-surfaces.sh"));
    writeFileSync(join(d, "fork.manifest"), "repo: org/fork\nbranch: main\n");
  });
  afterAll(() => d && rmSync(d, { recursive: true, force: true }));

  /** Úsek SKUTEČNÉHO skriptu od `od` po `po` (bez `po`); osiřelá kotva test shodí. */
  const usek = (soubor, od, po) => {
    const text = readFileSync(join(KOREN, soubor), "utf8");
    const a = text.indexOf(od);
    const b = text.indexOf(po, a);
    expect(a, `kotva '${od}' v ${soubor} není — test by měřil prázdno`).toBeGreaterThan(-1);
    expect(b, `kotva '${po}' v ${soubor} není — test by měřil prázdno`).toBeGreaterThan(a);
    return text.slice(a, b);
  };
  const usekDoktora = (od, po) => usek("scripts/cold-start-doctor.sh", od, po);
  const fazeG = (env = {}) => {
    const skript = [
      "set -uo pipefail",
      'REPO_ROOT="$1"; MANIFEST="$2"',
      usekDoktora('_forgejo_url=""; _forgejo_zdroj=""; _forgejo_duvod=""', '  if [[ -z "$_forgejo_url" ]]; then\n    fail "Forgejo adresu nelze zjistit'),
      usekDoktora('_ci_repo="${CI_KONTRAKT_REPO:-}"', '    if [[ -z "$_ci_repo" || "$_ci_repo" != */* ]]; then'),
      'printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$_forgejo_url" "$_forgejo_zdroj" "$_forgejo_duvod" "$_ci_repo" "$_ci_zdroj"',
    ].join("\n");
    const r = spawnSync("bash", ["-c", skript, "faze-g", co, join(d, "fork.manifest")], { encoding: "utf8", env: cisteEnv(env) });
    expect(r.status, r.stderr).toBe(0);
    const [url, zdroj, duvod, ciRepo, ciZdroj] = r.stdout.split("\n");
    return { url, zdroj, duvod, ciRepo, ciZdroj };
  };

  it("doktor: nedeklarovaná adresa Forgeja se odvodí z remote nasazovaného repozitáře, NE z `origin`", () => {
    const g = fazeG();
    expect(g.url, "adresa upstreamu = doktor měřil cizí repozitář").toBe("https://forge.example.test");
    expect(g.zdroj).toMatch(/odvozeno z remote 'nasazeni'/);
    expect(g.url + g.zdroj, "přihlašovací údaje nesmí do výpisu").not.toMatch(/tajne|uzivatel/);
  });

  it("doktor: repozitář kontraktu CI je ten z deklarace manifestu, ne původ stromu", () => {
    const g = fazeG();
    expect(g.ciRepo).toBe("org/fork");
    expect(g.ciZdroj).toMatch(/deklarováno manifestem fork\.manifest/);
  });

  it("doktor: deklarované hodnoty mají přednost jako dřív", () => {
    const g = fazeG({ FORGEJO_URL: "https://deklarovano.example.test", CI_KONTRAKT_REPO: "jine/repo" });
    expect([g.url, g.zdroj]).toEqual(["https://deklarovano.example.test", "deklarováno (FORGEJO_URL)"]);
    expect([g.ciRepo, g.ciZdroj]).toEqual(["jine/repo", "deklarováno (CI_KONTRAKT_REPO)"]);
  });

  it("doktor: deklarovaná adresa = táž jako u story-initu — FORGEJO_URL, jinak https://FORGEJO_DOMAIN", () => {
    // Dřív doktor FORGEJO_DOMAIN neznal: měřil adresu odvozenou z remote, zatímco
    // story-init by do Coolify zapsal doménu. Dvě pravidla pro touž adresu.
    const domena = fazeG({ FORGEJO_DOMAIN: "domena.example.test" });
    expect([domena.url, domena.zdroj]).toEqual(["https://domena.example.test", "deklarováno (FORGEJO_DOMAIN)"]);
    // FORGEJO_URL má před doménou přednost; údaje z adresy do výpisu nejdou.
    const oboje = fazeG({ FORGEJO_URL: "https://uzivatel:tajne@url.example.test/", FORGEJO_DOMAIN: "domena.example.test" });
    expect([oboje.url, oboje.zdroj]).toEqual(["https://url.example.test", "deklarováno (FORGEJO_URL)"]);
  });

  const povrchy = (env = {}) =>
    spawnSync("bash", [join(co, "scripts/provision-surfaces.sh")], {
      encoding: "utf8",
      // Bez COOLIFY_* skript skončí na kontrole povinných proměnných — PŘED prvním voláním API.
      env: cisteEnv({ AISHA_SURFACES: "povrch:shell:sub", MANIFEST_FILE: join(d, "fork.manifest"), ...env }),
    });

  it("povrchy: výchozí repozitář je remote nasazovaného repozitáře, NE `origin`", () => {
    const r = povrchy();
    expect(r.stdout, r.stderr).toMatch(/beru remote 'nasazeni' tohoto checkoutu/);
    expect(r.stdout + r.stderr, "do výpisu jen schéma adresy, ne údaje").not.toMatch(/tajne/);
    // Kontrola stanoviště: skript došel ZA volbu repozitáře a zastavil se před API.
    expect([r.status, r.stderr]).toEqual([1, expect.stringMatching(/COOLIFY_BASE_URL is required/)]);
    expect(r.stderr, "repozitář povrchu skript určil").not.toMatch(/AISHA_SURFACE_REPO is required/);
  });

  it("povrchy: výslovné AISHA_SURFACE_REPO a AISHA_SURFACE_BRANCH mají přednost — manifest ani remoty se nečtou", () => {
    const r = povrchy({
      AISHA_SURFACE_REPO: "https://jinde.example.test/x/y.git",
      AISHA_SURFACE_BRANCH: "vyslovna",
      MANIFEST_FILE: join(d, "neni.manifest"),
    });
    expect(r.stdout).not.toMatch(/beru remote/);
    expect(r.stdout).toMatch(/větev povrchu: vyslovna \(AISHA_SURFACE_BRANCH\)/);
    expect(r.stderr).toMatch(/COOLIFY_BASE_URL is required/);
  });

  it("povrchy: výchozí větev je větev z deklarace manifestu, ne pevné jméno", () => {
    // Dřív: výchozí hodnota byla pevná — instance s jinou deploy větví stavěla povrch odjinud než stacky.
    writeFileSync(join(d, "odchylka.manifest"), 'repo: org/fork\nbranch: "nasazeni/x"   # deploy větev instance\n');
    const zManifestuVetev = povrchy({ MANIFEST_FILE: join(d, "odchylka.manifest") });
    expect(zManifestuVetev.stdout, zManifestuVetev.stderr).toMatch(/větev povrchu: nasazeni\/x \(z deklarace manifestu/);
    // Bez řádku větve platí výchozí větev deklarace (kontrolní vzorek).
    writeFileSync(join(d, "bez-vetve.manifest"), "repo: org/fork\n");
    expect(povrchy({ MANIFEST_FILE: join(d, "bez-vetve.manifest") }).stdout).toMatch(/větev povrchu: main \(z deklarace manifestu/);
    // Výslovná proměnná vyhrává i nad deklarací.
    const vyslovna = povrchy({ MANIFEST_FILE: join(d, "odchylka.manifest"), AISHA_SURFACE_BRANCH: "jina" });
    expect(vyslovna.stdout).toMatch(/větev povrchu: jina \(AISHA_SURFACE_BRANCH\)/);
    // Nevyložitelná deklarace: žádná dosazená větev, skript skončí s důvodem.
    writeFileSync(join(d, "vadna-vetev.manifest"), "repo: org/fork\nbranch:\n");
    const vadna = povrchy({ MANIFEST_FILE: join(d, "vadna-vetev.manifest"), AISHA_SURFACE_REPO: "https://jinde.example.test/x/y.git" });
    expect(vadna.status).toBe(1);
    expect(vadna.stderr).toMatch(/PRÁZDNOU hodnotou/);
    expect(vadna.stderr).toMatch(/deklaraci větve v manifestu nejde vyložit/);
    expect(vadna.stdout).not.toMatch(/větev povrchu:/);
  });

  // ── rozpor deklarace s prostředím: tři tazatelé, jeden verdikt, a PŘED wipem ──
  // Recenze 2026-10-04: GIT_BRANCH odlišný od větve manifestu znal jen story-init
  // (krok 3). Běh prošel doktorem i krokem 2b2 a spadl až po odloženém wipu.
  const ROZPOR = /GIT_BRANCH v prostředí tvrdí větev 'jina', manifest deklaruje 'main'.*větev se deklaruje v manifestu/;

  /** SKUTEČNÝ úsek kroku 2b2 (výklad deklarace až po čtení tří sloupců). */
  const krok2b2 = (env = {}, mutace = (t) => t) => {
    const blok = mutace(
      usek("scripts/aisha-cold-start.sh", 'if ! _deploy_dekl="$(node', '\nif [ "$DRY_RUN" = "1" ]; then\n  warn "[DRY RUN] Would verify'),
    );
    const skript = ["set -uo pipefail", 'err() { echo "ERR $*" >&2; }', 'REPO_ROOT="$1"; MANIFEST="$2"', blok, 'printf "PROSEL\\t%s\\t%s\\n" "$_deploy_branch" "$_deploy_repo"'].join("\n");
    return spawnSync("bash", ["-c", skript, "krok-2b2", co, join(d, "fork.manifest")], {
      encoding: "utf8",
      env: cisteEnv({ FORGEJO_URL: "https://forge.example.test", ...env }),
    });
  };

  it("krok 2b2: GIT_BRANCH odlišný od deklarace běh ZASTAVÍ (před wipem); shodný a žádný projde se třemi sloupci", () => {
    const jina = krok2b2({ GIT_BRANCH: "jina" });
    expect([jina.status, jina.stdout]).toEqual([1, ""]);
    expect(jina.stderr).toMatch(ROZPOR);
    expect(jina.stderr).toMatch(/Zastavuji PŘED wipem/);
    for (const env of [{}, { GIT_BRANCH: "main" }, { GIT_BRANCH: "" }]) {
      const r = krok2b2(env);
      // Krok čte první dva sloupce (větev, adresa); třetí (cesta) zahazuje.
      expect([r.status, r.stdout], r.stderr).toEqual([0, "PROSEL\tmain\thttps://forge.example.test/org/fork.git\n"]);
    }
  });

  it("mutant „krok 2b2 nezná tvrzení z prostředí“ projde tam, kde skutečný krok stojí — test ho rozliší", () => {
    // Kdyby volání vykladače prostředí zakrylo, krok by o rozporu nevěděl a běh by šel k wipu.
    const zakryte = (t) => t.replace('_deploy_dekl="$(node', '_deploy_dekl="$(env -u GIT_BRANCH node');
    const mutant = krok2b2({ GIT_BRANCH: "jina" }, zakryte);
    expect(mutant.status, "mutace se neuplatnila — kotva osiřela").toBe(0);
    expect(mutant.stdout).toMatch(/^PROSEL\tmain/);
    // Skutečný krok nad týmž vstupem stojí (kontrolní vzorek k mutantovi).
    expect(krok2b2({ GIT_BRANCH: "jina" }).status).toBe(1);
  });

  /** SKUTEČNÝ úsek doktora (fáze E): kontrola deklarace nasazení proti prostředí. */
  const doktorDeklarace = (env = {}) => {
    const blok = usekDoktora("_dn_rc=0", "    unset _dn _dn_rc _dn_chyby _dn_vetev _dn_repo");
    const skript = ["set -uo pipefail", 'ok() { echo "OK $*"; }; fail() { echo "FAIL $*"; }', 'REPO_ROOT="$1"; MANIFEST="$2"', blok].join("\n");
    const r = spawnSync("bash", ["-c", skript, "doktor-e", co, join(d, "fork.manifest")], { encoding: "utf8", env: cisteEnv(env) });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.trim();
  };

  it("doktor (krok 0): týž rozpor, táž hláška — a bez adresy Forgeja v prostředí", () => {
    expect(doktorDeklarace()).toMatch(/^OK deklarace nasazení: org\/fork, větev main — prostředí jí neodporuje$/);
    expect(doktorDeklarace({ GIT_BRANCH: "main" })).toMatch(/^OK deklarace nasazení/);
    const rozpor = doktorDeklarace({ GIT_BRANCH: "jina" });
    expect(rozpor).toMatch(/^FAIL deklarace nasazení nejde použít \(kód 2\)/);
    expect(rozpor).toMatch(ROZPOR);
  });

  /** SKUTEČNÝ úsek story-initu: výklad deklarace s tvrzeními z příkazové řádky. */
  const storyInit = ({ env = {}, vetevCli = "", repoCli = "", manifest = "fork.manifest" } = {}) => {
    const blok = usek("scripts/coolify-story-init.sh", "  _dekl_rc=0", "  unset _dekl _dekl_rc _dekl_vetev _dekl_repo");
    const skript = [
      "set -euo pipefail",
      'err() { echo "ERR $*" >&2; }',
      'SCRIPT_DIR="$1"; MANIFEST_FILE="$2"; GIT_BRANCH_Z_CLI="$3"; REPO_PATH="$4"; FORGEJO_URL="https://forge.example.test"',
      // Týž začátek jako ve skriptu: hodnota z prostředí se zachytí a GIT_BRANCH se stane pracovní proměnnou.
      'GIT_BRANCH_Z_PROSTREDI="${GIT_BRANCH:-}"; GIT_BRANCH="${GIT_BRANCH:-main}"',
      '[ -n "$GIT_BRANCH_Z_CLI" ] && GIT_BRANCH="$GIT_BRANCH_Z_CLI"',
      blok,
      'printf "ZALOZIL\\t%s\\t%s\\n" "$GIT_BRANCH" "$REPO_PATH"',
    ].join("\n");
    return spawnSync("bash", ["-c", skript, "story-init", join(co, "scripts"), join(d, manifest), vetevCli, repoCli], {
      encoding: "utf8",
      env: cisteEnv(env),
    });
  };

  it("story-init (krok 3): týž verdikt jako krok 2b2; --branch a --repo přidává jen jako tvrzení z řádky", () => {
    const jina = storyInit({ env: { GIT_BRANCH: "jina" } });
    expect([jina.status, jina.stdout]).toEqual([1, ""]);
    expect(jina.stderr).toMatch(ROZPOR);
    const ok = storyInit({ env: { GIT_BRANCH: "main" }, vetevCli: "main", repoCli: "org/fork" });
    expect([ok.status, ok.stdout], ok.stderr).toEqual([0, "ZALOZIL\tmain\torg/fork\n"]);
    expect(storyInit({ vetevCli: "z-radky" }).stderr).toMatch(/--branch tvrdí větev 'z-radky'/);
    expect(storyInit({ repoCli: "jiny/repo" }).stderr).toMatch(/--repo tvrdí repozitář 'jiny\/repo'/);
  });

  it("story-init: PRACOVNÍ hodnota GIT_BRANCH (výchozí main, --branch) se za tvrzení prostředí nevydává", () => {
    // Prostředí nese GIT_BRANCH prázdný, ale EXPORTOVANÝ: skript si do něj dosadí `main`
    // a ta hodnota by doputovala k vykladači jako „tvrzení prostředí“ — falešný rozpor
    // nad manifestem s jinou větví. Vykladač proto dostává hodnotu zachycenou před dosazením.
    writeFileSync(join(d, "odchylka-vetve.manifest"), "repo: org/fork\nbranch: nasazeni\n");
    const prazdny = storyInit({ env: { GIT_BRANCH: "" }, manifest: "odchylka-vetve.manifest" });
    expect([prazdny.status, prazdny.stdout], prazdny.stderr).toEqual([0, "ZALOZIL\tnasazeni\torg/fork\n"]);
    // --branch shodný s deklarací: pracovní proměnná nese větev z řádky, prostředí mlčí → projde.
    const zRadky = storyInit({ env: { GIT_BRANCH: "" }, vetevCli: "nasazeni", manifest: "odchylka-vetve.manifest" });
    expect([zRadky.status, zRadky.stdout], zRadky.stderr).toEqual([0, "ZALOZIL\tnasazeni\torg/fork\n"]);
  });

  it("bez remote nasazovaného repozitáře: doktor adresu NEODVODÍ a povrchy skončí s důvodem", () => {
    git("remote", "remove", "nasazeni");
    const g = fazeG();
    expect(g.url, "zbylý `origin` (upstream) se nesmí dosadit").toBe("");
    expect(g.duvod).toMatch(/žádný remote checkoutu neukazuje na nasazovaný repozitář 'org\/fork'.*remoty: origin/);
    expect(g.ciRepo, "repozitář kontraktu CI na remotech nezávisí").toBe("org/fork");
    const r = povrchy();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/remote nasazovaného repozitáře nejde určit/);
    expect(r.stderr).toMatch(/žádný remote checkoutu neukazuje na nasazovaný repozitář 'org\/fork'/);
    expect(r.stdout).not.toMatch(/beru remote/);
  });
});
